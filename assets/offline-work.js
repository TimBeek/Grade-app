// Database-outage continuity, not a replacement for server authorization.
// No server password hashes or plaintext credentials are stored here.
const OFFLINE_LOGIN_KEY='remarktOfflineLoginV1';
const OFFLINE_LOGIN_AGE=7*24*60*60*1000;
function offlineLoginEntries() {
  try {const entries=JSON.parse(localStorage.getItem(OFFLINE_LOGIN_KEY)||'{}');
    return entries && typeof entries==='object' && !Array.isArray(entries)?entries:{};
  }catch{return {};}
}
function forgetOfflineLogin(id) {
  const entries=offlineLoginEntries();delete entries[id];
  try{localStorage.setItem(OFFLINE_LOGIN_KEY,JSON.stringify(entries));}catch{}
}
async function offlinePasswordProof(password,salt) {
  const crypto=window.crypto;
  if(!crypto?.subtle || typeof password!=='string' || password.length>256)throw Error('Secure browser storage unavailable');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',iterations:210000,
    salt:Uint8Array.from(salt)},key,256);
  return Array.from(new Uint8Array(bits),value=>value.toString(16).padStart(2,'0')).join('');
}
async function rememberOfflineLogin(user,password,workspaceId) {
  if(!workspaceId || user.mustChangePassword || !window.crypto?.subtle)return;
  try {
    const salt=Array.from(window.crypto.getRandomValues(new Uint8Array(16)));
    const proof=await offlinePasswordProof(password,salt),entries=offlineLoginEntries();
    entries[user.id]={user:normalizeStoredUser({...user,passwordHash:'server-managed'}),workspaceId,salt,proof,verifiedAt:Date.now()};
    localStorage.setItem(OFFLINE_LOGIN_KEY,JSON.stringify(entries));
  }catch{/* Online authentication still succeeds when private browsing disallows caching. */}
}
function isContinuityFailure(code) {
  return ['STORAGE_UNAVAILABLE','STORAGE_QUOTA_EXCEEDED','STORAGE_NOT_INITIALIZED','STORAGE_RATE_LIMITED'].includes(code);
}
function canWorkLocally() {
  return Boolean(STATE.offlineWork && STATE.currentUser && STATE.storageFormat===3 &&
    !STATE.localBackupError && isContinuityFailure(STATE.sharedStorageError));
}
async function beginLocalWork({allowEmpty=false}={}) {
  if(!STATE.currentUser || STATE.currentUser.mustChangePassword || !isContinuityFailure(STATE.sharedStorageError))return false;
  await loadDurableBackup();
  const backup=readLocalDemoStateBackup();
  const workspace=STATE.sharedWorkspaceId;
  const usable=backup?.storageFormat===3 && backup.workspaceId===workspace &&
    Array.isArray(backup.batches) && Array.isArray(backup.monitorBatches) && backup._recoveryScope!=='accounts-only';
  if(!usable && !allowEmpty)return false;
  if(backup && backup.workspaceId!==workspace)await archivePreviousWorkspace(backup);
  const user=STATE.currentUser;
  const state=usable?backup:{version:1,storageFormat:3,workspaceId:workspace,
    users:USERS.some(account=>account.id===user.id)?USERS.map(serializeUser):[user],
    batches:[],monitorBatches:[],history:[],labelPrints:[],monitorLabelPrints:[],auditLogs:[],
    deletedBatchIds:[],deletedLaptopStickers:[],deletedMonitorBatchIds:[],deletedMonitorStickers:[],
    recordRevisions:{},updatedAt:new Date().toISOString(),_workInventoryComplete:false};
  if(!workspace)return false;
  applySharedDemoState(state);STATE.currentUser=user;saveSessionUser(user);
  // Normalization adds defaults to imported batch metadata. Those defaults
  // are not employee batch-administration edits and must not enter a replay.
  lastSharedStateSnapshot=state._recordPendingBase || getSharedDemoSnapshot({includeUsers:true});
  STATE.pendingRecordMutation=state._pendingRecordMutation || null;
  STATE.sharedSyncPending=Boolean(STATE.pendingRecordMutation);
  if(!await saveLocalDemoStateBackup(state))return false;
  STATE.localRecoveryAvailable=true;STATE.offlineWork=true;
  STATE.offlineManualOnly=state._workInventoryComplete===false;
  STATE.loginLoadPending=false;
  return true;
}
async function tryOfflineLogin(id,password) {
  const entries=offlineLoginEntries(),entry=Object.hasOwn(entries,id)?entries[id]:null;
  if(!entry?.user || !Number.isFinite(entry.verifiedAt) || Date.now()-entry.verifiedAt>OFFLINE_LOGIN_AGE || entry.user.mustChangePassword ||
    (STATE.sharedWorkspaceId && entry.workspaceId!==STATE.sharedWorkspaceId))return false;
  const current=USERS.find(user=>user.id===id);
  if(current && ['rol','laptopAccess','monitorAccess','passwordUpdatedAt','mustChangePassword'].some(key=>
    current[key]!==entry.user[key])) {forgetOfflineLogin(id);return false;}
  try{if(await offlinePasswordProof(password,entry.salt)!==entry.proof){
    STATE.offlineLoginError='The password does not match the last verified password on this computer. Ask your manager if it was recently reset.';
    return false;
  }}catch{return false;}
  const before=STATE.currentUser;
  STATE.serverAuth=true;STATE.storageFormat=3;STATE.sharedWorkspaceId=entry.workspaceId;STATE.currentUser=entry.user;
  if(!await beginLocalWork({allowEmpty:true})) {STATE.currentUser=before;return false;}
  STATE.currentScreen='home';STATE.homeTab='workflow';setAppMessage(null);return true;
}
function localWorkNoticeIdentity() {
  return {
    key:'remarktLocalWorkNoticeDismissed:' + JSON.stringify([STATE.sharedWorkspaceId,STATE.currentUser?.id]),
    signature:JSON.stringify([Boolean(STATE.offlineManualOnly),Boolean(STATE.localSyncNeedsManager)])
  };
}
function dismissLocalWorkNotice() {
  if(!canWorkLocally())return false;
  const notice=localWorkNoticeIdentity();
  STATE.dismissedLocalWorkNotice=notice;
  try { sessionStorage.setItem(notice.key,notice.signature); } catch { /* Memory fallback. */ }
  return true;
}
function renderLocalWorkStatus() {
  if(!canWorkLocally())return '';
  const notice=localWorkNoticeIdentity(),dismissed=STATE.dismissedLocalWorkNotice;
  let hidden=dismissed?.key===notice.key && dismissed.signature===notice.signature;
  try { hidden=hidden || sessionStorage.getItem(notice.key)===notice.signature; } catch { /* Memory fallback. */ }
  if(hidden)return '';
  return `<section class="local-work-status" role="status" aria-live="polite"><strong>Local work mode</strong>
    <button class="storage-status-close" data-action="dismiss_local_work_notice" type="button" aria-label="Close" title="Close">${uiIcon('close')}</button>
    <span>Saved on this computer; synchronization is pending.</span>
    <button class="btn btn-secondary" data-action="download_local_backup" type="button">Download local recovery copy</button>
    ${isAdminUser()?'<button class="btn btn-secondary" data-action="restore_work_backup" type="button">Restore work lists</button><details><summary>Local work instructions</summary><p>Do not clear browser data. Use separate devices or batches per workstation to avoid duplicate work.</p><p>Offline sign-in is available only after a successful personal-password sign-in on this computer, for up to seven days. Account changes require the server.</p></details>':''}
    ${STATE.localSyncNeedsManager?'<p>Ask a manager to synchronize queued work from different employees on this computer.</p>':''}
    ${STATE.offlineManualOnly?'<p>No cached supplier lists are available here. Manual entry is available; ask a manager for a work backup to restore the lists.</p>':''}
    </section>`;
}

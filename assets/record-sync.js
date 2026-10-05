// Record-storage transport. The grading UI remains independent of SQL/schema.
function liveSessionToken() {
  try { return sessionStorage.getItem('remarktServerSessionV1') || ''; } catch { return ''; }
}
function setLiveSessionToken(token) {
  try {
    if (token) sessionStorage.setItem('remarktServerSessionV1', token);
    else sessionStorage.removeItem('remarktServerSessionV1');
  } catch { /* A browser without session storage must log in again on reload. */ }
}
const appReadRequests = new Map();
let appRetryAfter = 0;
let appStatsCache=null;
const recordTraffic=[];
function rememberRecordResponse(response) {
  recordTraffic.push({at:Date.now(),bytes:Number(response.headers?.get('Content-Length') || 0)});
  while(recordTraffic.length && recordTraffic[0].at<Date.now()-60000)recordTraffic.shift();
  STATE.recordTrafficAlert=recordTraffic.length>120 || recordTraffic.reduce((sum,row)=>sum+row.bytes,0)>10*1024*1024;
}
function rememberRecordProtection(stats) {
  STATE.recordProtection=stats.backup || null;
  if(STATE.recordInsights && stats.storageRevision!==undefined &&
    Number(STATE.recordInsights.data.revision)!==Number(stats.storageRevision))invalidateRecordInsights();
}
function renderRecordProtectionAlerts() {
  if(STATE.storageFormat!==3 || !STATE.currentUser || !isAdminUser())return '';
  const alerts=[];
  const backup=STATE.recordProtection;
  if(backup) {
    const age=Date.now()-Date.parse(backup.createdAt || '');
    if(backup.status==='missing')alerts.push('No verified external backup is available.');
    else if(backup.status==='stale' || age>2*60*60*1000)alerts.push('The backup check is over two hours old. Check the backup computer.');
    else if(backup.status==='pending')alerts.push('Recent work is waiting for the next hourly backup.');
    if(backup.mirrorStatus==='failed' || backup.mirrorStatus==='stale')alerts.push('The second backup location is unavailable or outdated.');
    if(backup.mirrorStatus==='not-configured')alerts.push('A second backup location has not been configured.');
  }
  if(STATE.sharedSyncPending)alerts.push('Changes in this browser have not yet been saved live. Do not clear browser data.');
  if(STATE.recordTrafficAlert)alerts.push('Unusually high traffic in this browser. This is not the provider quota measurement.');
  if(!alerts.length)return '';
  const urgent=STATE.sharedSyncPending || STATE.recordTrafficAlert || backup?.status==='missing' || backup?.status==='stale' ||
    Date.now()-Date.parse(backup?.createdAt||'')>2*60*60*1000 || ['failed','stale'].includes(backup?.mirrorStatus);
  return `<details class="storage-status storage-protection" role="status" aria-live="polite" ${urgent?'open':''}><summary><strong>Data protection</strong></summary>
    ${alerts.map(message=>`<p>${escapeHtml(message)}</p>`).join('')}
    <p>Last verified backup: ${escapeHtml(backup?.createdAt?new Date(backup.createdAt).toLocaleString('nl-NL'):'—')}</p></details>`;
}
async function appFetch(url, options = {}) {
  const method = options.method || 'GET';
  const token = liveSessionToken();
  const settings = { ...options, headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
  const requestKey = `${method}:${url}:${token}`;
  if(method==='GET' && url==='/api/stats' && appStatsCache?.key===requestKey && appStatsCache.until>Date.now())return appStatsCache.response.clone();
  if (method === 'GET' && appReadRequests.has(requestKey)) {
    const response = await appReadRequests.get(requestKey);
    return typeof response.clone === 'function' ? response.clone() : response;
  }
  const run = async () => {
    let timer, controller;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController(); settings.signal = controller.signal;
      timer = setTimeout(() => controller.abort(), 20000);
    }
    try {
      const response = await fetch(url, settings);
      rememberRecordResponse(response);
      if (response.status === 401 && STATE.serverAuth) {
        setLiveSessionToken(''); clearSessionUser(); STATE.currentUser = null; STATE.currentScreen = 'login';
      }
      if ([429, 503].includes(response.status)) appRetryAfter = Date.now() + (Number(response.headers?.get('Retry-After')) || 300) * 1000;
      if(method==='GET' && url==='/api/stats' && response.ok && typeof response.clone==='function')
        appStatsCache={key:requestKey,until:Date.now()+5000,response:response.clone()};
      return response;
    } finally { clearTimeout(timer); }
  };
  if (method !== 'GET') return run();
  const pending = run(); appReadRequests.set(requestKey, pending);
  try { const response = await pending; return typeof response.clone === 'function' ? response.clone() : response; }
  finally { appReadRequests.delete(requestKey); }
}
function recordClientIdentity(collection, id) { return JSON.stringify([collection, id]); }
function clientSnapshotRecords(snapshot) {
  const keys = {
    users: row => row.id, batches: row => String(row.id || row.nummer), monitorBatches: row => String(row.id || row.nummer),
    history: sharedHistoryKey, labelPrints: sharedLabelPrintKey, monitorLabelPrints: sharedMonitorLabelPrintKey, auditLogs: sharedAuditKey,
  };
  const records = [];
  for (const [collection, key] of Object.entries(keys)) for (const row of snapshot[collection] || []) {
    const id = key(row);
    if (collection === 'batches' || collection === 'monitorBatches') {
      const childKey = collection === 'batches' ? 'laptops' : 'monitors';
      const { [childKey]: children, ...payload } = row;
      records.push({ collection, id, batchId: id, payload });
      for (const child of children || []) records.push({ collection: childKey,
        id: JSON.stringify([id, normalizeStickerCode(child.sticker)]), batchId: id, payload: child });
    } else records.push({ collection, id, payload: row });
  }
  for (const collection of ['deletedBatchIds','deletedLaptopStickers','deletedMonitorBatchIds','deletedMonitorStickers'])
    for (const raw of snapshot[collection] || []) {
      const id = /Stickers$/.test(collection) ? normalizeStickerCode(raw) : String(raw);
      records.push({ collection, id, payload: { id } });
    }
  return records;
}
function createRecordMutation(snapshot, previous, options = {}) {
  const business = row => ({...row,payload:Object.fromEntries(Object.entries(row.payload)
    .filter(([key])=>!['_completion','_repairLabel','_searchIndex'].includes(key)))});
  const before = new Map(clientSnapshotRecords(previous || {}).map(business).map(row => [recordClientIdentity(row.collection, row.id), row]));
  const current = clientSnapshotRecords(snapshot).map(business);
  const operations = current.filter(row => {
    if (row.collection === 'users' && (!options.includeUsers || row.id !== options.userMutation?.id)) return false;
    if (row.payload._detailsDeferred) return false;
    return JSON.stringify(row.payload) !== JSON.stringify(before.get(recordClientIdentity(row.collection, row.id))?.payload);
  }).map(row => ({ ...row, expectedRevision: Number(STATE.recordRevisions?.[recordClientIdentity(row.collection, row.id)] || 0) }));
  const userMutation = options.userMutation;
  if (options.includeUsers && userMutation?.action === 'delete') operations.push({ collection: 'users', id: userMutation.id,
    expectedRevision: Number(STATE.recordRevisions?.[recordClientIdentity('users', userMutation.id)] || 0), payload: {}, deleted: true });
  if(options.purgeUserId) for(const row of before.values()) {
    if(['history','labelPrints','monitorLabelPrints'].includes(row.collection) && row.payload.user_id===options.purgeUserId)
      operations.push({...row,deleted:true,expectedRevision:Number(STATE.recordRevisions?.[recordClientIdentity(row.collection,row.id)]||0)});
  }
  for (const collection of ['deletedBatchIds','deletedLaptopStickers','deletedMonitorBatchIds','deletedMonitorStickers']) {
    const restoreName = 'restore' + collection[0].toUpperCase() + collection.slice(1);
    for (const raw of options[restoreName] || []) {
      const id = /Stickers$/.test(collection) ? normalizeStickerCode(raw) : String(raw);
      const existing = operations.find(row => row.collection === collection && row.id === id);
      if (existing) existing.deleted = true;
      else operations.push({ collection, id, payload: { id }, deleted: true,
        expectedRevision: Number(STATE.recordRevisions?.[recordClientIdentity(collection, id)] || 0) });
    }
  }
  const mutationId = window.crypto?.randomUUID?.() || `mutation-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return { workspaceId: STATE.sharedWorkspaceId, mutationId, operations };
}
async function loadRecordPages(collection, query = {}, maxPages = Infinity) {
  const rows = []; let after = '';
  let pages=0;
  do {
    const params = new URLSearchParams({ collection, limit: '200', ...query, ...(after ? { after } : {}) });
    const response = await appFetch(`${SHARED_DEMO_STATE_URL}?${params}`, { cache: 'no-store' });
    if (!response.ok) { await readStorageFailure(response); throw new Error('Record page unavailable'); }
    const page = await response.json(); rows.push(...page.records); after = page.next || '';
  } while (after && ++pages < maxPages);
  return rows;
}
function applyRecordRows(state, rows) {
  const lists = new Map(clientSnapshotRecords(state).map(row => [recordClientIdentity(row.collection, row.id), row]));
  const revisions = { ...(state.recordRevisions || {}) };
  for (const row of rows) {
    const key = recordClientIdentity(row.collection, row.id); revisions[key] = Number(row.revision);
    if (row.deleted) lists.delete(key);
    else lists.set(key, { ...row, batchId: row.batch_id || row.batchId || '' });
  }
  const result = { ...state, recordRevisions: revisions };
  for (const key of ['users','batches','monitorBatches','history','labelPrints','monitorLabelPrints','auditLogs',
    'deletedBatchIds','deletedLaptopStickers','deletedMonitorBatchIds','deletedMonitorStickers']) result[key] = [];
  const batchMap = new Map(), monitorMap = new Map();
  for (const row of lists.values()) {
    if (row.collection === 'batches') batchMap.set(row.id, { ...row.payload, laptops: [] });
    else if (row.collection === 'monitorBatches') monitorMap.set(row.id, { ...row.payload, monitors: [] });
    else if (Array.isArray(result[row.collection])) result[row.collection].push(row.collection.startsWith('deleted') ? row.id : row.payload);
  }
  for (const row of lists.values()) {
    if (row.collection === 'laptops') batchMap.get(row.batchId)?.laptops.push(row.payload);
    if (row.collection === 'monitors') monitorMap.get(row.batchId)?.monitors.push(row.payload);
  }
  result.batches = [...batchMap.values()]; result.monitorBatches = [...monitorMap.values()];
  result.history.sort((a,b)=>getHistoryTimestampMs(a)-getHistoryTimestampMs(b));
  result.monitorLabelPrints.sort((a,b)=>Date.parse(a.printedAt||'')-Date.parse(b.printedAt||''));
  return result;
}

// A read is not an acknowledgement of unsaved local edits. Keep each dirty
// entity and its original revision separate from the latest remote rows.
function applyLoadedRecordRows(rows) {
  const current=getSharedDemoSnapshot({includeUsers:true});
  const baseline=lastSharedStateSnapshot || current;
  const payload=row=>JSON.stringify(Object.fromEntries(Object.entries(row.payload)
    .filter(([key])=>!['_completion','_repairLabel','_searchIndex'].includes(key))));
  const before=new Map(clientSnapshotRecords(baseline).map(row=>[recordClientIdentity(row.collection,row.id),payload(row)]));
  const dirty=new Set(clientSnapshotRecords(current).filter(row=>payload(row)!==before.get(recordClientIdentity(row.collection,row.id)))
    .map(row=>recordClientIdentity(row.collection,row.id)));
  const cleanRows=rows.filter(row=>!dirty.has(recordClientIdentity(row.collection,row.id)));
  const state=applyRecordRows(current,cleanRows);
  lastSharedStateSnapshot=applyRecordRows(baseline,cleanRows);
  applySharedDemoState(state);
  return state;
}
async function prepareRecordRead() {
  if(STATE.pendingRecordMutation || STATE.sharedSyncPending) return await saveSharedDemoState();
  return !STATE.sharedStorageError;
}

let recordHistoryTicket=0;
async function loadRecordHistory(pageNumber=1) {
  if(STATE.storageFormat!==3)return true;
  if(!await prepareRecordRead())return false;
  const ticket=++recordHistoryTicket;
  const query=STATE.historySearch || '';
  const previous=STATE.recordHistoryPage;
  const cursors=previous?.query===query ? [...previous.cursors] : [''];
  const page=Math.max(1,pageNumber);
  if(page>1 && !cursors[page-1]) return false;
  try {
    const params=new URLSearchParams({collection:'history',recent:'1',limit:String(STATE.historyPageSize||50),
      total:'1',search:query,...(cursors[page-1]?{after:cursors[page-1]}:{}),
      ...(!isAdminUser()?{user:STATE.currentUser.id}:{})});
    const response=await appFetch(`${SHARED_DEMO_STATE_URL}?${params}`,{cache:'no-store'});
    if(!response.ok){await readStorageFailure(response);return false;}
    const data=await response.json();
    if(ticket!==recordHistoryTicket || STATE.historySearch!==query) return false;
    cursors[page]=data.next;
    STATE.recordHistoryPage={query,cursors,page,total:data.total,items:data.records.map(row=>row.payload)};
    const state=applyLoadedRecordRows(data.records);
    STATE.historyPage=page;await saveLocalDemoStateBackup(state);return true;
  } catch {markSharedStorageFailure(null);return false;}
}
let recordLoadRequest=null;
async function loadRecordState() {
  if(recordLoadRequest) return recordLoadRequest;
  recordLoadRequest=performRecordLoad();
  try{return await recordLoadRequest;}finally{recordLoadRequest=null;}
}
async function performRecordLoad() {
  await loadDurableBackup();
  const backup = readLocalDemoStateBackup();
  if (!liveSessionToken()) return false;
  try {
    const stampResponse = await appFetch(`${SHARED_DEMO_STATE_URL}?meta=1`, { cache: 'no-store' });
    if (!stampResponse.ok) { await readStorageFailure(stampResponse); return false; }
    const stamp = await stampResponse.json();
    if(backup?.storageRevision!==stamp.storageRevision) {
      invalidateRecordInsights();
    }
    const same = backup?.storageFormat === 3 && backup.workspaceId === stamp.workspaceId;
    if (backup && !same) await archivePreviousWorkspace(backup);
    let state = same ? backup : { version: 1, workspaceId: stamp.workspaceId, storageFormat: 3, users: USERS.map(serializeUser) };
    let rows = [];
    if (same && backup.storageRevision > 0) {
      let after = '';
      do {
        const response = await appFetch(`${SHARED_DEMO_STATE_URL}?since=${backup.storageRevision}${after ? '&after=' + encodeURIComponent(after) : ''}`, { cache: 'no-store' });
        if (!response.ok) { await readStorageFailure(response); return false; }
        const delta = await response.json(); rows.push(...delta.records); after = delta.next || '';
      } while (after);
    } else {
      // List projections, never full historical inspection trees. Pages are
      // bounded; detail requests use a single stable assessment identity.
      for (const collection of ['users','batches','monitorBatches','laptops','monitors',
        'deletedBatchIds','deletedLaptopStickers','deletedMonitorBatchIds','deletedMonitorStickers']) rows.push(...await loadRecordPages(collection));
      for (const collection of ['history','labelPrints','monitorLabelPrints','auditLogs'])
        rows.push(...await loadRecordPages(collection,{recent:'1',limit:'50'},1));
      state._recordProjectionsComplete=false;
    }
    const remote = applyRecordRows(state, rows);
    remote.storageRevision = stamp.storageRevision; remote.updatedAt = stamp.updatedAt;
    // A snapshot cannot acknowledge writes occurring after its initial stamp.
    STATE.recordRevisions = remote.recordRevisions; STATE.storageFormat = 3; STATE.sharedWorkspaceId = stamp.workspaceId;
    STATE.sharedStorageError = null;
    const statistics = await appFetch('/api/stats',{cache:'no-store'});
    if(!statistics.ok) { await readStorageFailure(statistics);return false; }
    const summary=await statistics.json();STATE.recordDashboard=summary.dashboard;rememberRecordProtection(summary);
    const pending = same && backup._pendingRecordMutation;
    if (pending) {
      STATE.pendingRecordMutation = pending;
      STATE.sharedSyncPending = true;
      // Keep pending local edits separate, and replay their original mutation
      // identity. Never regenerate them using newly downloaded revisions.
      applySharedDemoState(backup); lastSharedStateSnapshot = backup._recordPendingBase || backup;
      const savedRows=[];
      if(!await saveRecordState(backup, pending, backup._recordMutationOptions || {}, savedRows)) return false;
      const acknowledged=applyRecordRows(remote,savedRows);
      STATE.recordRevisions=acknowledged.recordRevisions;
      applySharedDemoState(acknowledged);lastSharedStateSnapshot=getSharedDemoSnapshot();
      await saveLocalDemoStateBackup(acknowledged);
    } else {
      applySharedDemoState(remote); lastSharedStateSnapshot = getSharedDemoSnapshot();
      await saveLocalDemoStateBackup({ ...remote, storageFormat: 3 });
      STATE.sharedSyncPending = false;
    }
    lastSharedStateStamp = stamp.updatedAt;
    return true;
  } catch (error) { markSharedStorageFailure(null); return loadLocalDemoStateBackup(); }
}

let recordProjectionRequest=null;
const recordInsightsCache=new Map();
let recordInsightsRequest=null;
let recordInsightsGeneration=0;
function invalidateRecordInsights() {
  recordInsightsGeneration++;
  recordInsightsCache.clear();recordInsightsRequest=null;
  STATE.recordInsights=null;STATE.recordBatchInsights={};
}
function recordInsightsKey(filters=getAnalyticsFilters()) {
  return JSON.stringify([STATE.sharedWorkspaceId,STATE.currentUser?.id,filters]);
}
async function loadRecordInsights(filters=getAnalyticsFilters(), forBatch=false) {
  if(STATE.storageFormat!==3)return true;
  filters={...filters};
  const key=recordInsightsKey(filters);
  const cached=recordInsightsCache.get(key);
  if(cached && cached.until>Date.now()) {
    if(!forBatch)STATE.recordInsights={key,data:cached.data,until:cached.until};return cached.data;
  }
  if(recordInsightsRequest?.key===key)return recordInsightsRequest.promise;
  const promise=(async()=>{
    try {
      if(!await prepareRecordRead())return false;
      const generation=recordInsightsGeneration;
      const response=await appFetch('/api/stats?'+new URLSearchParams({insights:'1',...filters,cacheRevision:String(generation)}),{cache:'no-store'});
      if(!response.ok){await readStorageFailure(response);return false;}
      const data=await response.json();
      if(generation!==recordInsightsGeneration || key!==recordInsightsKey(filters))return false;
      const until=Date.now()+45000;
      recordInsightsCache.set(key,{data,until});
      if(recordInsightsCache.size>20)recordInsightsCache.delete(recordInsightsCache.keys().next().value);
      if(!forBatch && recordInsightsKey()===key)STATE.recordInsights={key,data,until};
      return data;
    } catch {markSharedStorageFailure(null);return false;}
  })();
  recordInsightsRequest={key,promise};
  try{return await promise;}finally{if(recordInsightsRequest?.promise===promise)recordInsightsRequest=null;}
}
async function loadRecordBatchInsights(id) {
  const data=await loadRecordInsights({...ANALYTICS_FILTER_DEFAULTS,productType:'laptop',batch:id},true);
  if(data){STATE.recordBatchInsights={...(STATE.recordBatchInsights||{}),[id]:data};return true;}return false;
}
async function ensureRecordProjections() {
  if(STATE.storageFormat!==3 || STATE.recordProjectionsComplete) return true;
  if(!await prepareRecordRead())return false;
  if(recordProjectionRequest) return recordProjectionRequest;
  recordProjectionRequest=(async()=>{
    try {
      const rows=[];
      for(const collection of ['history','labelPrints','monitorLabelPrints']) rows.push(...await loadRecordPages(collection));
      const state=applyLoadedRecordRows(rows);
      state._recordProjectionsComplete=true;
      STATE.recordProjectionsComplete=true;
      await saveLocalDemoStateBackup(state); return true;
    } catch { markSharedStorageFailure(null);return false; }
  })();
  try{return await recordProjectionRequest;}finally{recordProjectionRequest=null;}
}
const recordTraceCache=new Map();
async function loadRecordTrace(sticker) {
  if(STATE.storageFormat!==3) return true;
  if(!await prepareRecordRead())return false;
  const cacheKey=STATE.sharedWorkspaceId+':'+normalizeStickerCode(sticker);
  if((recordTraceCache.get(cacheKey)||0)>Date.now())return true;
  try {
    const response=await appFetch(`${SHARED_DEMO_STATE_URL}?trace=${encodeURIComponent(normalizeStickerCode(sticker))}`,{cache:'no-store'});
    if(!response.ok){await readStorageFailure(response);return false;}
    const rows=(await response.json()).records;
    const state=applyLoadedRecordRows(rows);
    recordTraceCache.set(cacheKey,Date.now()+2000);
    if(recordTraceCache.size>100)recordTraceCache.delete(recordTraceCache.keys().next().value);
    await saveLocalDemoStateBackup(state);return true;
  } catch { markSharedStorageFailure(null);return false; }
}
async function saveRecordState(snapshot, mutation, options={}, savedRows=[]) {
  if (!mutation.operations.length) return true;
  STATE.pendingRecordMutation = mutation; STATE.sharedSyncPending = true;
  const secured=await saveLocalDemoStateBackup({ ...snapshot, storageFormat: 3, recordRevisions: STATE.recordRevisions,
    _pendingRecordMutation: mutation, _recordPendingBase:lastSharedStateSnapshot,
    _recordMutationOptions:options, _clientSyncPending: true });
  if(!secured)return false;
  const response = await appFetch(SHARED_DEMO_STATE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: await encodeSharedDemoStateBody(mutation) });
  if (!response.ok) { await readStorageFailure(response); return false; }
  const result = await response.json();
  appStatsCache=null;
  invalidateRecordInsights();
  recordTraceCache.clear();
  STATE.recordRevisions = { ...STATE.recordRevisions, ...result.recordRevisions };
  STATE.pendingRecordMutation = null; STATE.sharedSyncPending = false;
  // A replay only acknowledges its own sealed operations, not newer edits
  // that happened while the response was lost. Keep those edits pending.
  const acknowledged=mutation.operations.map(op=>({...op,revision:STATE.recordRevisions[recordClientIdentity(op.collection,op.id)]}));
  savedRows.push(...acknowledged);
  lastSharedStateSnapshot = applyRecordRows(lastSharedStateSnapshot || {},acknowledged);
  const next=createRecordMutation(snapshot,lastSharedStateSnapshot,options);
  // Explicit deletions are already acknowledged; repeating their stale
  // expectedRevision would be an unnecessary second mutation.
  next.operations=next.operations.filter(op=>!mutation.operations.some(old=>old.deleted && old.collection===op.collection && old.id===op.id));
  if(next.operations.length) return saveRecordState(snapshot,next,options,savedRows);
  const {_pendingRecordMutation,_recordPendingBase,_recordMutationOptions,_clientSyncPending,...completedSnapshot}=snapshot;
  await saveLocalDemoStateBackup({ ...completedSnapshot, recordRevisions: STATE.recordRevisions, storageFormat: 3,
    _recordProjectionsComplete: Boolean(readLocalDemoStateBackup()?._recordProjectionsComplete),
    storageRevision: readLocalDemoStateBackup()?.storageRevision || 0 });
  return true;
}
async function loadAssessmentDetail(id) {
  if(!await prepareRecordRead())return;
  const row = STATE.history.find(item => getHistoryItemId(item, 0) === id);
  if (!row?._detailsDeferred) return;
  const response = await appFetch(`${SHARED_DEMO_STATE_URL}?collection=history&id=${encodeURIComponent(row.id)}`, { cache: 'no-store' });
  if (!response.ok) { await readStorageFailure(response); return; }
  const detail = (await response.json()).record;
  if (!detail) return;
  const state=applyLoadedRecordRows([detail]);
  await saveLocalDemoStateBackup(state);
}

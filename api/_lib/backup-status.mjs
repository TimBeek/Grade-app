export function backupStatus(backup, currentRevision, now=Date.now()) {
  const checked=Date.parse(backup?.createdAt || '');
  const ageMs=Number.isFinite(checked)?Math.max(0,now-checked):null;
  const lag=Math.max(0,Number(currentRevision || 0)-Number(backup?.revision || 0));
  const mirrorChecked=Date.parse(backup?.mirrorVerifiedAt || '');
  return { ...backup, ageMs, revisionLag:lag,
    status:ageMs===null?'missing':ageMs>2*60*60*1000?'stale':lag>0?'pending':'current',
    mirrorStatus:!backup?.mirrorConfigured?'not-configured':backup.mirrorError?'failed':
      !Number.isFinite(mirrorChecked) || now-mirrorChecked>2*60*60*1000?'stale':'current' };
}

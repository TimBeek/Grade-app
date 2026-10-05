import { snapshotRecords, recordsToSnapshot } from '../../api/_lib/record-state.mjs';
import { validateSnapshot, storageError } from '../../api/_lib/storage-safety.mjs';
export function restoreRecoveryChain(states) {
  if(!states.length || states.some(state=>state.workspaceId!==states[0].workspaceId ||
    !Number.isSafeInteger(state.storageRevision) || state.storageRevision<1 ||
    (state._incrementalFrom!==undefined && (!Number.isSafeInteger(state._incrementalFrom) || state._incrementalFrom>=state.storageRevision))))
    throw storageError('STORAGE_CORRUPT','Invalid workspace or recovery revision.');
  const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const seen=new Map();
  for(const state of states) {
    const id=JSON.stringify([state._incrementalFrom ?? null,state.storageRevision]);
    const content=JSON.stringify(canonical(state._recordBackup || snapshotRecords(state)));
    if(seen.has(id) && seen.get(id)!==content)throw storageError('STORAGE_CORRUPT','Conflicting recovery files.');
    seen.set(id,content);
  }
  // Immutable duplicate ranges are normal after a crash before cursor advance.
  // A newer complete checkpoint permits recovery without older increment files.
  const full = states.filter(state => state._incrementalFrom === undefined)
    .sort((a,b)=>b.storageRevision-a.storageRevision)[0];
  if (!full) throw storageError('STORAGE_CORRUPT', 'Start with a full checkpoint.');
  const remaining = states.filter(state => state._incrementalFrom !== undefined && state.storageRevision > full.storageRevision);
  const selected = [full];
  let next = full.storageRevision;
  while (remaining.length) {
    const candidates = remaining.filter(state => state._incrementalFrom === next);
    if (!candidates.length) throw storageError('STORAGE_CORRUPT', 'Recovery chain has a gap.');
    const end = Math.max(...candidates.map(state=>state.storageRevision));
    const chosen = candidates.find(state=>state.storageRevision===end);
    selected.push(chosen); next = end;
    for(let i=remaining.length-1;i>=0;i--) if(remaining[i].storageRevision<=end) remaining.splice(i,1);
  }
  states = selected;
  let revision = states[0].storageRevision;
  const workspace = states[0].workspaceId;
  const records = new Map(snapshotRecords(validateSnapshot(states[0])).map(row => {
    const key = JSON.stringify([row.collection, row.id]);
    return [key, { ...row, revision: states[0].recordRevisions?.[key] || revision }];
  }));
  for (const state of states.slice(1)) {
    if (state.workspaceId !== workspace || state._incrementalFrom !== revision || !Array.isArray(state._recordBackup))
      throw storageError('STORAGE_CORRUPT', 'Recovery chain has a gap or belongs to another workspace.');
    for (const row of state._recordBackup) records.set(JSON.stringify([row.collection, row.id]), row);
    revision = state.storageRevision;
  }
  const result = recordsToSnapshot([...records.values()], { workspaceId: workspace, storageRevision: revision,
    updatedAt: states.at(-1).updatedAt });
  return validateSnapshot(result);
}

import { snapshotRecords, recordsToSnapshot } from '../../api/_lib/record-state.mjs';
import { validateSnapshot, storageError } from '../../api/_lib/storage-safety.mjs';
export function restoreRecoveryChain(states) {
  if (!states.length || states[0]._incrementalFrom) throw storageError('STORAGE_CORRUPT', 'Start with a full checkpoint.');
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

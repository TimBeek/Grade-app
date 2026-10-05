// External, encrypted full checkpoint + small incremental files thereafter.
// Run on an internal always-on PC/server, not inside the quota-blocked database.
import fs from 'node:fs/promises';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { loadEnv } from './_lib/env.mjs';
import { createRecordStore, recordsToSnapshot } from '../api/_lib/record-state.mjs';
import { makeRecoveryEnvelope, readRecoveryEnvelope } from '../api/_lib/recovery-envelope.mjs';
import { verifyBackupDirectory, mirrorBackupDirectory } from './_lib/backup-mirror.mjs';

loadEnv(process.env.REMARKT_ENV_FILE || '.env.local');
const directory = process.env.REMARKT_BACKUP_DIR;
if (!directory || !path.isAbsolute(directory)) throw new Error('Specify an absolute external REMARKT_BACKUP_DIR.');
async function runBackup() {
const sql = neon(process.env.REMARKT_DATABASE_URL || process.env.DATABASE_URL);
const workspaceId = process.env.REMARKT_WORKSPACE_ID;
if (!workspaceId || !/^[a-zA-Z0-9_-]{1,100}$/.test(workspaceId)) throw new Error('Specify a safe workspace being backed up.');
const store = createRecordStore(sql, workspaceId);
await fs.mkdir(directory, { recursive: true });
const lockPath=path.join(directory,`backup-${workspaceId}.lock`);
const lock=await fs.open(lockPath,'wx',0o600);
try {
const checkpoint = path.join(directory, `checkpoint-${workspaceId}.json`);
let previous = null;
try { previous = readRecoveryEnvelope(JSON.parse(await fs.readFile(checkpoint, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const stamp = await store.meta();
async function publishHealth(revision) {
  const checked=await verifyBackupDirectory(directory,workspaceId,process.env.REMARKT_BACKUP_KEY);
  if(checked.state.storageRevision!==revision)throw new Error('Recovery chain does not match the backup cursor.');
  let mirrorVerified=false,mirrorError=false;
  const mirror=process.env.REMARKT_BACKUP_MIRROR_DIR || '';
  if(mirror) {
    try {await mirrorBackupDirectory(directory,mirror,workspaceId,process.env.REMARKT_BACKUP_KEY);mirrorVerified=true;}
    catch {mirrorError=true;console.error('Second backup location unavailable or unverified; primary backup preserved.');}
  }
  await sql`INSERT INTO remarkt_backup_health(workspace_id,revision,mirror_configured,mirror_verified_at,mirror_error)
    VALUES (${workspaceId},${revision},${Boolean(mirror)},CASE WHEN ${mirrorVerified} THEN now() ELSE NULL END,${mirrorError})
    ON CONFLICT(workspace_id) DO UPDATE SET revision=EXCLUDED.revision,verified_at=now(),
      mirror_configured=EXCLUDED.mirror_configured,mirror_error=EXCLUDED.mirror_error,
      mirror_verified_at=CASE WHEN ${mirrorVerified} THEN now() ELSE remarkt_backup_health.mirror_verified_at END`;
  if(mirrorError)throw new Error('Primary backup verified, but second backup failed.');
}
if (previous?.storageRevision === stamp.storageRevision) {
  await publishHealth(stamp.storageRevision);
  console.log('No changes: local chain verified; heartbeat updated without downloading the archive.');return;
}
// A full checkpoint is intentionally periodic, not on each action. Incremental
// export uses a fixed upper revision and preserves deleted records/tombstones.
let state;
if (!previous) state = await store.exportState();
else {
  const [metadata, rows] = await sql.transaction([
    sql`SELECT revision,updated_at FROM remarkt_workspaces WHERE id = ${workspaceId}`,
    sql`SELECT collection,id,batch_id,revision,deleted,payload FROM remarkt_records
      WHERE workspace_id = ${workspaceId} AND revision > ${previous.storageRevision}`,
  ], { isolationLevel: 'RepeatableRead', readOnly: true });
  stamp.storageRevision = Number(metadata[0].revision);
  stamp.updatedAt = new Date(metadata[0].updated_at).toISOString();
  state = recordsToSnapshot(rows, { workspaceId, storageRevision: stamp.storageRevision, updatedAt: stamp.updatedAt });
  state._incrementalFrom = previous.storageRevision;
  state._recordBackup = rows;
}
stamp.storageRevision = state.storageRevision;
const envelope = makeRecoveryEnvelope(state);
readRecoveryEnvelope(envelope); // Verify before publishing or advancing cursor.
const file = path.join(directory, `recovery-${workspaceId}-${stamp.storageRevision}-${Date.now()}.json`);
await fs.writeFile(file, JSON.stringify(envelope), { flag: 'wx', mode: 0o600 });
// Cursor/checkpoint is separate from the immutable historical chain. A failed
// run leaves the previous cursor so the next run safely retries the same range.
const cursor = makeRecoveryEnvelope({ ...state, _recordBackup: undefined });
await fs.writeFile(checkpoint + '.pending', JSON.stringify(cursor), { mode: 0o600 });
await fs.rename(checkpoint + '.pending', checkpoint);
await publishHealth(stamp.storageRevision);
await sql`DELETE FROM remarkt_rate_limits WHERE window_start < ${Date.now()-2*24*60*60*1000}`;
console.log(JSON.stringify({ file, revision: stamp.storageRevision, incremental: Boolean(previous) }));
} finally {await lock.close();await fs.unlink(lockPath);}
}
await runBackup();

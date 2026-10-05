// Explicit, additive cutover. Default is a read-only plan. Sources stay intact.
import fs from 'node:fs/promises';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { randomUUID, createHash } from 'node:crypto';
import { loadEnv } from './_lib/env.mjs';
import { createRecordStore, snapshotRecords } from '../api/_lib/record-state.mjs';
import { decodeState } from '../api/_lib/state-core.mjs';
import { validateSnapshot } from '../api/_lib/storage-safety.mjs';
import { makeRecoveryEnvelope } from '../api/_lib/recovery-envelope.mjs';
import { sqlStatements } from './_lib/schema.mjs';

loadEnv(process.env.REMARKT_ENV_FILE || '.env.local');
const url = process.env.REMARKT_DATABASE_URL_UNPOOLED || process.env.DATABASE_URL_UNPOOLED;
if (!url || new URL(url).hostname.includes('-pooler')) throw new Error('Use an explicit direct/unpooled target database URL.');
const workspace = process.env.REMARKT_WORKSPACE_ID;
if (!workspace || !/^[a-zA-Z0-9_-]{1,100}$/.test(workspace)) throw new Error('Specify a safe explicit REMARKT_WORKSPACE_ID.');
const sql = neon(url);
const apply=process.argv.includes('--apply');
if(apply && !process.argv.includes('--freeze-source'))throw new Error('Use --apply --freeze-source for a protected cutover. Dry run does not freeze anything.');
const backupDir = process.env.REMARKT_BACKUP_DIR;
if(apply) {
  if(!backupDir || !path.isAbsolute(backupDir) || !/^[a-f0-9]{64}$/i.test(process.env.REMARKT_BACKUP_KEY || ''))
    throw new Error('Configure an absolute external backup directory and a private 32-byte key before freezing.');
  const guard=await fs.readFile(new URL('../migrations/004-cutover-guard.sql',import.meta.url),'utf8');
  await sql.transaction(sqlStatements(guard).map(statement=>sql.query(statement)));
  const [gates]=await sql.transaction([
    sql`LOCK TABLE remarkt_app_state,remarkt_app_shards IN SHARE ROW EXCLUSIVE MODE`,
    sql`INSERT INTO remarkt_storage_cutover(id,workspace_id,frozen,source_revision)
      SELECT 'shared_state_v2',${workspace},true,(payload->>'storageRevision')::bigint
      FROM remarkt_app_state WHERE id='shared_state_v2'
      ON CONFLICT(id) DO NOTHING RETURNING id`,
  ]);
  const gate=await sql`SELECT * FROM remarkt_storage_cutover WHERE id='shared_state_v2'`;
  if(!gate[0]?.frozen || gate[0].workspace_id!==workspace || gate[0].verified_at)
    throw new Error('Cutover is already verified, belongs to another workspace or is not frozen. No data overwritten.');
}
const [meta, shards, legacy] = await sql.transaction([
  sql`SELECT payload FROM remarkt_app_state WHERE id = 'shared_state_v2'`,
  sql`SELECT collection, compressed FROM remarkt_app_shards`,
  sql`SELECT payload FROM remarkt_app_state WHERE id = 'shared_state'`,
], {isolationLevel:'RepeatableRead',readOnly:true});
let source;
if (meta[0]) {
  source = { ...meta[0].payload, batches: [], monitorBatches: [], history: [], labelPrints: [], monitorLabelPrints: [], auditLogs: [] };
  for (const shard of shards) source[shard.collection].push(...decodeState(shard.compressed));
} else {
  source = legacy[0]?.payload;
}
validateSnapshot(source);
const records = snapshotRecords(source);
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'read-only-plan', workspace,
  counts: Object.fromEntries([...new Set(records.map(row => row.collection))].map(key => [key, records.filter(row => row.collection === key).length])) }));
if (!apply) process.exit(0);
await fs.mkdir(backupDir, { recursive: true });
await fs.writeFile(path.join(backupDir, `before-record-migration-${Date.now()}.json`), JSON.stringify(makeRecoveryEnvelope(source)), { flag: 'wx', mode: 0o600 });
const schema=await fs.readFile(new URL('../migrations/003-record-storage.sql', import.meta.url), 'utf8');
await sql.transaction(sqlStatements(schema).map(statement=>sql.query(statement)));
await sql`INSERT INTO remarkt_workspaces(id) VALUES (${workspace}) ON CONFLICT DO NOTHING`;
const existing = await sql`SELECT count(*)::int AS count FROM remarkt_records WHERE workspace_id = ${workspace}`;
if (existing[0].count && !process.argv.includes('--resume')) throw new Error('Target has records. Only --resume can continue an unverified, frozen migration.');
const store = createRecordStore(sql, workspace);
const revisions=existing[0].count ? (await store.exportState()).recordRevisions : {};
// Bounded migration requests; the new workspace stays inactive throughout.
let chunk=[],bytes=0;
for(const row of records) {
  const size=Buffer.byteLength(JSON.stringify(row));
  if(chunk.length && (chunk.length>=200 || bytes+size>1024*1024)) {
    await store.merge({mutationId:randomUUID(),operations:chunk});chunk=[];bytes=0;
  }
  chunk.push({...row,expectedRevision:Number(revisions[JSON.stringify([row.collection,row.id])]||0)});bytes+=size;
}
if(chunk.length) await store.merge({mutationId:randomUUID(),operations:chunk});
const restored = await store.exportState();
for (const key of ['users','batches','monitorBatches','history','labelPrints','monitorLabelPrints','auditLogs'])
  if (restored[key].length !== source[key].length) throw new Error(`Validation failed for ${key}; do not activate v3.`);
const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object' ?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const content=state=>snapshotRecords(state).map(row=>JSON.stringify(canonical(row))).sort().join('\n');
if(createHash('sha256').update(content(source)).digest('hex')!==createHash('sha256').update(content(restored)).digest('hex'))
  throw new Error('Record-by-record migration verification failed. Do not activate.');
const latest=await sql`SELECT payload FROM remarkt_app_state WHERE id='shared_state_v2'`;
if(JSON.stringify(canonical(latest[0]?.payload))!==JSON.stringify(canonical(meta[0]?.payload)))
  throw new Error('Source changed during migration. Target remains inactive; compare the missing writes before activation.');
await sql`UPDATE remarkt_storage_cutover SET verified_at=now(),target_revision=${restored.storageRevision}
  WHERE id='shared_state_v2' AND workspace_id=${workspace} AND frozen`;
console.log('Migration verified. Source retained. Activate only with REMARKT_STORAGE_FORMAT=3 and the matching workspace.');

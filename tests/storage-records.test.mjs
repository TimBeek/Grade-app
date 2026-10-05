import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createRecordStore, snapshotRecords, recordsToSnapshot, recordSummary } from '../api/_lib/record-state.mjs';
import { emptyState } from '../api/_lib/state-core.mjs';
import { classifyStorageError, validateSnapshot } from '../api/_lib/storage-safety.mjs';
import { readJsonBody } from '../api/_lib/http.mjs';
import { readRecordStats } from '../api/_lib/record-stats.mjs';
import { makeRecoveryEnvelope, readRecoveryEnvelope, planRecoveryMerge } from '../api/_lib/recovery-envelope.mjs';
import { restoreRecoveryChain } from '../scripts/_lib/recovery-chain.mjs';
import { issueSession, verifySessionToken, requireSession, passwordHash, passwordMatches, authorizeOperations } from '../api/_lib/session-auth.mjs';
import {sqlStatements} from '../scripts/_lib/schema.mjs';

async function fixture() {
  const db = new PGlite();
  await db.exec(await fs.readFile(new URL('../migrations/003-record-storage.sql', import.meta.url), 'utf8'));
  await db.query("INSERT INTO remarkt_workspaces(id) VALUES ('test')");
  const traffic = [];
  const execute = async (connection, query) => {
    const rows = (await connection.query(query.text, query.values)).rows;
    traffic.push({ read: Buffer.byteLength(JSON.stringify(rows)), write: Buffer.byteLength(JSON.stringify(query.values)) });
    return rows;
  };
  const sql = (parts, ...values) => {
    const query = { text: parts.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, ''), values };
    query.then = (resolve, reject) => execute(db, query).then(resolve, reject);
    return query;
  };
  sql.transaction = queries => db.transaction(async tx => {
    const results = [];
    for (const query of queries) results.push(await execute(tx, query));
    return results;
  });
  return { db, sql, traffic, store: createRecordStore(sql, 'test') };
}
const mutation = (operations, mutationId = randomBytes(16).toString('hex')) => ({ mutationId, operations });
const operation = (id, grade = 'A', expectedRevision = 0) => ({ collection: 'history', id,
  payload: { id, sticker: id, grade }, expectedRevision });

test('cutover gates reject old code writes atomically while preserving source and record writes',async()=>{
  const {db,store}=await fixture();
  try {
    await db.exec(`CREATE TABLE remarkt_app_state(id text PRIMARY KEY,payload jsonb);
      CREATE TABLE remarkt_app_shards(collection text,payload jsonb);
      INSERT INTO remarkt_app_state VALUES('shared_state_v2','{"storageRevision":7}');
      INSERT INTO remarkt_app_shards VALUES('batches','[]');`);
    const guard=await fs.readFile(new URL('../migrations/004-cutover-guard.sql',import.meta.url),'utf8');
    for(const statement of sqlStatements(guard))await db.query(statement);
    await db.query("INSERT INTO remarkt_storage_cutover(id,workspace_id,frozen) VALUES('shared_state_v2','test',true)");
    await assert.rejects(db.query("UPDATE remarkt_app_state SET payload='{}' WHERE id='shared_state_v2'"),{code:'P0005'});
    await assert.rejects(db.query("DELETE FROM remarkt_app_shards"),{code:'P0005'});
    assert.equal((await db.query("SELECT payload FROM remarkt_app_state")).rows[0].payload.storageRevision,7);
    await store.merge(mutation([operation('new-work')]));
    assert.ok(await store.detail('history','new-work'));
    assert.equal(classifyStorageError(Object.assign(new Error('frozen'),{code:'P0005'})).status,409);
  }finally{await db.close();}
});

test('restoring one deletion marker never resurrects a product still blocked by another marker',async()=>{
  const {db,store}=await fixture();
  try {
    const batch={id:'b',laptops:[{sticker:'123'},{sticker:'456'}]};
    await store.merge(mutation(snapshotRecords({...emptyState(),batches:[batch]}).map(row=>({...row,expectedRevision:0}))));
    await store.merge(mutation([{collection:'deletedLaptopStickers',id:'123',payload:{id:'123'},expectedRevision:0}]));
    const deletedBatch=await store.merge(mutation([{collection:'deletedBatchIds',id:'b',payload:{id:'b'},expectedRevision:0}]));
    await store.merge(mutation([{collection:'deletedBatchIds',id:'b',payload:{id:'b'},deleted:true,expectedRevision:deletedBatch.revision}]));
    const state=await store.exportState();
    assert.equal(state.batches.length,1);assert.deepEqual(state.batches[0].laptops.map(row=>row.sticker),['456']);
    await assert.rejects(store.merge(mutation([{collection:'laptops',id:'["b","123"]',batchId:'b',payload:{sticker:'123'},expectedRevision:0}])),{code:'STORAGE_RECORD_CONFLICT'});
  }finally{await db.close();}
});

test('repair projections count mixed supplier messages exactly as the printer rules',()=>{
  const summary=recordSummary('history',{grade:'B',leverancier_meldingen:'Safety markings, Keyboard is faulty',result:{problems:[]}});
  assert.equal(summary._repairLabel,true);
  assert.equal(recordSummary('history',{grade:'B',leverancier_meldingen:'Safety markings',result:{problems:[]}})._repairLabel,false);
});

test('a recovered encrypted chain can be restored into an isolated SQL workspace and read back without loss',async()=>{
  const {db,store}=await fixture();
  try {
    const key=randomBytes(32).toString('hex');
    const full={...emptyState(),workspaceId:'test',storageRevision:1,
      users:[{id:'m',naam:'Manager',rol:'Manager',passwordHash:passwordHash('synthetic-password')}],
      batches:[{id:'b',nummer:'1',laptops:[{sticker:'123',serial:'MP2526X1',battery:'90%'}]}]};
    const delta={...emptyState(),workspaceId:'test',storageRevision:2,_incrementalFrom:1,
      _recordBackup:[{collection:'history',id:'h',revision:2,payload:{id:'h',sticker:'123',grade:'B',result:{inspection:{detail:'kept'}}}}]};
    const recovered=restoreRecoveryChain([full,delta].map(state=>readRecoveryEnvelope(makeRecoveryEnvelope(state,key),key)));
    await store.merge(mutation(snapshotRecords(recovered).map(row=>({...row,expectedRevision:0}))));
    const checked=await store.exportState();
    assert.deepEqual(snapshotRecords(checked),snapshotRecords(recovered));
    assert.equal((await store.detail('history','h')).payload.result.inspection.detail,'kept');
  }finally{await db.close();}
});

test('record saves reject stale updates, replay duplicates, roll back conflicts and preserve distinct colleague saves', async () => {
  const { db, store } = await fixture();
  try {
    const a = mutation([operation('a')]);
    const saved = await store.merge(a);
    const repeat = await store.merge(a);
    assert.equal(repeat.revision, saved.revision); assert.equal(repeat.replayed, true);
    await assert.rejects(store.merge({ ...a, operations: [operation('a', 'C')] }), { code: 'STORAGE_MUTATION_CONFLICT' });
    await store.merge(mutation([operation('a', 'B', saved.revision)]));
    await assert.rejects(store.merge(mutation([operation('a', 'C', saved.revision)])), { code: 'STORAGE_RECORD_CONFLICT' });
    assert.equal((await store.detail('history', 'a')).payload.grade, 'B');
    const before = await store.meta();
    await assert.rejects(store.merge(mutation([operation('b'), operation('a', 'C', 0)])));
    assert.equal(await store.detail('history', 'b'), null);
    assert.equal((await store.meta()).storageRevision, before.storageRevision);
    await Promise.all([store.merge(mutation([operation('x')])), store.merge(mutation([operation('y')]))]);
    assert.ok(await store.detail('history', 'x')); assert.ok(await store.detail('history', 'y'));
    const row = await store.detail('history', 'a');
    const noop = await store.merge(mutation([operation('a', 'B', row.revision)]));
    assert.equal(noop.changed, 0);
  } finally { await db.close(); }
});

test('a two KB save has bounded reads and writes at 1,000 and 10,000 history records; pages omit details', async () => {
  const { db, store, traffic } = await fixture();
  try {
    for (const count of [1000, 10000]) {
      const rows = Array.from({ length: count }, (_, i) => ({ id: `seed-${String(i).padStart(5, '0')}`,
        sticker: String(i), grade: 'A', result: { inspection: randomBytes(1024).toString('hex') } }));
      await db.query(`INSERT INTO remarkt_records(workspace_id,collection,id,payload,summary,revision)
        SELECT 'test','history',r->>'id',r,r - 'result',1 FROM jsonb_array_elements($1::jsonb) r
        ON CONFLICT DO NOTHING`, [JSON.stringify(rows)]);
      traffic.length = 0;
      await store.merge(mutation([{ ...operation(`new-${count}`), payload: { id: `new-${count}`, sticker: 'NEW',
        grade: 'B', result: { inspection: randomBytes(1024).toString('hex') } } }]));
      const reads = traffic.reduce((sum, item) => sum + item.read, 0), writes = traffic.reduce((sum, item) => sum + item.write, 0);
      assert.ok(reads < 1000); assert.ok(writes < 6000);
      console.log(`Record storage ${count}: reads ${reads} B, writes ${writes} B`);
      const page = await store.page({ limit: 25 });
      assert.equal(page.records.length, 25); assert.ok(page.next);
      assert.ok(page.records.every(row => !row.payload.result?.inspection));
      const second = await store.page({ limit: 25, after: page.next });
      assert.ok(second.records.every(row => !page.records.some(first => first.id === row.id)));
    }
    const changes = await store.changes(1, '', 1);
    assert.equal(changes.records.length, 1); assert.ok(changes.next);
    const rest = await store.changes(1, changes.next, 1);
    assert.equal(rest.records.length, 1); assert.notEqual(rest.records[0].id, changes.records[0].id);
  } finally { await db.close(); }
});

test('splitting batches preserves product and account data, errors are differentiated and malformed backups stop', async () => {
  const state = { ...emptyState(), users: [{ id: 'manager', passwordHash: 'private', naam: 'Manager' }],
    batches: [{ id: 'batch', nummer: '1', laptops: [{ sticker: '00123', serial: 'MP2526X1', battery: '90%' }] }] };
  const rows = snapshotRecords(state).map(row => ({ ...row, revision: 1 }));
  const restored = recordsToSnapshot(rows);
  assert.equal(restored.batches[0].laptops[0].serial, 'MP2526X1');
  assert.equal(restored.batches[0].laptops[0].battery, '90%');
  assert.equal(restored.users[0].passwordHash, 'private');
  assert.equal(recordSummary('users', restored.users[0]).passwordHash, 'server-managed');
  assert.throws(() => validateSnapshot('{bad'), { code: 'STORAGE_CORRUPT' });
  assert.throws(() => validateSnapshot({ history: [] }), { code: 'STORAGE_CORRUPT' });
  assert.equal(classifyStorageError(Object.assign(new Error('auth'), { code: '28P01' })).code, 'STORAGE_AUTH_FAILED');
  assert.equal(classifyStorageError(Object.assign(new Error('query'), { code: '42601' })).code, 'STORAGE_QUERY_FAILED');
  assert.equal(classifyStorageError(new Error('timeout')).code, 'STORAGE_TIMEOUT');
  assert.equal(classifyStorageError(new Error('fixed plan limits')).code, 'STORAGE_QUOTA_EXCEEDED');
  await assert.rejects(readJsonBody({ body: { value: 'x'.repeat(200) } }, 20), { code: 'REQUEST_TOO_LARGE' });
});

test('server counters preserve grading, repair outputs, completion reviews and monitor session timing', async () => {
  const { db, store, sql } = await fixture();
  try {
    const now = Date.now();
    const state = { ...emptyState(), batches: [{id:'b',laptops:[{sticker:'00123'}, {sticker:'456'}, {sticker:'789'}],
      completionReview:{status:'physically_complete',verifiedStickers:['456']}}],
      history:[{id:'h',sticker:'123',batchId:'b',grade:'B',duurSec:55,savedAt:new Date(now).toISOString(),user_id:'alice',user_naam:'Alice',
        result:{problems:['Cracked bezel'],forceProblemLabel:true,repairLabelType:'production',inspection:'heavy tree'}}],
      monitorLabelPrints:[{id:'m',sticker:'M',grade:'A',user_id:'alice',user_naam:'Alice',
        startedAt:new Date(now-20000).toISOString(),firstPrintedAt:new Date(now).toISOString(),durationSec:20}] };
    await store.merge(mutation(snapshotRecords(state).map(row=>({...row,expectedRevision:0}))));
    const stats = await readRecordStats(sql, 'test');
    assert.equal(stats.totals.graded, 2); assert.equal(stats.totals.gradedToday, 2);
    assert.equal(stats.totals.laptopAvgDurationSec,55); assert.equal(stats.totals.monitorAvgActiveSec,20);
    assert.equal(stats.live.dataHealth.digitalGaps,2); assert.equal(stats.live.dataHealth.unresolvedGaps,1);
    assert.equal(stats.live.activeOperators30m,1);
    assert.equal(stats.gradeDistribution.B,1);
    const summary = (await store.page()).records[0].payload;
    assert.deepEqual(summary.result.problems,['Cracked bezel']); assert.equal(summary.result.repairLabelType,'production');
    assert.equal(summary.result.inspection,undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(stats)) < 8000);
  } finally { await db.close(); }
});

test('encrypted recovery authenticates files, restores incremental deletions and refuses broken chains', async () => {
  const key=randomBytes(32).toString('hex');
  const base={...emptyState(),workspaceId:'test',storageRevision:1,users:[{id:'m',passwordHash:'private'}],
    batches:[{id:'b',laptops:[{sticker:'123',serial:'MP2526X1'}]}],deletedLaptopStickers:['999']};
  const envelope=makeRecoveryEnvelope(base,key);
  assert.equal(readRecoveryEnvelope(envelope,key).users[0].passwordHash,'private');
  assert.ok(!JSON.stringify(envelope).includes('MP2526X1'));
  assert.throws(()=>readRecoveryEnvelope(envelope,randomBytes(32).toString('hex')),{code:'STORAGE_CORRUPT'});
  const corrupt=structuredClone(envelope);corrupt.manifest.workspaceId='other';
  assert.throws(()=>readRecoveryEnvelope(corrupt,key),{code:'STORAGE_CORRUPT'});
  const incremental={...emptyState(),workspaceId:'test',storageRevision:2,_incrementalFrom:1,
    _recordBackup:[{collection:'history',id:'h',revision:2,payload:{id:'h',sticker:'123',grade:'B'}},
      {collection:'laptops',id:'["b","123"]',batch_id:'b',revision:2,deleted:true,payload:{sticker:'123'}}]};
  const recovered=restoreRecoveryChain([readRecoveryEnvelope(envelope,key),readRecoveryEnvelope(makeRecoveryEnvelope(incremental,key),key)]);
  assert.equal(recovered.history[0].grade,'B');assert.equal(recovered.batches[0].laptops.length,0);
  assert.deepEqual(recovered.deletedLaptopStickers,['999']);
  assert.throws(()=>restoreRecoveryChain([base,{...incremental,_incrementalFrom:0}]),{code:'STORAGE_CORRUPT'});
  assert.throws(()=>restoreRecoveryChain([incremental]),{code:'STORAGE_CORRUPT'});
  const plan=await planRecoveryMerge(base,{...base,users:[{id:'m',passwordHash:'old'},{id:'alice',passwordHash:'private'}]});
  assert.equal(plan.additions.length,1);assert.equal(plan.conflicts[0].id,'m');
  const removed={...base,recordRevisions:{'["users","alice"]':3}};
  const removedPlan=await planRecoveryMerge(removed,{...base,users:[{naam:'Earlier',passwordHash:'private',id:'alice'}]});
  assert.equal(removedPlan.additions.length,0);assert.equal(removedPlan.conflicts[0].reason,'explicit-restoration-required');
  const orderedPlan=await planRecoveryMerge(base,{...base,users:[{passwordHash:'private',id:'m'}]});
  assert.equal(orderedPlan.conflicts.length,0);
});

test('server auth refuses forged/expired tokens, password resets revoke sessions, and permissions are enforced',async()=>{
  const oldSecret=process.env.REMARKT_SESSION_SECRET;
  process.env.REMARKT_SESSION_SECRET=randomBytes(32).toString('hex');
  try {
    const user={id:'alice',rol:'Grader',laptopAccess:'grade',monitorAccess:'label',passwordHash:passwordHash('test-personal-password')};
    assert.equal(passwordMatches('test-personal-password',user.passwordHash),true);
    assert.equal(passwordMatches('wrong',user.passwordHash),false);
    const token=issueSession(user,'test');
    assert.equal(verifySessionToken(token,'test').sub,'alice');
    assert.throws(()=>verifySessionToken(token,'other'),{code:'AUTH_REQUIRED'});
    assert.throws(()=>verifySessionToken(token+'x','test'),{code:'AUTH_REQUIRED'});
    assert.throws(()=>verifySessionToken(issueSession(user,'test',0),'test'),{code:'AUTH_REQUIRED'});
    const store={detail:async()=>({payload:user})};
    assert.equal((await requireSession({headers:{authorization:'Bearer '+token}},store,'test')).id,'alice');
    user.passwordHash=passwordHash('another-password');
    await assert.rejects(requireSession({headers:{authorization:'Bearer '+token}},store,'test'),{code:'AUTH_REQUIRED'});
    assert.throws(()=>authorizeOperations(user,mutation([{collection:'users',id:'alice',payload:user}])),{code:'AUTH_FORBIDDEN'});
    assert.throws(()=>authorizeOperations({...user,laptopAccess:'label'},mutation([{collection:'history',payload:{user_id:'alice'}}])),{code:'AUTH_FORBIDDEN'});
    assert.throws(()=>authorizeOperations(user,mutation([{collection:'history',payload:{user_id:'other'}}])),{code:'AUTH_FORBIDDEN'});
    authorizeOperations(user,mutation([{collection:'history',payload:{user_id:'alice'}}]));
  } finally { if(oldSecret===undefined)delete process.env.REMARKT_SESSION_SECRET;else process.env.REMARKT_SESSION_SECRET=oldSecret; }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createShardedStore, rowShard, statsRows, COLLECTIONS } from '../api/_lib/sharded-state.mjs';
import { emptyState, normalizeDemoState, mergeDemoState, computeStats, decodeState } from '../api/_lib/state-core.mjs';
import { sendStorageError } from '../api/_lib/storage-error.mjs';

async function fixture(source) {
  const db = new PGlite();
  const log = [];
  const sql = (strings, ...values) => {
    const text = strings.reduce((out, part, index) => out + (index ? `$${index}` : '') + part, '');
    const query = { text, values };
    query.then = (resolve, reject) => execute(db, query).then(resolve, reject);
    return query;
  };
  async function execute(connection, query) {
    const rows = (await connection.query(query.text, query.values)).rows;
    log.push({ text: query.text, bytes: Buffer.byteLength(JSON.stringify(rows)) });
    return rows;
  }
  sql.transaction = queries => db.transaction(async tx => {
    const results = [];
    for (const query of queries) results.push(await execute(tx, query));
    return results;
  });
  const ensureSchema = async () => {
    await db.exec(`CREATE TABLE IF NOT EXISTS remarkt_app_state (
      id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), byte_size INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS remarkt_app_backups (
      id BIGSERIAL PRIMARY KEY, payload JSONB NOT NULL, reason TEXT NOT NULL DEFAULT 'daily',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), byte_size INTEGER NOT NULL DEFAULT 0);`);
  };
  await ensureSchema();
  if (source) await db.query(`INSERT INTO remarkt_app_state(id,payload,byte_size) VALUES ('shared_state',$1::jsonb,$2)`,
    [JSON.stringify(source), Buffer.byteLength(JSON.stringify(source))]);
  return { db, log, store: createShardedStore(sql, ensureSchema) };
}

const user = (id, naam = id) => ({ id, naam, rol: 'Grader', passwordHash: `test-${id}`, initialen: 'T' });
function sourceState(n = 1500) {
  return { ...emptyState(), users: [user('one'), user('two')], updatedAt: '2026-10-03T12:00:00.000Z',
    batches: [{ id: 'batch_1', nummer: '1', laptops: [{ sticker: '00123' }, { sticker: '124' }] }],
    monitorBatches: [{ id: 'mon_1', nummer: '1', monitors: [{ sticker: 'MON1' }] }],
    history: Array.from({ length: n }, (_, i) => ({ id: `grading_${Date.now() - i * 10000}_${i}`, sticker: String(i),
      grade: i % 2 ? 'A' : 'B', user_id: 'one', user_naam: 'One', duurSec: 90, model: 'Test model',
      result: { inspection: 'Repeated detailed product data '.repeat(150) } })),
    monitorLabelPrints: [{ sticker: 'MON1', batchId: 'mon_1', grade: 'B', merk: 'HP', model: 'E233',
      user_id: 'two', firstPrintedAt: new Date().toISOString(), startedAt: new Date(Date.now() - 90000).toISOString() }],
  };
}
function canonical(state) {
  const result = { ...state };
  for (const key of Object.keys(COLLECTIONS)) result[key] = [...(state[key] || [])].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const key of ['updatedAt', 'storageRevision', 'storageFormat', 'userMutation']) delete result[key];
  return result;
}

test('legacy migration is lossless, preserves old row and creates recovery point', async () => {
  const source = sourceState(20);
  const { db, store } = await fixture(source);
  try {
    const migrated = await store.readState();
    assert.deepEqual(canonical(migrated), canonical(normalizeDemoState(source)));
    assert.equal(migrated.updatedAt, source.updatedAt);
    assert.deepEqual((await db.query(`SELECT payload FROM remarkt_app_state WHERE id='shared_state'`)).rows[0].payload, source);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM remarkt_app_backups')).rows[0].n, 1);
  } finally { await db.close(); }
});

test('grade save reads only affected compressed shards, no complete archive', async () => {
  const source = sourceState();
  const { db, log, store } = await fixture(source);
  try {
    await store.initialize(); log.length = 0;
    const item = { id: 'new-history', sticker: 'NEW', grade: 'C', result: { notes: 'Test' } };
    const result = await store.merge({ history: [item] });
    const traffic = log.reduce((sum, row) => sum + row.bytes, 0);
    const oldBytes = Buffer.byteLength(JSON.stringify(source));
    assert.ok(traffic < oldBytes / 100, `save reads ${traffic} bytes vs previous ${oldBytes}`);
    assert.equal(log.some(row => /SELECT payload FROM .*id = 'shared_state'/.test(row.text)), false);
    const changes = await store.readChanges(1);
    assert.equal(changes.revision, result.revision);
    assert.equal(changes.shards.length, 1);
    assert.ok(decodeState(changes.shards[0].gzip).some(row => row.id === item.id));
    const state = await store.readState();
    assert.equal(state.history.length, source.history.length + 1);
    console.log(`Storage benchmark: save responses ${traffic} B; legacy ${oldBytes} B; reduction ${(100 * (1 - traffic / oldBytes)).toFixed(2)}%`);
  } finally { await db.close(); }
});

test('sharded merge matches original semantics for deletes, restorations, review and accounts', async () => {
  let reference = normalizeDemoState(sourceState(20));
  const { db, store } = await fixture(reference);
  try {
    await store.initialize();
    const mutations = [
      { batches: [{ ...reference.batches[0], completionReview: { status: 'physically_complete', verifiedAt: '2026-10-05T12:00:00Z', verifiedStickers: ['124'] } }] },
      { batches: reference.batches },
      { userSync: 'user-management', users: [user('three')], userMutation: { action: 'create', id: 'three' } },
      { userSync: 'user-management', users: [user('one', 'Changed')], userMutation: { action: 'update', id: 'one' } },
      { userSync: 'user-management', users: [user('three')], userMutation: { action: 'delete', id: 'two' } },
      { deletedLaptopStickers: ['000123'] },
      { batches: reference.batches },
      { restoreDeletedLaptopStickers: ['123'], batches: reference.batches },
      { deletedMonitorStickers: ['MON1'] },
      { deletedBatchIds: ['batch_1'] },
      { restoreDeletedBatchIds: ['batch_1'], batches: reference.batches },
    ];
    for (const mutation of mutations) {
      reference = normalizeDemoState(mergeDemoState(reference, mutation));
      await store.merge(mutation);
      assert.deepEqual(canonical(await store.readState()), canonical(reference));
    }
  } finally { await db.close(); }
});

test('two colleagues writing the same shard do not lose either grade', async () => {
  const { db, store } = await fixture(sourceState(1));
  try {
    await store.initialize();
    const a = { id: 'parallel-a', sticker: 'A', grade: 'A' };
    let index = 0, b;
    do { b = { id: `parallel-b-${index++}`, sticker: 'B', grade: 'B' }; } while (rowShard('history', a) !== rowShard('history', b));
    await Promise.all([store.merge({ history: [a] }), store.merge({ history: [b] })]);
    const state = await store.readState();
    assert.ok(state.history.some(row => row.id === a.id));
    assert.ok(state.history.some(row => row.id === b.id));
    assert.equal(state.storageRevision, 3);
  } finally { await db.close(); }
});

test('stats projections retain all KPI values, excluding inspection payloads', async () => {
  const source = sourceState(200);
  const { db, store } = await fixture(source);
  try {
    const state = await store.readState();
    const projected = { ...state };
    for (const collection of Object.keys(COLLECTIONS)) projected[collection] = statsRows(collection, state[collection]);
    const expected = computeStats(state), actual = computeStats(projected);
    delete expected.generatedAt; delete actual.generatedAt;
    assert.deepEqual(actual, expected);
    const stats = await store.readStats();
    assert.equal(stats.totals.graded, 201);
    assert.equal(stats.live.lastActivity.device, expected.live.lastActivity.device);
  } finally { await db.close(); }
});

test('backup copy stays inside Postgres, restore replacement notifies stale clients', async () => {
  const { db, store } = await fixture(sourceState(2));
  try {
    await store.initialize();
    await store.dailyBackup(true, 'test');
    const snapshot = (await db.query('SELECT payload FROM remarkt_app_backups ORDER BY id DESC LIMIT 1')).rows[0].payload;
    assert.deepEqual(canonical(snapshot), canonical(await store.readState()));
    const before = await store.peekMeta();
    await store.replace({ ...snapshot, history: [] });
    const changes = await store.readChanges(before.storageRevision);
    assert.ok(changes.shards.some(row => row.collection === 'history' && decodeState(row.gzip).length === 0));
    assert.equal((await store.readState()).history.length, 0);
    for (let i = 0; i < 8; i++) await store.dailyBackup(true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM remarkt_app_backups')).rows[0].n, 7);
  } finally { await db.close(); }
});

test('missing operational state does not silently initialize an empty database', async () => {
  const { db, store } = await fixture();
  try { await assert.rejects(store.initialize(), /explicit seed or restore/); }
  finally { await db.close(); }
});

test('failed shard transaction rolls back the claimed revision and all records', async () => {
  const { db, store } = await fixture(sourceState(2));
  try {
    await store.initialize();
    const before = await store.readState();
    await db.exec(`ALTER TABLE remarkt_app_shards ADD CONSTRAINT test_no_writes CHECK (revision < 2)`);
    await assert.rejects(store.merge({ history: [{ id: 'failed-save', sticker: 'FAILED', grade: 'C' }] }));
    const after = await store.readState();
    assert.equal(after.storageRevision, before.storageRevision);
    assert.deepEqual(canonical(after), canonical(before));
  } finally { await db.close(); }
});

test('provider quota error is a safe retryable outage, never an empty success', () => {
  const response = {
    headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; },
  };
  sendStorageError(response, new Error('HTTP status 402 quota exceeded postgres://private-password'));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'STORAGE_QUOTA_EXCEEDED');
  assert.equal(response.headers['Retry-After'], '300');
  assert.equal(JSON.stringify(response.body).includes('private-password'), false);
  sendStorageError(response, new Error('Connection failed postgres://another-secret'));
  assert.equal(response.body.code, 'STORAGE_UNAVAILABLE');
  assert.equal(JSON.stringify(response.body).includes('another-secret'), false);
});

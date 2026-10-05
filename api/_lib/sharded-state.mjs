// Bounded Postgres reads: gzip shards instead of a complete JSON archive on
// every save. The legacy row stays untouched as a migration recovery point.
import {
  emptyState, normalizeDemoState, mergeDemoState, encodeState, decodeState,
  computeStats, batchKey, historyKey, labelPrintKey, monitorLabelPrintKey, auditKey,
} from './state-core.mjs';

export const V2_ROW = 'shared_state_v2';
export const COLLECTIONS = {
  batches: { count: 8, key: batchKey },
  monitorBatches: { count: 8, key: batchKey },
  history: { count: 64, key: historyKey },
  labelPrints: { count: 32, key: labelPrintKey },
  monitorLabelPrints: { count: 32, key: monitorLabelPrintKey },
  auditLogs: { count: 1, key: auditKey },
};

export function rowShard(collection, row) {
  const config = COLLECTIONS[collection];
  if (!config) throw new Error('Unknown storage collection');
  const key = config.key(row) || JSON.stringify(row);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) % config.count;
}

export function stateMeta(state, revision) {
  const meta = { ...state, storageFormat: 2, storageRevision: revision };
  for (const collection of Object.keys(COLLECTIONS)) delete meta[collection];
  delete meta.userMutation;
  return meta;
}

const pick = (row, keys) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
// Only fields consumed by computeStats. Large inspection trees and copied
// product descriptions are never transferred for the management counters.
export function statsRows(collection, rows) {
  return rows.map(row => {
    if (collection === 'batches') return {
      ...pick(row, ['id', 'nummer', 'completionReview']),
      laptops: (row.laptops || []).map(laptop => ({ sticker: laptop.sticker })),
    };
    if (collection === 'monitorBatches') return { monitors: (row.monitors || []).map(() => ({})) };
    if (collection === 'history') return pick(row, [
      'id', 'sticker', 'grade', 'user_naam', 'user_id', 'leverancier', 'batchNummer',
      'duurSec', 'merk', 'model', 'savedAt', 'createdAt', 'completedAt', 'printedAt',
    ]);
    if (collection === 'monitorLabelPrints') return pick(row, [
      'sticker', 'batchId', 'batchNummer', 'grade', 'user_naam', 'user_id',
      'firstPrintedAt', 'printedAt', 'startedAt', 'durationSec', 'deviceName', 'merk', 'model',
    ]);
    if (collection === 'labelPrints') return pick(row, ['sticker']);
    return pick(row, ['entityType', 'action', 'entityId']);
  });
}

function splitState(state) {
  const shards = [];
  for (const collection of Object.keys(COLLECTIONS)) {
    const groups = new Map();
    for (const row of state[collection] || []) {
      const shard = rowShard(collection, row);
      if (!groups.has(shard)) groups.set(shard, []);
      groups.get(shard).push(row);
    }
    for (const [shard, rows] of groups) shards.push({ collection, shard, rows });
  }
  return shards;
}

function isConflict(error) {
  return error && (error.code === '40001' || /storage revision conflict/i.test(error.message || ''));
}

export function createShardedStore(sql, ensureLegacySchema) {
  let ready;
  async function schema() {
    if (!ready) ready = (async () => {
      await ensureLegacySchema();
      await sql`CREATE TABLE IF NOT EXISTS remarkt_app_shards (
        collection TEXT NOT NULL, shard INTEGER NOT NULL,
        payload JSONB NOT NULL, compressed TEXT NOT NULL, stats_compressed TEXT NOT NULL,
        revision BIGINT NOT NULL, PRIMARY KEY (collection, shard)
      )`;
      // The first statement of every transaction claims a revision and row
      // lock. A stale writer aborts the WHOLE transaction, then re-merges only
      // its affected shards. No last-writer-wins loss between colleagues.
      await sql`CREATE OR REPLACE FUNCTION remarkt_claim_state_v2(expected BIGINT, next_meta JSONB)
        RETURNS VOID LANGUAGE plpgsql AS $$
        DECLARE changed INTEGER;
        BEGIN
          IF expected = -1 THEN
            INSERT INTO remarkt_app_state (id, payload, byte_size)
            VALUES ('shared_state_v2', next_meta, octet_length(next_meta::text))
            ON CONFLICT (id) DO NOTHING;
          ELSE
            UPDATE remarkt_app_state SET payload = next_meta,
              updated_at = NOW(), byte_size = octet_length(next_meta::text)
            WHERE id = 'shared_state_v2'
              AND (payload ->> 'storageRevision')::BIGINT = expected;
          END IF;
          GET DIAGNOSTICS changed = ROW_COUNT;
          IF changed <> 1 THEN
            RAISE EXCEPTION 'storage revision conflict' USING ERRCODE = '40001';
          END IF;
        END $$`;
    })().catch(error => { ready = null; throw error; });
    return ready;
  }

  async function peekMeta() {
    await schema();
    const rows = await sql`SELECT payload FROM remarkt_app_state WHERE id = ${V2_ROW}`;
    return rows[0]?.payload || null;
  }

  function writeShard(collection, shard, rows, revision) {
    return sql`INSERT INTO remarkt_app_shards
      (collection, shard, payload, compressed, stats_compressed, revision)
      VALUES (${collection}, ${shard}, ${JSON.stringify(rows)}::jsonb,
        ${encodeState(rows)}, ${encodeState(statsRows(collection, rows))}, ${revision})
      ON CONFLICT (collection, shard) DO UPDATE SET
        payload = EXCLUDED.payload, compressed = EXCLUDED.compressed,
        stats_compressed = EXCLUDED.stats_compressed, revision = EXCLUDED.revision`;
  }

  async function initialize() {
    const current = await peekMeta();
    if (current) return current;
    // A one-time read is unavoidable for upgrading existing installations.
    // Subsequent GETs and ALL routine writes only read compressed shards.
    const legacy = await sql`SELECT payload FROM remarkt_app_state WHERE id = 'shared_state'`;
    if (!legacy[0]) throw new Error('No operational database state found. Initialization requires an explicit seed or restore.');
    const source = typeof legacy[0].payload === 'string' ? JSON.parse(legacy[0].payload) : legacy[0].payload;
    const state = normalizeDemoState(source);
    state.updatedAt = source.updatedAt || state.updatedAt;
    const meta = stateMeta(state, 1);
    try {
      await sql.transaction([
        sql`SELECT remarkt_claim_state_v2(-1, ${JSON.stringify(meta)}::jsonb)`,
        ...splitState(state).map(({ collection, shard, rows }) => writeShard(collection, shard, rows, 1)),
        // Preserve the pre-migration state inside Postgres, never download a
        // second copy to create a backup.
        sql`INSERT INTO remarkt_app_backups (payload, reason, byte_size)
          SELECT payload, 'before-sharded-migration', byte_size FROM remarkt_app_state WHERE id = 'shared_state'`,
      ]);
      return meta;
    } catch (error) {
      if (!isConflict(error)) throw error;
      const winner = await peekMeta();
      if (!winner) throw error;
      return winner;
    }
  }

  async function readCompressed(selectors = null, stats = false) {
    if (!selectors) return stats
      ? sql`SELECT collection, shard, stats_compressed AS compressed FROM remarkt_app_shards`
      : sql`SELECT collection, shard, compressed FROM remarkt_app_shards`;
    return sql`SELECT s.collection, s.shard, s.compressed FROM remarkt_app_shards s
      JOIN jsonb_to_recordset(${JSON.stringify(selectors)}::jsonb) AS wanted(collection TEXT, shard INTEGER)
      ON s.collection = wanted.collection AND s.shard = wanted.shard`;
  }

  async function readState(stats = false) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const meta = await initialize();
      const shards = await readCompressed(null, stats);
      const after = await peekMeta();
      if (after.storageRevision !== meta.storageRevision) continue;
      const state = { ...emptyState(), ...meta };
      if (stats) state.users = (meta.users || []).map(() => ({}));
      for (const shard of shards) state[shard.collection].push(...decodeState(shard.compressed));
      return state;
    }
    throw new Error('Database changed during reading. Please retry.');
  }

  async function readChanges(since) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const meta = await initialize();
      if (!Number.isSafeInteger(since) || since < 1 || since > meta.storageRevision) return null;
      const shards = await sql`SELECT collection, shard, compressed FROM remarkt_app_shards WHERE revision > ${since}`;
      const after = await peekMeta();
      if (after.storageRevision !== meta.storageRevision) continue;
      return {
        shardedDelta: true, baseRevision: since, revision: meta.storageRevision,
        meta, shards: shards.map(row => ({ collection: row.collection, shard: row.shard, gzip: row.compressed })),
        shardCounts: Object.fromEntries(Object.entries(COLLECTIONS).map(([key, value]) => [key, value.count])),
      };
    }
    throw new Error('Database changed during reading. Please retry.');
  }

  async function merge(incoming) {
    const normalized = normalizeDemoState(incoming);
    for (let attempt = 0; attempt < 5; attempt++) {
      const meta = await initialize();
      const wanted = new Map();
      const add = (collection, shard) => wanted.set(`${collection}:${shard}`, { collection, shard });
      for (const collection of Object.keys(COLLECTIONS)) {
        for (const row of normalized[collection]) add(collection, rowShard(collection, row));
      }
      // Deletions may affect rows NOT present in this client's delta. Read
      // all affected batch shards, but never the unrelated grading archive.
      for (const [collection, markers] of [
        ['batches', ['deletedBatchIds', 'deletedLaptopStickers', 'restoreDeletedBatchIds', 'restoreDeletedLaptopStickers']],
        ['monitorBatches', ['deletedMonitorBatchIds', 'deletedMonitorStickers', 'restoreDeletedMonitorBatchIds', 'restoreDeletedMonitorStickers']],
      ]) if (markers.some(key => normalized[key].length)) {
        for (let shard = 0; shard < COLLECTIONS[collection].count; shard++) add(collection, shard);
      }
      const selected = [...wanted.values()];
      const existing = { ...emptyState(), ...meta };
      for (const shard of await readCompressed(selected)) existing[shard.collection].push(...decodeState(shard.compressed));
      const merged = normalizeDemoState(mergeDemoState(existing, incoming));
      const revision = meta.storageRevision + 1;
      const next = stateMeta(merged, revision);
      const groups = new Map(splitState(merged).map(group => [`${group.collection}:${group.shard}`, group.rows]));
      try {
        await sql.transaction([
          sql`SELECT remarkt_claim_state_v2(${meta.storageRevision}, ${JSON.stringify(next)}::jsonb)`,
          ...selected.map(({ collection, shard }) => writeShard(collection, shard, groups.get(`${collection}:${shard}`) || [], revision)),
        ]);
        return { updatedAt: next.updatedAt, revision };
      } catch (error) {
        if (!isConflict(error) || attempt === 4) throw error;
      }
    }
  }

  async function replace(source) {
    const state = normalizeDemoState(source);
    for (let attempt = 0; attempt < 5; attempt++) {
      const meta = await peekMeta();
      const revision = (meta?.storageRevision || 0) + 1;
      const groups = new Map(splitState(state).map(group => [`${group.collection}:${group.shard}`, group.rows]));
      const all = Object.entries(COLLECTIONS).flatMap(([collection, config]) =>
        Array.from({ length: config.count }, (_, shard) => ({ collection, shard })));
      try {
        await sql.transaction([
          sql`SELECT remarkt_claim_state_v2(${meta ? meta.storageRevision : -1}, ${JSON.stringify(stateMeta(state, revision))}::jsonb)`,
          ...all.map(({ collection, shard }) => writeShard(collection, shard, groups.get(`${collection}:${shard}`) || [], revision)),
        ]);
        return state;
      } catch (error) { if (!isConflict(error) || attempt === 4) throw error; }
    }
  }

  async function readStats() {
    const meta = await initialize();
    const cached = await sql`SELECT payload FROM remarkt_app_state WHERE id = 'dashboard_stats_v2'`;
    const stats = cached[0]?.payload;
    if (stats && stats.storageRevision === meta.storageRevision &&
      Date.now() - Date.parse(stats.generatedAt) < 30000) return stats;
    const state = await readState(true);
    const computed = { ...computeStats(state), storageRevision: state.storageRevision };
    await sql`INSERT INTO remarkt_app_state (id, payload, byte_size)
      VALUES ('dashboard_stats_v2', ${JSON.stringify(computed)}::jsonb, ${Buffer.byteLength(JSON.stringify(computed))})
      ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW(), byte_size = EXCLUDED.byte_size`;
    return computed;
  }

  async function dailyBackup(force = false, reason = 'daily') {
    await schema();
    // Copy all raw shard payloads inside Postgres. No archive-sized result is
    // returned to Vercel. Locking the metadata serializes backups with writes.
    await sql.transaction([
      sql`SELECT id FROM remarkt_app_state WHERE id = ${V2_ROW} FOR UPDATE`,
      sql`INSERT INTO remarkt_app_backups (payload, reason, byte_size)
        SELECT snapshot, ${reason}, octet_length(snapshot::text)
        FROM (SELECT m.payload || COALESCE((
          SELECT jsonb_object_agg(collection, rows) FROM (
            SELECT collection, jsonb_agg(item) AS rows FROM remarkt_app_shards s
            CROSS JOIN LATERAL jsonb_array_elements(s.payload) item GROUP BY collection
          ) collections
        ), '{}'::jsonb) AS snapshot FROM remarkt_app_state m WHERE m.id = ${V2_ROW}) snapshot_row
        WHERE ${force} OR NOT EXISTS (
          SELECT 1 FROM remarkt_app_backups WHERE created_at >= NOW() - INTERVAL '24 hours')`,
      sql`DELETE FROM remarkt_app_backups WHERE id IN (
        SELECT id FROM remarkt_app_backups ORDER BY created_at DESC, id DESC OFFSET 7)`,
    ]);
  }

  return { peekMeta, initialize, readState, readChanges, merge, replace, readStats, dailyBackup };
}

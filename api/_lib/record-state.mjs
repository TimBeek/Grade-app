// Version 3: one mutable entity per row. Routine saves never read an archive.
// Schema/cutover is explicit; merely deploying this module does not migrate data.
import { createHash } from 'node:crypto';
import { emptyState, normalizeDemoState, batchKey, historyKey, labelPrintKey, monitorLabelPrintKey, auditKey } from './state-core.mjs';
import { storageError, validateSnapshot } from './storage-safety.mjs';
import { emitMetric } from './telemetry.mjs';

export const RECORD_KEYS = {
  users: row => String(row.id || '').toLowerCase(), batches: batchKey, monitorBatches: batchKey,
  history: historyKey, labelPrints: labelPrintKey, monitorLabelPrints: monitorLabelPrintKey,
  auditLogs: auditKey,
};
export const markerNames = ['deletedBatchIds', 'deletedLaptopStickers', 'deletedMonitorBatchIds', 'deletedMonitorStickers'];
export const normalizeCode = value => {
  const code = String(value || '').trim().replace(/\s+/g, '');
  return /^0+\d+$/.test(code) ? code.replace(/^0+/, '') || '0' : code;
};
const clean = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['_searchIndex', '_recordRevision', '_detailsDeferred', '_completion', '_repairLabel'].includes(key)));
export function recordSummary(collection, row) {
  if (collection === 'users') return { ...row, passwordHash: 'server-managed' };
  if (collection !== 'history') return row;
  // List/analytics keep factual damage and grading outputs; large inspection
  // trees and copied input choices are loaded only when opening a detail.
  const { keuzes, inspectionChecks, inspectionObservations, inspectionObservationPaths, inspectionRepairs, result, ...summary } = row;
  const { inspection, ...outputs } = result || {};
  const issueText=[...(result?.problems || []),...String(row.leverancier_meldingen || '').split(',')].filter(Boolean);
  const repair = result ? Boolean(result.forceProblemLabel || result.repairActions?.length || issueText.some(text =>
    !/\bsafety\s*marking(s)?\b|\bveiligheidsmarkering(en)?\b/i.test(text) &&
    /(defect|faulty|cracked|broken|gebroken|gebarsten|barst|no power|does not power|geen beeld|dead battery|missing battery|battery missing|ontbreekt|pixel line|dead pixel|dead pixels|flicker|flikker|schermflikkering|toets werkt niet|key not working|keyboard .*faulty|keyboard missing|touchpad werkt niet|touchpad not working|scharnier kapot|scharnier werkt niet|hinge .*not functional|not functional|niet functioneel|los|scherpe rand|safety risk|veiligheidsrisico|herstel|herstellen|rechtmaken|niet herstelbaar|verbogen)/i.test(text))) : /^(D|X)$/i.test(row.grade || '');
  return { ...summary, ...(result ? { result: outputs } : {}), _repairLabel:repair, _detailsDeferred: true };
}
export function snapshotRecords(source) {
  const output = [];
  for (const [collection, key] of Object.entries(RECORD_KEYS)) {
    for (const input of source[collection] || []) {
      const row = clean(input), id = key(row);
      if (!id) throw storageError('REQUEST_INVALID', 'An entity requires a stable identity.', 400);
      if (collection === 'batches' || collection === 'monitorBatches') {
        const childKey = collection === 'batches' ? 'laptops' : 'monitors';
        const children = row[childKey] || [];
        delete row[childKey];
        output.push({ collection, id, payload: row, batchId: id });
        for (const child of children) {
          const sticker = normalizeCode(child.sticker);
          if (!sticker) throw storageError('REQUEST_INVALID', 'A product requires a barcode or serial.', 400);
          output.push({ collection: childKey, id: JSON.stringify([id, sticker]), payload: clean(child), batchId: id });
        }
      } else output.push({ collection, id, payload: row, batchId: String(row.batchId || row.batchNummer || '') });
    }
  }
  for (const collection of markerNames) for (const id of source[collection] || [])
    output.push({ collection, id: String(id), payload: { id: String(id) }, batchId: '' });
  return output;
}
export function recordsToSnapshot(records, meta = {}) {
  const state = { ...emptyState(), ...meta, storageFormat: 3, recordRevisions: {} };
  const batches = new Map(), monitors = new Map();
  for (const record of records) {
    const { collection, id, revision } = record;
    state.recordRevisions[JSON.stringify([collection, id])] = Number(revision);
    if (record.deleted) continue;
    const row = record.payload;
    if (collection === 'batches') batches.set(id, { ...row, laptops: [] });
    else if (collection === 'monitorBatches') monitors.set(id, { ...row, monitors: [] });
    else if (Array.isArray(state[collection])) state[collection].push(markerNames.includes(collection) ? id : row);
  }
  for (const record of records) {
    if (record.deleted) continue;
    if (record.collection === 'laptops') batches.get(record.batch_id || record.batchId)?.laptops.push(record.payload);
    if (record.collection === 'monitors') monitors.get(record.batch_id || record.batchId)?.monitors.push(record.payload);
  }
  state.batches = [...batches.values()]; state.monitorBatches = [...monitors.values()];
  return state;
}

export function validateRecordMutation(input) {
  if (!input || !/^[\w-]{16,100}$/.test(input.mutationId || '') || !Array.isArray(input.operations) || input.operations.length > 20000)
    throw storageError('REQUEST_INVALID', 'Invalid mutation identity or operations.', 400);
  const identities = new Set();
  for (const op of input.operations) {
    if (!Object.hasOwn(RECORD_KEYS, op.collection) && !['laptops', 'monitors', ...markerNames].includes(op.collection))
      throw storageError('REQUEST_INVALID', 'Unknown entity collection.', 400);
    if (typeof op.id !== 'string' || !op.id || op.id.length > 1000 ||
        !Number.isSafeInteger(op.expectedRevision) || op.expectedRevision < 0 ||
        !op.payload || typeof op.payload !== 'object' || Array.isArray(op.payload))
      throw storageError('REQUEST_INVALID', 'Invalid entity or revision.', 400);
    if (op.payload._detailsDeferred) throw storageError('REQUEST_INVALID', 'A list summary cannot overwrite full assessment details.', 400);
    if (!op.deleted && op.collection === 'users' &&
        (op.id !== op.payload.id || !/^[a-z0-9_-]{1,80}$/.test(op.id) ||
         !/^(Manager|Admin|Grader|Sticker|Stickeraar|Labeler)$/i.test(op.payload.rol || '') ||
         !/^(?:[a-f0-9]{64}|scrypt\$[a-f0-9]{32}\$[a-f0-9]{64})$/i.test(op.payload.passwordHash || '')))
      throw storageError('REQUEST_INVALID', 'Invalid account identity, role or private password hash.', 400);
    const key = JSON.stringify([op.collection, op.id]);
    if (identities.has(key)) throw storageError('REQUEST_INVALID', 'Duplicate entity operation.', 400);
    identities.add(key);
  }
  return input;
}

export function createRecordStore(sql, workspaceId) {
  if (!workspaceId) throw new Error('An explicit workspace is required for record storage.');
  async function meta() {
    const rows = await sql`SELECT revision, updated_at FROM remarkt_workspaces WHERE id = ${workspaceId}`;
    if (!rows[0]) throw storageError('STORAGE_NOT_INITIALIZED', 'Record storage requires an explicit migration.');
    return { storageFormat: 3, workspaceId, storageRevision: Number(rows[0].revision), updatedAt: new Date(rows[0].updated_at).toISOString() };
  }
  async function merge(input) {
    validateRecordMutation(input);
    const operations = input.operations.map(op => {
      const row = op.payload;
      const occurred = Date.parse(op.collection === 'monitorLabelPrints' ? row.firstPrintedAt || row.printedAt || ''
        : row.savedAt || row.createdAt || row.completedAt || row.printedAt || '');
      const started = Date.parse(row.startedAt || '');
      const ms = Number.isFinite(occurred) ? occurred : Number(String(row.id || '').match(/\d{13}/)?.[0] || 0);
      const storedDuration = Number(op.collection === 'monitorLabelPrints' ? row.durationSec : row.duurSec);
      return { ...op,
      summary: recordSummary(op.collection, op.payload),
      batchId: String(op.batchId || op.payload.batchId || op.payload.batchNummer || ''),
      sticker: normalizeCode(op.payload.sticker), serial: String(op.payload.serial || '').trim().toUpperCase(),
      userId: String(op.payload.user_id || op.payload.userId || ''),
      occurredMs: ms, startedMs: Number.isFinite(started) ? started : 0,
      durationSec: Number.isFinite(storedDuration) && storedDuration > 0 ? storedDuration
        : Number.isFinite(started) && ms >= started ? Math.max(1, Math.round((ms - started) / 1000)) : 0,
    }; });
    const hash = createHash('sha256').update(JSON.stringify(operations)).digest('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rows = await sql`SELECT remarkt_commit_records(${workspaceId}, ${input.mutationId}, ${hash}, ${JSON.stringify(operations)}::jsonb) AS result`;
        const result = rows[0].result;
        result.recordRevisions = Object.fromEntries(Object.entries(result.recordRevisions || {})
          .map(([key, value]) => [JSON.stringify(JSON.parse(key)), value]));
        emitMetric({ query: 'record-save', requestBytes: Buffer.byteLength(JSON.stringify(operations)),
          responseBytes: Buffer.byteLength(JSON.stringify(rows)), retries: attempt, changed: result.changed,
          replayed: Boolean(result.replayed) });
        return result;
      } catch (error) {
        if (error.code === 'P0002') throw storageError('STORAGE_RECORD_CONFLICT', 'A newer entity exists.', 409);
        if (error.code === 'P0003') throw storageError('STORAGE_MUTATION_CONFLICT', 'Mutation identity already used for different data.', 409);
        if (!['40001', '40P01'].includes(error.code) || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt + Math.random() * 25));
      }
    }
  }
  async function page({ collection = 'history', after = '', limit = 50, batchId = '', userId = '', search = '', sticker = '', recent = false, details = false, withTotal = false } = {}) {
    if (!Object.hasOwn(RECORD_KEYS, collection) && !['laptops', 'monitors', ...markerNames].includes(collection))
      throw storageError('REQUEST_INVALID', 'Unknown collection.', 400);
    const size = Math.max(1, Math.min(Number(limit) || 50, 200));
    const pattern = `%${String(search).slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`;
    let cursor = [Number.MAX_SAFE_INTEGER, '\uffff'];
    if (recent && after) {
      try { cursor = JSON.parse(after); } catch { throw storageError('REQUEST_INVALID','Invalid page cursor.',400); }
      if (!Array.isArray(cursor) || cursor.length !== 2 || !Number.isSafeInteger(cursor[0]) || typeof cursor[1] !== 'string')
        throw storageError('REQUEST_INVALID','Invalid page cursor.',400);
    }
    const code=normalizeCode(sticker);
    const rows = await sql`SELECT collection, id, batch_id, revision,
      (CASE WHEN ${details} THEN payload ELSE summary END) ||
        CASE WHEN collection IN ('laptops','monitors') THEN jsonb_build_object('_completion',jsonb_build_object(
          'graded',EXISTS(SELECT 1 FROM remarkt_records done WHERE done.workspace_id=${workspaceId} AND NOT done.deleted AND done.collection='history' AND done.sticker=r.sticker),
          'labelPrinted',EXISTS(SELECT 1 FROM remarkt_records done WHERE done.workspace_id=${workspaceId} AND NOT done.deleted AND done.collection=CASE WHEN r.collection='laptops' THEN 'labelPrints' ELSE 'monitorLabelPrints' END AND done.sticker=r.sticker))) ELSE '{}'::jsonb END AS payload,
      occurred_ms FROM remarkt_records r
      WHERE workspace_id = ${workspaceId} AND collection = ${collection} AND NOT deleted
        AND (CASE WHEN ${recent} THEN (occurred_ms,id) < (${cursor[0]},${cursor[1]}) ELSE id > ${after} END)
        AND (${batchId} = '' OR batch_id = ${batchId})
        AND (${userId} = '' OR user_id = ${userId})
        AND (${code} = '' OR sticker = ${code})
        AND (${search} = '' OR search_text ILIKE ${pattern})
      ORDER BY CASE WHEN ${recent} THEN occurred_ms END DESC, CASE WHEN ${recent} THEN id END DESC,
        CASE WHEN NOT ${recent} THEN id END ASC LIMIT ${size + 1}`;
    let total;
    if (withTotal) {
      const counters=await sql`SELECT count(*)::int AS total FROM remarkt_records
        WHERE workspace_id=${workspaceId} AND collection=${collection} AND NOT deleted
          AND (${batchId}='' OR batch_id=${batchId}) AND (${userId}='' OR user_id=${userId})
          AND (${code}='' OR sticker=${code}) AND (${search}='' OR search_text ILIKE ${pattern})`;
      total=counters[0].total;
    }
    return { ...(withTotal ? {total} : {}), records: rows.slice(0, size), next: rows.length > size ?
      (recent ? JSON.stringify([Number(rows[size-1].occurred_ms),rows[size-1].id]) : rows[size - 1].id) : null };
  }
  async function detail(collection, id) {
    const rows = await sql`SELECT collection, id, batch_id, revision, payload FROM remarkt_records
      WHERE workspace_id = ${workspaceId} AND collection = ${collection} AND id = ${id} AND NOT deleted`;
    return rows[0] || null;
  }
  async function trace(sticker) {
    const rows=await sql`SELECT collection,id,batch_id,revision,summary AS payload FROM (
      SELECT collection,id,batch_id,revision,summary,row_number() OVER(PARTITION BY collection ORDER BY occurred_ms DESC,id DESC) n
        FROM remarkt_records WHERE workspace_id=${workspaceId} AND NOT deleted AND sticker=${normalizeCode(sticker)}
        AND collection IN ('history','labelPrints','monitorLabelPrints')) matches WHERE n<=50 ORDER BY collection,n DESC`;
    return {records:rows};
  }
  async function changes(since, after = '', limit = 200) {
    const size = Math.max(1, Math.min(Number(limit) || 200, 500));
    const rows = await sql`SELECT collection, id, batch_id, revision, deleted, summary AS payload,
      jsonb_build_array(revision, collection, id)::text AS cursor FROM remarkt_records
      WHERE workspace_id = ${workspaceId} AND revision > ${Number(since) || 0}
        AND (${after} = '' OR (revision, collection, id) >
          ((${after || '[0,"",""]'}::jsonb ->> 0)::bigint, ${after || '[0,"",""]'}::jsonb ->> 1, ${after || '[0,"",""]'}::jsonb ->> 2))
      ORDER BY revision, collection, id LIMIT ${size + 1}`;
    return { recordDelta: true, records: rows.slice(0, size), next: rows.length > size ? rows[size - 1].cursor : null };
  }
  async function exportState() {
    // Explicit backup/migration only, not a routine UI request.
    const [stamp, rows] = await sql.transaction([
      sql`SELECT revision, updated_at FROM remarkt_workspaces WHERE id = ${workspaceId}`,
      sql`SELECT collection, id, batch_id, revision, deleted, payload FROM remarkt_records WHERE workspace_id = ${workspaceId}`,
    ], { isolationLevel: 'RepeatableRead', readOnly: true });
    if (!stamp[0]) throw storageError('STORAGE_NOT_INITIALIZED', 'Workspace missing.');
    const state = recordsToSnapshot(rows, { workspaceId, storageRevision: Number(stamp[0].revision), updatedAt: new Date(stamp[0].updated_at).toISOString() });
    validateSnapshot(state);
    return state;
  }
  return { meta, merge, page, detail, trace, changes, exportState };
}

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { validateSnapshot, storageError } from './storage-safety.mjs';
const checksum = data => createHash('sha256').update(data).digest('hex');
export function makeRecoveryEnvelope(state, key = process.env.REMARKT_BACKUP_KEY) {
  validateSnapshot(state);
  const bytes = gzipSync(Buffer.from(JSON.stringify(state)));
  const manifest = { format: 'remarkt-recovery-v1', exportedAt: new Date().toISOString(), workspaceId: state.workspaceId || '',
    counts: Object.fromEntries(['users','batches','monitorBatches','history','labelPrints','monitorLabelPrints','auditLogs'].map(key => [key, state[key].length])),
    sha256: checksum(bytes) };
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new Error('Set a private 32-byte hex REMARKT_BACKUP_KEY; keep it separate from backups.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from(JSON.stringify(manifest)));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { manifest, encryption: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
}
export function readRecoveryEnvelope(envelope, key = process.env.REMARKT_BACKUP_KEY) {
  try {
    if (envelope?.manifest?.format !== 'remarkt-recovery-v1' || envelope.encryption !== 'aes-256-gcm' || !/^[a-f0-9]{64}$/i.test(key || '')) throw new Error('Invalid envelope or key');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(JSON.stringify(envelope.manifest)));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const bytes = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
    if (checksum(bytes) !== envelope.manifest.sha256) throw new Error('Checksum mismatch');
    const state = validateSnapshot(JSON.parse(gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8')));
    for (const [name, count] of Object.entries(envelope.manifest.counts)) if (state[name]?.length !== count) throw new Error('Count mismatch');
    return state;
  } catch { throw storageError('STORAGE_CORRUPT', 'Recovery file failed authentication or validation. No records restored.'); }
}
export function planRecoveryMerge(current, historical) {
  validateSnapshot(current); validateSnapshot(historical);
  // A recovery never treats absent old records as deletions. Existing identities
  // stay current; conflicting identities need a manager's explicit resolution.
  return import('./record-state.mjs').then(({ snapshotRecords }) => {
    const identity = row => JSON.stringify([row.collection, row.id]);
    const existing = new Map(snapshotRecords(current).map(row => [identity(row), row]));
    const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?
      Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    const additions = [], conflicts = [];
    for (const row of snapshotRecords(historical)) {
      const previous = existing.get(identity(row));
      // Old deletion markers must never delete products in today's workspace.
      // Likewise, deleted products/batches are not resurrected by an old copy.
      const blocked = row.collection.startsWith('deleted') || (!previous && Number(current.recordRevisions?.[identity(row)] || 0)>0) ||
        (['batches','laptops'].includes(row.collection) && (current.deletedBatchIds || []).includes(row.batchId)) ||
        (row.collection === 'laptops' && (current.deletedLaptopStickers || []).includes(String(row.payload.sticker).replace(/^0+(?=[0-9])/,''))) ||
        (['monitorBatches','monitors'].includes(row.collection) && (current.deletedMonitorBatchIds || []).includes(row.batchId)) ||
        (row.collection === 'monitors' && (current.deletedMonitorStickers || []).includes(String(row.payload.sticker).replace(/^0+(?=[0-9])/,'')));
      if (!previous && blocked) conflicts.push({collection:row.collection,id:row.id,reason:'explicit-restoration-required'});
      else if (!previous) additions.push(row);
      else if (JSON.stringify(canonical(previous.payload)) !== JSON.stringify(canonical(row.payload))) conflicts.push({ collection: row.collection, id: row.id });
    }
    return { additions, conflicts, policy: 'existing-records-win; conflicts-not-applied' };
  });
}

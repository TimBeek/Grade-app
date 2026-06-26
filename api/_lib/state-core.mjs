// Pure (storage-agnostic) state logic for the ReMarkt Grading app.
//
// Contains normalisation, merge, transport-envelope and statistics helpers.
// This module has NO external dependencies so it can be imported by both the
// Vercel serverless functions (api/_lib/state.mjs) and the local dev server
// (tools/remarkt-static-server.mjs) without pulling in the KV client.
//
// The normalise/merge logic is the single source of truth for both runtimes.

import zlib from "node:zlib";

const MAX_AUDIT_LOGS = 1000;

// ---------------------------------------------------------------------------
// Transport envelope (gzip + base64 JSON)
// ---------------------------------------------------------------------------

export function encodeState(state) {
  const json = JSON.stringify(state);
  return zlib.gzipSync(Buffer.from(json, "utf8")).toString("base64");
}

export function decodeState(base64) {
  const json = zlib.gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
  return JSON.parse(json);
}

// `{ gzip: "<base64 of gzipped JSON>" }`. A 6.5MB state compresses to ~1.2MB
// (~1.6MB as base64), comfortably under Vercel's ~4.5MB body limit and
// Upstash's per-command limit, without relying on platform compression.
export function toEnvelope(state) {
  return { gzip: encodeState(state) };
}

export function fromBody(body) {
  if (body && typeof body === "object" && typeof body.gzip === "string") {
    return decodeState(body.gzip);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Empty / default state
// ---------------------------------------------------------------------------

export function emptyState() {
  return {
    version: 1,
    userSync: "",
    userSyncAt: null,
    users: [],
    batches: [],
    monitorBatches: [],
    history: [],
    labelPrints: [],
    monitorLabelPrints: [],
    auditLogs: [],
    deletedBatchIds: [],
    deletedLaptopStickers: [],
    deletedMonitorBatchIds: [],
    deletedMonitorStickers: [],
    updatedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Normalisation + merge
// ---------------------------------------------------------------------------

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || "").trim())
    .filter(Boolean)));
}

function withoutValues(values, valuesToRemove) {
  const remove = new Set(valuesToRemove);
  return uniqueStrings(values).filter(value => !remove.has(value));
}

function normalizeStickerCode(value) {
  const compact = String(value || "").trim().replace(/\s+/g, "");
  if (!compact) return "";
  if (/^0+\d+$/.test(compact)) return compact.replace(/^0+/, "") || "0";
  return compact;
}

function userKey(user) {
  return user && user.id ? String(user.id).trim().toLowerCase() : "";
}

function normalizeUserRows(users) {
  return (Array.isArray(users) ? users : [])
    .filter(user => user && typeof user === "object" && userKey(user) && user.passwordHash)
    .map(user => ({
      id: String(user.id || "").trim().toLowerCase(),
      naam: String(user.naam || user.id || "").trim(),
      rol: String(user.rol || "Grader").trim(),
      initialen: String(user.initialen || "").trim(),
      voorkeur: String(user.voorkeur || "").trim(),
      passwordHash: String(user.passwordHash || ""),
      mustChangePassword: user.mustChangePassword === true,
      passwordUpdatedAt: String(user.passwordUpdatedAt || "").trim(),
    }));
}

function normalizeUserMutation(value) {
  if (!value || typeof value !== "object") return null;
  const action = String(value.action || "").trim().toLowerCase();
  const id = String(value.id || "").trim().toLowerCase();
  if (!["create", "update", "delete"].includes(action) || !id) return null;
  return { action, id };
}

export function normalizeDemoState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("State must be an object");
  }
  const version = Number(state.version);
  const userSyncAt = String(state.userSyncAt || "").trim();

  return {
    version: Number.isFinite(version) ? version : 1,
    userSync: state.userSync === "user-management" ? "user-management" : "",
    userSyncAt: userSyncAt || null,
    userMutation: normalizeUserMutation(state.userMutation),
    users: normalizeUserRows(state.users),
    batches: Array.isArray(state.batches) ? state.batches : [],
    monitorBatches: Array.isArray(state.monitorBatches) ? state.monitorBatches : [],
    history: Array.isArray(state.history) ? state.history : [],
    labelPrints: Array.isArray(state.labelPrints) ? state.labelPrints : [],
    monitorLabelPrints: Array.isArray(state.monitorLabelPrints) ? state.monitorLabelPrints : [],
    auditLogs: Array.isArray(state.auditLogs) ? state.auditLogs.slice(-500) : [],
    deletedBatchIds: uniqueStrings(state.deletedBatchIds),
    deletedLaptopStickers: uniqueStrings(state.deletedLaptopStickers).map(normalizeStickerCode),
    deletedMonitorBatchIds: uniqueStrings(state.deletedMonitorBatchIds),
    deletedMonitorStickers: uniqueStrings(state.deletedMonitorStickers).map(normalizeStickerCode),
    restoreDeletedBatchIds: uniqueStrings(state.restoreDeletedBatchIds),
    restoreDeletedLaptopStickers: uniqueStrings(state.restoreDeletedLaptopStickers).map(normalizeStickerCode),
    restoreDeletedMonitorBatchIds: uniqueStrings(state.restoreDeletedMonitorBatchIds),
    restoreDeletedMonitorStickers: uniqueStrings(state.restoreDeletedMonitorStickers).map(normalizeStickerCode),
    updatedAt: new Date().toISOString(),
  };
}

function keyedMerge(existingRows, incomingRows, keyFn) {
  const merged = new Map();
  let anonymousIndex = 0;

  for (const row of Array.isArray(existingRows) ? existingRows : []) {
    const key = keyFn(row) || `existing:${anonymousIndex++}`;
    merged.set(key, row);
  }
  for (const row of Array.isArray(incomingRows) ? incomingRows : []) {
    const key = keyFn(row) || `incoming:${anonymousIndex++}`;
    merged.set(key, row);
  }

  return Array.from(merged.values());
}

function mergeUserRows(existingUsers, incomingUsers, mutation) {
  const existing = new Map();
  const incoming = new Map();

  for (const user of normalizeUserRows(existingUsers)) existing.set(userKey(user), user);
  for (const user of normalizeUserRows(incomingUsers)) incoming.set(userKey(user), user);

  if (!existing.size) return Array.from(incoming.values());
  if (!incoming.size) return Array.from(existing.values());

  if (mutation && mutation.action === "delete") {
    existing.delete(mutation.id);
    return Array.from(existing.values());
  }

  if (mutation && ["create", "update"].includes(mutation.action)) {
    const changedUser = incoming.get(mutation.id);
    if (changedUser) existing.set(mutation.id, changedUser);
    return Array.from(existing.values());
  }

  for (const [id, user] of incoming.entries()) {
    if (!existing.has(id)) existing.set(id, user);
  }
  return Array.from(existing.values());
}

function hasTrustedUserUpdate(state) {
  return Boolean(
    state &&
    state.userSync === "user-management" &&
    Array.isArray(state.users) &&
    state.users.length
  );
}

function batchKey(batch) {
  return batch && (batch.id || batch.nummer) ? String(batch.id || batch.nummer) : "";
}

function historyKey(item) {
  if (!item || typeof item !== "object") return "";
  if (item.id) return String(item.id);
  return [item.sticker, item.serial, item.batchNummer, item.grade, item.user_id, item.tijd]
    .map(value => String(value || "")).join("|");
}

function labelPrintKey(item) {
  if (!item || typeof item !== "object") return "";
  return [normalizeStickerCode(item.sticker), item.batchNummer, item.user_id, item.printedAt]
    .map(value => String(value || "")).join("|");
}

function monitorLabelPrintKey(item) {
  if (!item || typeof item !== "object") return "";
  return [normalizeStickerCode(item.sticker), item.batchNummer, item.grade, item.user_id, item.printedAt]
    .map(value => String(value || "")).join("|");
}

function auditKey(item) {
  if (!item || typeof item !== "object") return "";
  return [item.action, item.entityType, item.entityId, item.userId, item.createdAt]
    .map(value => String(value || "")).join("|");
}

function applyDeletionMarkersToBatches(batches, deletedBatchIds, deletedLaptopStickers) {
  const deletedBatches = new Set(deletedBatchIds);
  const deletedLaptops = new Set(deletedLaptopStickers);
  return (batches || [])
    .filter(batch => batch && !deletedBatches.has(batchKey(batch)))
    .map(batch => ({
      ...batch,
      laptops: Array.isArray(batch.laptops)
        ? batch.laptops.filter(laptop => !deletedLaptops.has(normalizeStickerCode(laptop && laptop.sticker)))
        : [],
    }))
    .filter(batch => batch.laptops.length);
}

function applyDeletionMarkersToMonitorBatches(batches, deletedBatchIds, deletedMonitorStickers) {
  const deletedBatches = new Set(deletedBatchIds);
  const deletedMonitors = new Set(deletedMonitorStickers);
  return (batches || [])
    .filter(batch => batch && !deletedBatches.has(batchKey(batch)))
    .map(batch => ({
      ...batch,
      monitors: Array.isArray(batch.monitors)
        ? batch.monitors.filter(monitor => !deletedMonitors.has(normalizeStickerCode(monitor && monitor.sticker)))
        : [],
    }))
    .filter(batch => batch.monitors.length);
}

export function mergeDemoState(existingState, incomingState) {
  const existing = normalizeDemoState(existingState || {});
  const incoming = normalizeDemoState(incomingState);
  const trustedUserUpdate = hasTrustedUserUpdate(incomingState);
  const deletedBatchIds = withoutValues(
    [...existing.deletedBatchIds, ...incoming.deletedBatchIds],
    incoming.restoreDeletedBatchIds
  );
  const deletedLaptopStickers = withoutValues([
    ...existing.deletedLaptopStickers,
    ...incoming.deletedLaptopStickers,
  ].map(normalizeStickerCode), incoming.restoreDeletedLaptopStickers);
  const deletedMonitorBatchIds = withoutValues(
    [...existing.deletedMonitorBatchIds, ...incoming.deletedMonitorBatchIds],
    incoming.restoreDeletedMonitorBatchIds
  );
  const deletedMonitorStickers = withoutValues([
    ...existing.deletedMonitorStickers,
    ...incoming.deletedMonitorStickers,
  ].map(normalizeStickerCode), incoming.restoreDeletedMonitorStickers);
  const batches = keyedMerge(existing.batches, incoming.batches, batchKey);
  const monitorBatches = keyedMerge(existing.monitorBatches, incoming.monitorBatches, batchKey);

  return {
    version: Math.max(existing.version || 1, incoming.version || 1),
    userSync: trustedUserUpdate ? "user-management" : existing.userSync,
    userSyncAt: trustedUserUpdate ? incoming.userSyncAt : existing.userSyncAt,
    users: trustedUserUpdate
      ? mergeUserRows(existing.users, incoming.users, incoming.userMutation)
      : existing.users,
    batches: applyDeletionMarkersToBatches(batches, deletedBatchIds, deletedLaptopStickers),
    monitorBatches: applyDeletionMarkersToMonitorBatches(monitorBatches, deletedMonitorBatchIds, deletedMonitorStickers),
    history: keyedMerge(existing.history, incoming.history, historyKey),
    labelPrints: keyedMerge(existing.labelPrints, incoming.labelPrints, labelPrintKey),
    monitorLabelPrints: keyedMerge(existing.monitorLabelPrints, incoming.monitorLabelPrints, monitorLabelPrintKey),
    auditLogs: keyedMerge(existing.auditLogs, incoming.auditLogs, auditKey).slice(-MAX_AUDIT_LOGS),
    deletedBatchIds,
    deletedLaptopStickers,
    deletedMonitorBatchIds,
    deletedMonitorStickers,
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Dashboard statistics
// ---------------------------------------------------------------------------

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function topCounts(map, limit) {
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

// Server-side authoritative KPIs computed straight from the stored data.
export function computeStats(state) {
  const history = Array.isArray(state.history) ? state.history : [];
  const batches = Array.isArray(state.batches) ? state.batches : [];
  const monitorBatches = Array.isArray(state.monitorBatches) ? state.monitorBatches : [];

  const totalLaptops = batches.reduce(
    (sum, batch) => sum + (Array.isArray(batch.laptops) ? batch.laptops.length : 0), 0);
  const totalMonitors = monitorBatches.reduce(
    (sum, batch) => sum + (Array.isArray(batch.monitors) ? batch.monitors.length : 0), 0);

  const gradeDistribution = {};
  const perUser = new Map();
  const perSupplier = new Map();
  const perDay = new Map();
  let repairCount = 0;
  let totalDurationSec = 0;
  let durationSamples = 0;

  for (const item of history) {
    const grade = String(item.grade || "?").trim() || "?";
    gradeDistribution[grade] = (gradeDistribution[grade] || 0) + 1;
    if (/repair|reparat|^x$/i.test(grade)) repairCount += 1;

    const user = String(item.user_naam || item.user_id || "Onbekend").trim() || "Onbekend";
    perUser.set(user, (perUser.get(user) || 0) + 1);

    const supplier = String(item.leverancier || item.batchNummer || "Onbekend").trim() || "Onbekend";
    perSupplier.set(supplier, (perSupplier.get(supplier) || 0) + 1);

    const day = dayKey(item.savedAt || item.createdAt || item.datum || item.tijdstip);
    if (day) perDay.set(day, (perDay.get(day) || 0) + 1);

    const duration = Number(item.duurSec);
    if (Number.isFinite(duration) && duration > 0) {
      totalDurationSec += duration;
      durationSamples += 1;
    }
  }

  const totalGraded = history.length;

  return {
    generatedAt: new Date().toISOString(),
    updatedAt: state.updatedAt || null,
    totals: {
      graded: totalGraded,
      laptopsInVoorraad: totalLaptops,
      monitorsInVoorraad: totalMonitors,
      batches: batches.length,
      monitorBatches: monitorBatches.length,
      users: Array.isArray(state.users) ? state.users.length : 0,
      labelPrints: Array.isArray(state.labelPrints) ? state.labelPrints.length : 0,
      monitorLabelPrints: Array.isArray(state.monitorLabelPrints) ? state.monitorLabelPrints.length : 0,
      repair: repairCount,
      repairRatePct: totalGraded ? Math.round((repairCount / totalGraded) * 1000) / 10 : 0,
      avgDurationSec: durationSamples ? Math.round(totalDurationSec / durationSamples) : null,
    },
    gradeDistribution,
    perUser: topCounts(perUser, 20),
    perSupplier: topCounts(perSupplier, 20),
    perDay: Array.from(perDay.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

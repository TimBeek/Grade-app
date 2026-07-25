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
  return [normalizeStickerCode(item.sticker), item.batchId || item.batchNummer]
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

// Real timestamp (ms) for a grading item: prefer an explicit date field, else
// recover it from the id (grading_<ms>_<sticker>) used by all existing data.
function historyTimestampMs(item) {
  if (!item) return null;
  const direct = Date.parse(item.savedAt || item.createdAt || item.completedAt || item.printedAt || "");
  if (Number.isFinite(direct)) return direct;
  const match = String(item.id || "").match(/(\d{13})/);
  if (match) {
    const ms = Number(match[1]);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function dayKeyFromMs(ms) {
  if (ms === null) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function topCounts(map, limit) {
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function computeMonitorTimingStats(records) {
  const idleMs = 20 * 60 * 1000;
  const measured = [];
  let interrupted = 0;
  for (const item of records) {
    const startMs = Date.parse(item && item.startedAt || "");
    const endMs = Date.parse(item && (item.firstPrintedAt || item.printedAt) || "");
    const storedDuration = Number(item && item.durationSec);
    const durationSec = Number.isFinite(storedDuration) && storedDuration > 0
      ? storedDuration
      : Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
        ? Math.max(1, Math.round((endMs - startMs) / 1000))
        : 0;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || durationSec <= 0) continue;
    if (durationSec * 1000 > idleMs) {
      interrupted += 1;
      continue;
    }
    measured.push({
      startMs,
      endMs,
      employee: String(item.user_id || item.user_naam || "unknown"),
    });
  }

  const sessions = [];
  const perEmployee = new Map();
  for (const event of measured) {
    const rows = perEmployee.get(event.employee) || [];
    rows.push(event);
    perEmployee.set(event.employee, rows);
  }
  for (const [employee, events] of perEmployee) {
    events.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    let current = null;
    for (const event of events) {
      const gapMs = current ? Math.max(0, event.startMs - current.endMs) : Infinity;
      if (!current || gapMs > idleMs) {
        current = { employee, startMs: event.startMs, endMs: event.endMs, units: 1 };
        sessions.push(current);
      } else {
        current.endMs = Math.max(current.endMs, event.endMs);
        current.units += 1;
      }
    }
  }

  const activeSec = sessions.reduce(
    (sum, session) => sum + Math.max(1, Math.round((session.endMs - session.startMs) / 1000)),
    0
  );
  return {
    measured: measured.length,
    sessions: sessions.length,
    interrupted,
    coveragePct: records.length ? Math.round((measured.length / records.length) * 100) : 0,
    avgActiveSec: measured.length ? Math.round(activeSec / measured.length) : null,
  };
}

// Server-side authoritative KPIs computed straight from the stored data.
export function computeStats(state) {
  const history = Array.isArray(state.history) ? state.history : [];
  const labelPrints = Array.isArray(state.labelPrints) ? state.labelPrints : [];
  const auditLogs = Array.isArray(state.auditLogs) ? state.auditLogs : [];
  const monitorPrintMap = new Map();
  for (const item of Array.isArray(state.monitorLabelPrints) ? state.monitorLabelPrints : []) {
    const key = monitorLabelPrintKey(item);
    if (key) monitorPrintMap.set(key, item);
  }
  const monitorLabelPrints = Array.from(monitorPrintMap.values());
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
  let gradedToday = 0;
  let gradedLast7Days = 0;
  let laptopToday = 0;
  let monitorToday = 0;
  const activity = [];

  const todayKey = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();
  const weekAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;

  for (const item of history) {
    const grade = String(item.grade || "?").trim() || "?";
    gradeDistribution[grade] = (gradeDistribution[grade] || 0) + 1;
    if (/repair|reparat|^x$/i.test(grade)) repairCount += 1;

    const user = String(item.user_naam || item.user_id || "Onbekend").trim() || "Onbekend";
    perUser.set(user, (perUser.get(user) || 0) + 1);

    const supplier = String(item.leverancier || item.batchNummer || "Onbekend").trim() || "Onbekend";
    perSupplier.set(supplier, (perSupplier.get(supplier) || 0) + 1);

    const ms = historyTimestampMs(item);
    const day = dayKeyFromMs(ms);
    if (day) {
      perDay.set(day, (perDay.get(day) || 0) + 1);
      if (day === todayKey) {
        gradedToday += 1;
        laptopToday += 1;
      }
      if (ms >= weekAgoMs) gradedLast7Days += 1;
    }
    if (ms !== null) {
      activity.push({
        at: new Date(ms).toISOString(),
        ms,
        kind: "laptop",
        sticker: String(item.sticker || ""),
        device: [item.merk, item.model].filter(Boolean).join(" ").trim() || String(item.sticker || "Laptop"),
        user,
        grade,
      });
    }

    const duration = Number(item.duurSec);
    if (Number.isFinite(duration) && duration > 0) {
      totalDurationSec += duration;
      durationSamples += 1;
    }
  }

  for (const item of monitorLabelPrints) {
    const grade = String(item.grade || "?").trim() || "?";
    gradeDistribution[grade] = (gradeDistribution[grade] || 0) + 1;
    if (/repair|reparat|^[dx]$/i.test(grade)) repairCount += 1;

    const user = String(item.user_naam || item.user_id || "Onbekend").trim() || "Onbekend";
    perUser.set(user, (perUser.get(user) || 0) + 1);

    const ms = Date.parse(item.firstPrintedAt || item.printedAt || "");
    const day = dayKeyFromMs(Number.isFinite(ms) ? ms : null);
    if (day) {
      perDay.set(day, (perDay.get(day) || 0) + 1);
      if (day === todayKey) {
        gradedToday += 1;
        monitorToday += 1;
      }
      if (ms >= weekAgoMs) gradedLast7Days += 1;
    }
    if (Number.isFinite(ms)) {
      activity.push({
        at: new Date(ms).toISOString(),
        ms,
        kind: "monitor",
        sticker: String(item.sticker || ""),
        device: String(item.deviceName || [item.merk, item.model].filter(Boolean).join(" ").trim() || item.sticker || "Monitor"),
        user,
        grade,
      });
    }
  }

  const monitorTiming = computeMonitorTimingStats(monitorLabelPrints);
  const totalGraded = history.length + monitorLabelPrints.length;
  activity.sort((a, b) => b.ms - a.ms);
  const lastHour = activity.filter(item => item.ms >= nowMs - 60 * 60 * 1000);
  const activeWindow = activity.filter(item => item.ms >= nowMs - 30 * 60 * 1000);
  const activeOperatorNames = Array.from(new Set(activeWindow.map(item => item.user).filter(Boolean)));
  const todayActivity = activity.filter(item => dayKeyFromMs(item.ms) === todayKey);
  const exceptionsToday = todayActivity.filter(item => /^[dx]$/i.test(item.grade) || /repair|reparat/i.test(item.grade)).length;

  const digitallyComplete = new Set();
  for (const item of history) {
    const sticker = normalizeStickerCode(item && item.sticker);
    if (sticker) digitallyComplete.add(sticker);
  }
  for (const item of labelPrints) {
    const sticker = normalizeStickerCode(item && item.sticker);
    if (sticker) digitallyComplete.add(sticker);
  }

  const physicallyVerified = new Set();
  for (const batch of batches) {
    const review = batch && batch.completionReview;
    if (!review || review.status !== "physically_complete") continue;
    for (const sticker of Array.isArray(review.verifiedStickers) ? review.verifiedStickers : []) {
      const normalized = normalizeStickerCode(sticker);
      if (normalized) physicallyVerified.add(normalized);
    }
  }

  const printAttemptStickers = new Set();
  for (const item of auditLogs) {
    if (!item || item.entityType !== "laptop") continue;
    if (!["print_label", "print_label_failed", "print_label_attempt", "print_label_fallback_opened"].includes(item.action)) continue;
    const sticker = normalizeStickerCode(item.entityId);
    if (sticker) printAttemptStickers.add(sticker);
  }

  let digitalGaps = 0;
  let unresolvedGaps = 0;
  let verifiedGaps = 0;
  let printAttemptGaps = 0;
  const batchHealth = [];
  for (const batch of batches) {
    const laptops = Array.isArray(batch && batch.laptops) ? batch.laptops : [];
    let batchDigitalGaps = 0;
    let batchUnresolved = 0;
    let batchVerified = 0;
    let batchPrintAttempts = 0;
    for (const laptop of laptops) {
      const sticker = normalizeStickerCode(laptop && laptop.sticker);
      if (!sticker || digitallyComplete.has(sticker)) continue;
      batchDigitalGaps += 1;
      if (physicallyVerified.has(sticker)) batchVerified += 1;
      else batchUnresolved += 1;
      if (printAttemptStickers.has(sticker)) batchPrintAttempts += 1;
    }
    digitalGaps += batchDigitalGaps;
    unresolvedGaps += batchUnresolved;
    verifiedGaps += batchVerified;
    printAttemptGaps += batchPrintAttempts;
    batchHealth.push({
      id: String(batch && (batch.id || batch.nummer) || ""),
      label: String(batch && batch.nummer || "Batch"),
      total: laptops.length,
      digitalDone: Math.max(laptops.length - batchDigitalGaps, 0),
      digitalGaps: batchDigitalGaps,
      unresolvedGaps: batchUnresolved,
      verifiedGaps: batchVerified,
      printAttemptGaps: batchPrintAttempts,
      physicallyComplete: laptops.length > 0 && batchUnresolved === 0,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    updatedAt: state.updatedAt || null,
    totals: {
      graded: totalGraded,
      laptopGraded: history.length,
      monitorGraded: monitorLabelPrints.length,
      gradedToday,
      gradedLast7Days,
      laptopsInVoorraad: totalLaptops,
      monitorsInVoorraad: totalMonitors,
      batches: batches.length,
      monitorBatches: monitorBatches.length,
      users: Array.isArray(state.users) ? state.users.length : 0,
      labelPrints: Array.isArray(state.labelPrints) ? state.labelPrints.length : 0,
      monitorLabelPrints: monitorLabelPrints.length,
      repair: repairCount,
      repairRatePct: totalGraded ? Math.round((repairCount / totalGraded) * 1000) / 10 : 0,
      avgDurationSec: durationSamples ? Math.round(totalDurationSec / durationSamples) : null,
      laptopAvgDurationSec: durationSamples ? Math.round(totalDurationSec / durationSamples) : null,
      monitorAvgActiveSec: monitorTiming.avgActiveSec,
      monitorTimingCoveragePct: monitorTiming.coveragePct,
      monitorTimingSamples: monitorTiming.measured,
      monitorSessions: monitorTiming.sessions,
    },
    live: {
      today: gradedToday,
      laptopToday,
      monitorToday,
      lastHour: lastHour.length,
      activeOperators30m: activeOperatorNames.length,
      activeOperatorNames,
      exceptionsToday,
      lastActivity: activity[0] || null,
      dataHealth: {
        digitalGaps,
        unresolvedGaps,
        verifiedGaps,
        printAttemptGaps,
        healthy: digitalGaps === 0,
      },
      batchHealth,
    },
    gradeDistribution,
    perUser: topCounts(perUser, 20),
    perSupplier: topCounts(perSupplier, 20),
    perDay: Array.from(perDay.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

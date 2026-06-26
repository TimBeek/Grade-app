import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fromBody, toEnvelope, computeStats } from "../api/_lib/state-core.mjs";

const root = process.cwd();
const port = Number(process.env.PORT || 8080);
const appShellFile = fs.existsSync(path.join(root, "index.html"))
  ? "index.html"
  : "remarkt-grading-app.html";
const dataDir = path.join(root, "data");
const demoStatePath = path.join(dataDir, "remarkt-demo-state.json");
const userStorePath = path.join(dataDir, "remarkt-users.json");
const backupDir = path.join(dataDir, "backups");
const maxBackups = 10;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
};

function getCacheControl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico"].includes(ext)) {
    return "public, max-age=604800";
  }
  return "no-cache";
}

function sendText(response, status, body) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

async function readDemoState() {
  let state;
  try {
    state = JSON.parse(await fs.promises.readFile(demoStatePath, "utf8"));
  } catch {
    state = {
      version: 1,
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
  return withStoredUsers(state);
}

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

function timestampValue(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeUserStorePayload(payload) {
  const users = normalizeUserRows(Array.isArray(payload) ? payload : payload && payload.users);
  const userSyncAt = String(payload && payload.userSyncAt || "").trim();
  return {
    userSync: users.length ? "user-management" : "",
    userSyncAt: userSyncAt || null,
    users,
  };
}

async function readUserStore() {
  try {
    return normalizeUserStorePayload(JSON.parse(await fs.promises.readFile(userStorePath, "utf8")));
  } catch {
    return { userSync: "", userSyncAt: null, users: [] };
  }
}

async function withStoredUsers(state) {
  const stored = await readUserStore();
  if (!stored.users.length) return state;
  const stateUserTime = timestampValue(state && state.userSyncAt);
  const storedUserTime = timestampValue(stored.userSyncAt);
  if (Array.isArray(state.users) && state.users.length && stateUserTime > storedUserTime) return state;
  return {
    ...state,
    userSync: "user-management",
    userSyncAt: stored.userSyncAt || state.userSyncAt || state.updatedAt || null,
    users: stored.users,
  };
}

async function writeUserStoreFromState(state) {
  const users = normalizeUserRows(state && state.users);
  if (!users.length) return;
  await fs.promises.mkdir(dataDir, { recursive: true });
  const payload = {
    userSync: "user-management",
    userSyncAt: state.userSyncAt || state.updatedAt || new Date().toISOString(),
    users,
  };
  const tempPath = `${userStorePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.promises.rename(tempPath, userStorePath);
}

function normalizeDemoState(state) {
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

  for (const user of normalizeUserRows(existingUsers)) {
    existing.set(userKey(user), user);
  }
  for (const user of normalizeUserRows(incomingUsers)) {
    incoming.set(userKey(user), user);
  }

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
  return [
    item.sticker,
    item.serial,
    item.batchNummer,
    item.grade,
    item.user_id,
    item.tijd,
  ].map(value => String(value || "")).join("|");
}

function labelPrintKey(item) {
  if (!item || typeof item !== "object") return "";
  return [
    normalizeStickerCode(item.sticker),
    item.batchNummer,
    item.user_id,
    item.printedAt,
  ].map(value => String(value || "")).join("|");
}

function monitorLabelPrintKey(item) {
  if (!item || typeof item !== "object") return "";
  return [
    normalizeStickerCode(item.sticker),
    item.batchNummer,
    item.grade,
    item.user_id,
    item.printedAt,
  ].map(value => String(value || "")).join("|");
}

function batchKeys(batches) {
  return uniqueStrings((Array.isArray(batches) ? batches : []).map(batchKey));
}

function laptopStickersFromBatches(batches) {
  return uniqueStrings((Array.isArray(batches) ? batches : []).flatMap(batch => (
    Array.isArray(batch && batch.laptops) ? batch.laptops.map(laptop => normalizeStickerCode(laptop && laptop.sticker)) : []
  )));
}

function monitorStickersFromBatches(batches) {
  return uniqueStrings((Array.isArray(batches) ? batches : []).flatMap(batch => (
    Array.isArray(batch && batch.monitors) ? batch.monitors.map(monitor => normalizeStickerCode(monitor && monitor.sticker)) : []
  )));
}

function auditKey(item) {
  if (!item || typeof item !== "object") return "";
  return [
    item.action,
    item.entityType,
    item.entityId,
    item.userId,
    item.createdAt,
  ].map(value => String(value || "")).join("|");
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

function mergeDemoState(existingState, incomingState) {
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
    auditLogs: keyedMerge(existing.auditLogs, incoming.auditLogs, auditKey).slice(-1000),
    deletedBatchIds,
    deletedLaptopStickers,
    deletedMonitorBatchIds,
    deletedMonitorStickers,
    updatedAt: new Date().toISOString(),
  };
}

async function backupExistingState() {
  try {
    await fs.promises.access(demoStatePath, fs.constants.F_OK);
  } catch {
    return;
  }

  await fs.promises.mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.promises.copyFile(demoStatePath, path.join(backupDir, `remarkt-demo-state-${stamp}.json`));

  const backups = await fs.promises.readdir(backupDir);
  const stateBackups = backups
    .filter(name => name.startsWith("remarkt-demo-state-") && name.endsWith(".json"))
    .sort()
    .reverse();

  await Promise.all(
    stateBackups.slice(maxBackups).map(name => fs.promises.rm(path.join(backupDir, name), { force: true }))
  );
}

async function writeDemoState(state) {
  await fs.promises.mkdir(dataDir, { recursive: true });
  const existing = await readDemoState();
  await backupExistingState();
  const normalized = mergeDemoState(existing, state);
  const tempPath = `${demoStatePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(normalized, null, 2), "utf8");
  await fs.promises.rename(tempPath, demoStatePath);
  await writeUserStoreFromState(normalized);
  return normalized;
}

async function handleDemoStateApi(request, response) {
  if (request.method === "GET") {
    const state = await readDemoState();
    // Mirror the Vercel API: cheap change-check on ?meta=1, plain on ?raw=1,
    // gzip envelope by default.
    if (/[?&]meta=1\b/.test(request.url || "")) {
      sendJson(response, 200, { updatedAt: state.updatedAt || null });
      return true;
    }
    const raw = /[?&]raw=1\b/.test(request.url || "");
    sendJson(response, 200, raw ? state : toEnvelope(state));
    return true;
  }

  if (request.method === "POST") {
    try {
      const state = fromBody(await readJsonBody(request));
      const saved = await writeDemoState(state);
      sendJson(response, 200, { ok: true, updatedAt: saved.updatedAt });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return true;
  }

  sendJson(response, 405, { ok: false, error: "Method not allowed" });
  return true;
}

async function handleHealthApi(response) {
  const state = await readDemoState();
  sendJson(response, 200, {
    ok: true,
    service: "remarkt-grading",
    port,
    statePath: demoStatePath,
    updatedAt: state.updatedAt,
    counts: {
      users: Array.isArray(state.users) ? state.users.length : 0,
      batches: Array.isArray(state.batches) ? state.batches.length : 0,
      monitorBatches: Array.isArray(state.monitorBatches) ? state.monitorBatches.length : 0,
      history: Array.isArray(state.history) ? state.history.length : 0,
      labelPrints: Array.isArray(state.labelPrints) ? state.labelPrints.length : 0,
      monitorLabelPrints: Array.isArray(state.monitorLabelPrints) ? state.monitorLabelPrints.length : 0,
      auditLogs: Array.isArray(state.auditLogs) ? state.auditLogs.length : 0,
    },
  });
}

http
  .createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      let requestedPath = decodeURIComponent(url.pathname);

      if (requestedPath === "/api/demo-state") {
        await handleDemoStateApi(request, response);
        return;
      }

      if (requestedPath === "/api/health") {
        await handleHealthApi(response);
        return;
      }

      if (requestedPath === "/api/stats") {
        const state = await readDemoState();
        sendJson(response, 200, computeStats(state));
        return;
      }

      if (
        requestedPath === "/" ||
        requestedPath === "/remarkt-grading-app" ||
        requestedPath === "/remarkt-grading-app.html"
      ) {
        requestedPath = `/${appShellFile}`;
      }

      const filePath = path.normalize(path.join(root, requestedPath));
      const relativePath = path.relative(root, filePath);

      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        sendText(response, 403, "Forbidden");
        return;
      }

      fs.stat(filePath, (error, stat) => {
        if (error || !stat.isFile()) {
          sendText(response, 404, "Not found");
          return;
        }

        response.writeHead(200, {
          "Content-Type":
            contentTypes[path.extname(filePath).toLowerCase()] ||
            "application/octet-stream",
          "Cache-Control": getCacheControl(filePath),
        });
        fs.createReadStream(filePath).pipe(response);
      });
    } catch {
      sendText(response, 500, "Server error");
    }
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`ReMarkt Grading live op http://localhost:${port}/`);
  });

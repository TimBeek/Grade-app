// One-off migration: import the existing file-based demo state into Vercel KV.
//
// Usage:
//   1. Put the KV credentials in a .env / .env.local at the project root
//      (KV_REST_API_URL=... and KV_REST_API_TOKEN=...) or export them.
//   2. node scripts/migrate-to-kv.mjs            (merges into existing KV data)
//      node scripts/migrate-to-kv.mjs --fresh    (overwrites with file data only)
//
// Re-running is safe: the merge logic de-duplicates batches, history and
// label prints by key, so nothing is doubled.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// Minimal .env loader (no dependency) so credentials can live in a file.
function loadEnvFile(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const { isKvConfigured, kvReadState, kvWriteState, mergeDemoState, emptyState } =
  await import("../api/_lib/state.mjs");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  if (!isKvConfigured()) {
    console.error(
      "✗ KV is niet geconfigureerd. Zet KV_REST_API_URL en KV_REST_API_TOKEN in .env / .env.local of in je shell."
    );
    process.exit(1);
  }

  const fresh = process.argv.includes("--fresh");
  const fileState = readJson("data/remarkt-demo-state.json", null);
  if (!fileState) {
    console.error("✗ data/remarkt-demo-state.json niet gevonden of ongeldig.");
    process.exit(1);
  }

  // Make sure the stored users (separate file) ride along as a trusted update.
  const userStore = readJson("data/remarkt-users.json", null);
  const users = Array.isArray(fileState.users) && fileState.users.length
    ? fileState.users
    : (userStore && Array.isArray(userStore.users) ? userStore.users : (Array.isArray(userStore) ? userStore : []));

  const incoming = {
    ...fileState,
    users,
    userSync: users.length ? "user-management" : fileState.userSync || "",
    userSyncAt:
      fileState.userSyncAt ||
      (userStore && userStore.userSyncAt) ||
      fileState.updatedAt ||
      new Date().toISOString(),
  };

  const base = fresh ? emptyState() : await kvReadState();
  const merged = mergeDemoState(base, incoming);
  await kvWriteState(merged);

  console.log(`✓ Migratie klaar (${fresh ? "fresh" : "merge"}). Opgeslagen in KV:`);
  console.log(`  gebruikers:        ${merged.users.length}`);
  console.log(`  batches:           ${merged.batches.length}`);
  console.log(`  monitorbatches:    ${merged.monitorBatches.length}`);
  console.log(`  history:           ${merged.history.length}`);
  console.log(`  labelPrints:       ${merged.labelPrints.length}`);
  console.log(`  monitorLabelPrints:${merged.monitorLabelPrints.length}`);
  console.log(`  auditLogs:         ${merged.auditLogs.length}`);
  console.log(`  updatedAt:         ${merged.updatedAt}`);
}

main().catch(error => {
  console.error("✗ Migratie mislukt:", error);
  process.exit(1);
});

// Seeds Neon Postgres with a known local backup. Use only for a fresh
// emergency workspace; the later Redis recovery uses a merge, not --fresh.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || match[1] in process.env) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const { isPostgresConfigured, kvReadState, kvWriteState, mergeDemoState, emptyState } =
  await import("../api/_lib/state.mjs");

const file = path.join(root, "data", "remarkt-demo-state.json");
if (!isPostgresConfigured()) throw new Error("DATABASE_URL is missing. Connect Neon in Vercel first.");
if (!fs.existsSync(file)) throw new Error("Local recovery snapshot was not found.");

const incoming = JSON.parse(fs.readFileSync(file, "utf8"));
const current = process.argv.includes("--fresh") ? emptyState() : await kvReadState();
const merged = mergeDemoState(current, incoming);
await kvWriteState(merged);

const laptopCount = merged.batches.reduce((sum, batch) => sum + (batch.laptops || []).length, 0);
const monitorCount = merged.monitorBatches.reduce((sum, batch) => sum + (batch.monitors || []).length, 0);
console.log(JSON.stringify({
  users: merged.users.length,
  batches: merged.batches.length,
  laptops: laptopCount,
  monitorBatches: merged.monitorBatches.length,
  monitors: monitorCount,
  history: merged.history.length,
  updatedAt: merged.updatedAt,
}, null, 2));

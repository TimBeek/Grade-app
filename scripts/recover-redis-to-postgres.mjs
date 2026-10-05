// One-off safe recovery: merge the old Upstash/Redis production document into
// the active Neon/Postgres document after Redis becomes available again.
// It never deletes either source and de-duplicates the normal app records.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";
import { decodeState, emptyState, mergeDemoState, normalizeDemoState } from "../api/_lib/state-core.mjs";
import { isPostgresConfigured, pgReadState, pgWriteState } from "../api/_lib/postgres-state.mjs";
import { planRecoveryMerge } from '../api/_lib/recovery-envelope.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadEnvFile(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || match[1] in process.env) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

if (!isPostgresConfigured()) throw new Error("DATABASE_URL is missing. Connect Neon before recovery.");
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
if (!url || !token) throw new Error("Redis credentials are missing.");

const redis = new Redis({ url, token });
const meta = await redis.get("remarkt:state:meta");
if (!meta || typeof meta.chunks !== "number" || meta.chunks < 1) throw new Error("Redis state is empty or unavailable.");
const keys = Array.from({ length: meta.chunks }, (_, index) => `remarkt:state:${index}`);
const chunks = await redis.mget(...keys);
const base64 = chunks.map(value => typeof value === "string" ? value : "").join("");
if (!base64) throw new Error("Redis state chunks could not be read.");

const recovered = normalizeDemoState(decodeState(base64));
const current = await pgReadState();
const plan = await planRecoveryMerge(current, recovered);
console.log(JSON.stringify({ additions: plan.additions.length, conflicts: plan.conflicts, policy: plan.policy }, null, 2));
// Historical recovery must not silently overwrite newer jobs. Applying a
// reviewed plan belongs to a separate, revision-checked administrative action.
if (process.argv.includes('--apply')) throw new Error('Automatic historical overwrite disabled. Review the merge plan and apply missing identities through record mutations.');
const merged = current;

console.log(JSON.stringify({
  users: merged.users.length,
  batches: merged.batches.length,
  monitorBatches: merged.monitorBatches.length,
  history: merged.history.length,
  labelPrints: merged.labelPrints.length,
  monitorLabelPrints: merged.monitorLabelPrints.length,
  updatedAt: merged.updatedAt,
}, null, 2));

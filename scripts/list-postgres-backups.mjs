// Lists the bounded, automatic Neon recovery points. This script only reads.

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');
const { isPostgresConfigured, pgListBackups } = await import('../api/_lib/postgres-state.mjs');
if (!isPostgresConfigured()) throw new Error('DATABASE_URL is missing. Connect Neon first.');

console.log(JSON.stringify(await pgListBackups(), null, 2));

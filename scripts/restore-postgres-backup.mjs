// Restores one explicit Neon recovery point. It never guesses which snapshot
// to use: first run `npm run backups:postgres`, then pass its exact id.

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

const backupId = process.argv[2];
if (!backupId) throw new Error('Usage: npm run restore:postgres -- <backup-id>');

loadEnvFile('.env');
loadEnvFile('.env.local');
const { isPostgresConfigured, pgRestoreBackup } = await import('../api/_lib/postgres-state.mjs');
if (!isPostgresConfigured()) throw new Error('DATABASE_URL is missing. Connect Neon first.');

const restored = await pgRestoreBackup(backupId);
console.log(JSON.stringify({
  restoredBackupId: Number(backupId),
  users: restored.users.length,
  batches: restored.batches.length,
  monitorBatches: restored.monitorBatches.length,
  history: restored.history.length,
  updatedAt: restored.updatedAt,
}, null, 2));

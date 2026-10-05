// Never writes the database. Current records win; collisions are reported.
import fs from 'node:fs/promises';
import { readRecoveryEnvelope, planRecoveryMerge } from '../api/_lib/recovery-envelope.mjs';
import { loadEnv } from './_lib/env.mjs';
loadEnv(process.env.REMARKT_ENV_FILE || '.env.local');
const [currentFile, oldFile] = process.argv.slice(2);
if (!currentFile || !oldFile) throw new Error('Usage: node scripts/plan-recovery-merge.mjs <current-backup> <historical-backup>');
const current = readRecoveryEnvelope(JSON.parse(await fs.readFile(currentFile, 'utf8')));
const old = readRecoveryEnvelope(JSON.parse(await fs.readFile(oldFile, 'utf8')));
if (current._incrementalFrom || old._incrementalFrom) throw new Error('Reconstruct an incremental chain before planning a merge.');
const plan = await planRecoveryMerge(current, old);
console.log(JSON.stringify({ additions: plan.additions.length, conflicts: plan.conflicts, policy: plan.policy }, null, 2));

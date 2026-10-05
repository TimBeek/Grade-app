// Decrypt and reconstruct on this machine; never writes a production database.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from './_lib/env.mjs';
import { readRecoveryEnvelope } from '../api/_lib/recovery-envelope.mjs';
import { restoreRecoveryChain } from './_lib/recovery-chain.mjs';
loadEnv(process.env.REMARKT_ENV_FILE || '.env.local');
let files = process.argv.slice(2);
if (!files.length) throw new Error('Pass the full checkpoint and ordered incremental recovery files.');
if(files.length===1 && (await fs.stat(files[0])).isDirectory()) {
  const directory=files[0];
  files=(await fs.readdir(directory)).filter(name=>/^recovery-[a-zA-Z0-9_-]+-\d+-\d+\.json$/.test(name)).map(name=>path.join(directory,name));
}
const states = await Promise.all(files.map(async file => readRecoveryEnvelope(JSON.parse(await fs.readFile(file, 'utf8')))));
states.sort((a,b)=>a.storageRevision-b.storageRevision);
const state = restoreRecoveryChain(states);
console.log(JSON.stringify({ verified: true, workspaceId: state.workspaceId, revision: state.storageRevision,
  counts: Object.fromEntries(['users','batches','history','labelPrints','monitorLabelPrints','auditLogs'].map(key => [key, state[key].length])) }));

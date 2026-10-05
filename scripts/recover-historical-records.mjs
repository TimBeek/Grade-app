// Explicit, additive historical recovery. Old providers are NEVER written.
// Default is a read-only plan; current records and deletion tombstones win.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {loadEnv} from './_lib/env.mjs';
import {createRecordStore} from '../api/_lib/record-state.mjs';
import {validateSnapshot} from '../api/_lib/storage-safety.mjs';
import {makeRecoveryEnvelope,readRecoveryEnvelope,planRecoveryMerge} from '../api/_lib/recovery-envelope.mjs';
loadEnv(process.env.REMARKT_ENV_FILE);
const args=process.argv.slice(2),file=args[0];
if(!file || file.startsWith('--'))throw new Error('Specify a full historical export file; accounts-only documents are insufficient.');
const body=JSON.parse(await fs.readFile(file,'utf8'));
if(body._recoveryScope==='accounts-only')throw new Error('This file contains accounts only, not historical work.');
const old=body.manifest?readRecoveryEnvelope(body,process.env.REMARKT_HISTORICAL_BACKUP_KEY || process.env.REMARKT_BACKUP_KEY):validateSnapshot(body);
if(old._incrementalFrom!==undefined)throw new Error('Reconstruct historical increments before recovery.');
const workspace=process.env.REMARKT_WORKSPACE_ID;
if(!workspace || !process.env.REMARKT_DATABASE_URL)throw new Error('Explicit active record workspace and private connection required.');
const sql=neon(process.env.REMARKT_DATABASE_URL),store=createRecordStore(sql,workspace);
const current=await store.exportState(),plan=await planRecoveryMerge(current,old);
console.log(JSON.stringify({planOnly:!args.includes('--apply'),currentRevision:current.storageRevision,
  additions:plan.additions.length,conflicts:plan.conflicts.length,policy:plan.policy,
  byCollection:plan.additions.reduce((out,row)=>(out[row.collection]=(out[row.collection]||0)+1,out),{})}));
if(!args.includes('--apply'))process.exit(0);
if(!args.includes('--confirm-workspace') || args[args.indexOf('--confirm-workspace')+1]!==workspace)throw new Error('Confirm the exact active workspace before applying additions.');
const directory=process.env.REMARKT_BACKUP_DIR;
if(!directory || !path.isAbsolute(directory))throw new Error('External encrypted recovery point required before applying.');
const checkpoint=path.join(directory,`before-historical-recovery-${workspace}-${Date.now()}.json`);
const envelope=makeRecoveryEnvelope(current);readRecoveryEnvelope(envelope);
await fs.writeFile(checkpoint,JSON.stringify(envelope),{flag:'wx',mode:0o600});
let added=0;
for(let i=0;i<plan.additions.length;i+=200) {
  // expectedRevision=0 rejects concurrent inserts or tombstones instead of
  // replacing anything. A conflict stops this chunk atomically; rerun the plan.
  const result=await store.merge({mutationId:randomUUID(),operations:plan.additions.slice(i,i+200).map(row=>({...row,expectedRevision:0}))});
  added+=result.changed;
}
console.log(JSON.stringify({applied:true,added,conflictsNotApplied:plan.conflicts.length,checkpointCreated:true}));

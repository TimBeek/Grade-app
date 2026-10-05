// Verify a REAL encrypted external chain in a disposable in-memory Postgres.
// Deliberately has no Neon URL/client and cannot write to production.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {readRecoveryEnvelope} from '../api/_lib/recovery-envelope.mjs';
import {restoreRecoveryChain} from '../scripts/_lib/recovery-chain.mjs';
import {createRecordStore,snapshotRecords} from '../api/_lib/record-state.mjs';
const directory=process.env.REMARKT_BACKUP_DIR;
if(!directory || !path.isAbsolute(directory))throw new Error('External encrypted backup directory required.');
const names=(await fs.readdir(directory)).filter(name=>/^recovery-[a-zA-Z0-9_-]+-\d+-\d+\.json$/.test(name));
const states=await Promise.all(names.map(async name=>readRecoveryEnvelope(JSON.parse(await fs.readFile(path.join(directory,name),'utf8')))));
states.sort((a,b)=>a.storageRevision-b.storageRevision);
const source=restoreRecoveryChain(states);
const db=new PGlite();
try {
  await db.exec(await fs.readFile(new URL('../migrations/003-record-storage.sql',import.meta.url),'utf8'));
  await db.query("INSERT INTO remarkt_workspaces(id) VALUES ('isolated-restore-test')");
  const sql=(parts,...values)=>{
    const query={text:parts.reduce((out,part,i)=>out+(i?`$${i}`:'')+part,''),values};
    query.then=(resolve,reject)=>db.query(query.text,query.values).then(result=>result.rows).then(resolve,reject);
    return query;
  };
  sql.transaction=queries=>db.transaction(async tx=>{const result=[];for(const query of queries)result.push((await tx.query(query.text,query.values)).rows);return result;});
  const store=createRecordStore(sql,'isolated-restore-test'),records=snapshotRecords(source);
  for(let i=0;i<records.length;i+=200)await store.merge({mutationId:randomUUID(),operations:records.slice(i,i+200).map(row=>({...row,expectedRevision:0}))});
  const restored=await store.exportState();
  const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const hash=state=>createHash('sha256').update(snapshotRecords(state).map(row=>JSON.stringify(canonical(row))).sort().join('\n')).digest('hex');
  if(hash(source)!==hash(restored))throw new Error('Restored content mismatch. No production changes made.');
  console.log(JSON.stringify({restoreVerified:true,isolated:true,records:records.length,sourceRevision:source.storageRevision,
    users:restored.users.length,batches:restored.batches.length,monitorBatches:restored.monitorBatches.length,
    laptops:restored.batches.reduce((sum,b)=>sum+b.laptops.length,0),monitors:restored.monitorBatches.reduce((sum,b)=>sum+b.monitors.length,0)}));
}finally{await db.close();}

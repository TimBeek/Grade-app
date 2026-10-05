import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createRecordStore,snapshotRecords} from '../api/_lib/record-state.mjs';
import {emptyState} from '../api/_lib/state-core.mjs';
import {readRecordInsights,insightFilters} from '../api/_lib/record-insights.mjs';
import {makeRecoveryEnvelope} from '../api/_lib/recovery-envelope.mjs';
import {restoreRecoveryChain} from '../scripts/_lib/recovery-chain.mjs';
import {mirrorBackupDirectory,verifyBackupDirectory} from '../scripts/_lib/backup-mirror.mjs';
import {backupStatus} from '../api/_lib/backup-status.mjs';
async function fixture() {
  const db=new PGlite();await db.exec(await fs.readFile(new URL('../migrations/003-record-storage.sql',import.meta.url),'utf8'));
  await db.exec(await fs.readFile(new URL('../migrations/005-backup-monitor.sql',import.meta.url),'utf8'));
  await db.query("INSERT INTO remarkt_workspaces(id) VALUES('qa')");
  const sql=(parts,...values)=>db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values).then(result=>result.rows);
  return {db,sql,store:createRecordStore(sql,'qa')};
}
const all={productType:'all',employee:'all',batch:'all',brand:'all',grade:'all',status:'all',query:'',dateRange:'all',viewer:''};
test('backup health distinguishes missing, delayed verification, unsaved revision and second-copy failure',()=>{
  const now=Date.now(),base={createdAt:new Date(now).toISOString(),revision:5};
  assert.equal(backupStatus(null,5,now).status,'missing');
  assert.equal(backupStatus(base,5,now).status,'current');
  assert.equal(backupStatus(base,6,now).status,'pending');
  assert.equal(backupStatus(base,5,now+3*3600000).status,'stale');
  assert.equal(backupStatus({...base,mirrorConfigured:true,mirrorError:true},5,now).mirrorStatus,'failed');
  assert.equal(backupStatus({...base,mirrorConfigured:true,mirrorVerifiedAt:'invalid'},5,now).mirrorStatus,'stale');
});
test('immutable recovery mirror verifies all files, copies only missing bytes and refuses corruption',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'remarkt-mirror-test-')),key=randomBytes(32).toString('hex');
  const source=path.join(root,'primary'),mirror=path.join(root,'secondary');
  try {
    await fs.mkdir(source);
    const full={...emptyState(),workspaceId:'qa',storageRevision:1,users:[{id:'m',naam:'Synthetic',rol:'Manager',passwordHash:'synthetic-test-hash'}]};
    const filename='recovery-qa-1-100.json';
    await fs.writeFile(path.join(source,filename),JSON.stringify(makeRecoveryEnvelope(full,key)));
    assert.equal((await mirrorBackupDirectory(source,mirror,'qa',key)).copied,1);
    assert.equal((await mirrorBackupDirectory(source,mirror,'qa',key)).copied,0);
    assert.equal((await verifyBackupDirectory(mirror,'qa',key)).state.users.length,1);
    await fs.writeFile(path.join(mirror,filename),'corrupted');
    await assert.rejects(mirrorBackupDirectory(source,mirror,'qa',key),/refusing to overwrite/);
    assert.equal(await fs.readFile(path.join(mirror,filename),'utf8'),'corrupted');
  }finally {await fs.rm(root,{recursive:true,force:true});}
});
test('recovery handles repeated crash ranges and newer full checkpoints, but rejects gaps and conflicting copies',()=>{
  const full={...emptyState(),workspaceId:'qa',storageRevision:1};
  const delta={...emptyState(),workspaceId:'qa',storageRevision:2,_incrementalFrom:1,_recordBackup:[{collection:'history',id:'h',revision:2,payload:{id:'h',sticker:'1',grade:'A'}}]};
  assert.equal(restoreRecoveryChain([delta,full,structuredClone(delta)]).history.length,1);
  assert.equal(restoreRecoveryChain([full,{...full,storageRevision:3,history:[{id:'new',sticker:'2'}]}]).history[0].id,'new');
  assert.throws(()=>restoreRecoveryChain([full,{...delta,storageRevision:3,_incrementalFrom:2}]),/gap/);
  assert.throws(()=>restoreRecoveryChain([full,delta,{...delta,_recordBackup:[]}]),/Conflicting/);
  assert.throws(()=>restoreRecoveryChain([full,{...full,workspaceId:'another',storageRevision:4}]),/workspace/);
});
test('SQL insights keep grade, supplier, repair bins, dates, employee timing and live open inventory correct',async()=>{
  const {db,sql,store}=await fixture();
  try {
    const now=Date.now(),savedAt=new Date(now).toISOString();
    const state={...emptyState(),batches:[{id:'b',nummer:'Batch 1',leverancier:'Supplier',laptops:[{sticker:'1',serial:'MP2526X1',leverancier_class:'Class B'},{sticker:'2'}]}],
      history:[{id:'h1',sticker:'1',batchId:'b',batchNummer:'Batch 1',grade:'A',user_id:'one',user_naam:'Employee One',duurSec:60,savedAt,
        result:{problems:[],inspection:{big:'never returned'}}},
      {id:'h2',sticker:'3',batchId:'b',batchNummer:'Batch 1',grade:'X',user_id:'two',user_naam:'Employee Two',duurSec:120,savedAt,
        leverancier_class:'C',result:{forceProblemLabel:true,repairLabelType:'production',problems:['Broken hinge'],repairActions:[{componentId:'scharnieren',repairSeverity:'heavy'}]}},
      {id:'old',sticker:'4',batchId:'other',batchNummer:'Old batch',grade:'C',user_id:'two',user_naam:'Employee Two',savedAt:'2020-01-01T00:00:00Z'}],
      monitorLabelPrints:[{id:'m1',sticker:'m',batchId:'mon',grade:'B',user_id:'one',user_naam:'Employee One',startedAt:new Date(now-30000).toISOString(),firstPrintedAt:savedAt,printedAt:savedAt,durationSec:30}]};
    await store.merge({mutationId:randomUUID(),operations:snapshotRecords(state).map(row=>({...row,expectedRevision:0}))});
    const result=await readRecordInsights(sql,'qa',all);
    assert.equal(result.completed,4);assert.equal(result.open,1);assert.equal(result.counts.A,1);assert.equal(result.counts.D,1);
    assert.equal(result.supplierStats.summary.improved,1);assert.equal(result.supplierStats.summary.downgraded,1);
    assert.equal(result.repairCount,1);assert.equal(result.bins[0].bin,'Hinges');assert.equal(result.bins[0].heavy,1);
    assert.equal(result.monitorTiming.avgActiveSec,30);assert.equal(result.monitorTiming.sessions,1);
    assert.equal(result.laptopTiming.medianSec,90);assert.equal(result.today,3);
    assert.equal((await readRecordInsights(sql,'qa',{...all,batch:'b'})).completed,2);
    assert.equal((await readRecordInsights(sql,'qa',{...all,employee:'one'})).completed,2);
    assert.equal((await readRecordInsights(sql,'qa',{...all,viewer:'one'})).completed,2);
    assert.equal((await readRecordInsights(sql,'qa',{...all,dateRange:'today'})).completed,3);
    assert.equal((await readRecordInsights(sql,'qa',{...all,grade:'X'})).completed,1);
    assert.equal((await readRecordInsights(sql,'qa',{...all,status:'open'})).open,1);
    assert.ok(!JSON.stringify(result).includes('never returned'));
    assert.throws(()=>insightFilters(new URLSearchParams({dateRange:'invalid'}),{rol:'Manager'}),/filter/);
    await store.merge({mutationId:randomUUID(),operations:[{collection:'monitorLabelPrints',id:'interrupted',expectedRevision:0,
      payload:{id:'interrupted',sticker:'interrupted',grade:'A',user_id:'one',user_naam:'Employee One',
        startedAt:new Date(now-1800000).toISOString(),firstPrintedAt:savedAt,printedAt:savedAt,durationSec:1800}}]});
    const monitors=await readRecordInsights(sql,'qa',{...all,productType:'monitor'});
    assert.equal(monitors.monitorTiming.total,2);assert.equal(monitors.monitorTiming.measured,1);
    assert.equal(monitors.monitorTiming.interrupted,1);assert.equal(monitors.monitorTiming.avgSec,30);
  }finally{await db.close();}
});
test('10,000 assessments produce category-sized insight responses rather than archive-sized payloads',async()=>{
  const {db,sql,store}=await fixture();
  try {
    const state={...emptyState(),history:Array.from({length:10000},(_,i)=>({id:`h${i}`,sticker:String(i),grade:'B',batchId:'b',batchNummer:'One batch',
      user_id:'one',user_naam:'One employee',savedAt:new Date().toISOString(),duurSec:60,result:{inspection:{payload:'x'.repeat(2048)},problems:[]}}))};
    const records=snapshotRecords(state);
    for(let i=0;i<records.length;i+=1000)await store.merge({mutationId:randomUUID(),operations:records.slice(i,i+1000).map(row=>({...row,expectedRevision:0}))});
    const result=await readRecordInsights(sql,'qa',all),bytes=Buffer.byteLength(JSON.stringify(result));
    assert.equal(result.completed,10000);assert.equal(result.employees.length,1);assert.ok(bytes<15000,`Response ${bytes} bytes`);
    console.log(`SQL insights: 10,000 assessments -> ${bytes} bytes; no inspection payloads`);
  }finally{await db.close();}
});

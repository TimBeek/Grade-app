const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppSandbox}=require('./app-sandbox.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(remote=false) {
  const app=loadAppSandbox();app.URLSearchParams=URLSearchParams;
  vm.runInContext(`STATE.currentUser={id:'manager',rol:'Manager'}; STATE.sharedWorkspaceId='qa';
    STATE.currentScreen='analytics';STATE.storageFormat=${remote?3:0};
    BATCHES.splice(0,BATCHES.length,{id:'b',nummer:'Batch 1',leverancier:'Supplier',laptops:[]});
    MONITOR_BATCHES.splice(0);STATE.labelPrints=[];STATE.monitorLabelPrints=[];
    STATE.history=[{id:'h',sticker:'1',grade:'A',duurSec:60,user_id:'one',user_naam:'One',
      batchId:'b',batchNummer:'Batch 1',leverancier_class:'B',savedAt:new Date().toISOString(),result:{problems:[]}}];`,app);
  return app;
}
test('Insights only constructs the selected charts and computes stock progress on the throughput tab',()=>{
  const app=fixture(),functions=['buildBatchProgressRows','getSupplierComparisonStats','getSupplierComparisonRows',
    'getSupplierScorecardRows','buildRepairBatchRows','renderEmployeeTable','renderRepairBins','buildLaptopTimingStats'];
  const calls={};
  for(const name of functions){const original=app[name];app[name]=(...args)=>{calls[name]=(calls[name]||0)+1;return original(...args);};}
  const overview=app.renderAnalytics();
  assert.match(overview,/Current picture/);assert.equal(calls.buildLaptopTimingStats,1);
  for(const name of functions.filter(name=>name!=='buildLaptopTimingStats'))assert.equal(calls[name]||0,0,name);
  vm.runInContext("STATE.analyticsTab='batch'",app);const batch=app.renderAnalytics();
  assert.match(batch,/Grade &amp; supplier detail/);assert.equal(calls.getSupplierComparisonStats,1);
  assert.equal(calls.getSupplierComparisonRows,1,'supplier charts reuse the same comparison');
  assert.equal(calls.buildLaptopTimingStats,1,'quality tab does not calculate hidden timing');
  assert.equal(calls.buildBatchProgressRows||0,0);
  vm.runInContext("STATE.analyticsTab='throughput'",app);
  assert.match(app.renderAnalytics(),/Batch completion \(live\)/);assert.equal(calls.buildBatchProgressRows,1);
  assert.equal(calls.renderEmployeeTable,1);
  vm.runInContext("STATE.analyticsTab='repair'",app);
  assert.match(app.renderAnalytics(),/Repair per batch/);assert.equal(calls.buildRepairBatchRows,1);assert.equal(calls.renderRepairBins,1);
  assert.equal(calls.buildBatchProgressRows,1);
});
test('rapid A/B/A filters coalesce each request and never publish the wrong filter, workspace or role',async()=>{
  const app=fixture(true),pending=[];
  app.fetch=url=>new Promise(resolve=>pending.push({url,resolve}));
  const a=app.loadRecordInsights();await tick();
  vm.runInContext("STATE.analyticsFilters={...getAnalyticsFilters(),batch:'b'}",app);
  const b=app.loadRecordInsights();await tick();
  vm.runInContext("STATE.analyticsFilters={...getAnalyticsFilters(),batch:'all'}",app);
  const again=app.loadRecordInsights();await tick();assert.equal(pending.length,2);
  pending[1].resolve({ok:true,json:async()=>({marker:'B',revision:10})});await b;
  assert.equal(vm.runInContext('STATE.recordInsights',app),undefined);
  pending[0].resolve({ok:true,json:async()=>({marker:'A',revision:10})});await a;await again;
  assert.equal(app.getCachedRecordInsights().data.marker,'A');
  vm.runInContext("STATE.analyticsFilters={...getAnalyticsFilters(),batch:'b'}",app);
  assert.equal(app.getCachedRecordInsights().data.marker,'B');
  assert.equal((await app.loadRecordInsights()).marker,'B');assert.equal(pending.length,2);
  vm.runInContext("STATE.currentUser.rol='Medewerker'",app);assert.equal(app.getCachedRecordInsights(),null);
  vm.runInContext("STATE.currentUser.rol='Manager';STATE.sharedWorkspaceId='other'",app);assert.equal(app.getCachedRecordInsights(),null);
});
test('fresh filter cache is rendered synchronously, expires on time and is invalidated by writes or remote revisions',async()=>{
  const app=fixture(true);let requests=0;
  app.fetch=async()=>{requests++;return {ok:true,json:async()=>({revision:10,marker:'cached'})};};
  await app.loadRecordInsights();assert.equal(requests,1);
  vm.runInContext('STATE.recordInsights=null;',app);
  app.renderAnalyticsSidebar=()=>'';app.renderAnalyticsFilters=()=>'';
  // Prove a cache hit reaches the real chart path (the deliberate facet getter)
  // without scheduling a load or returning the loading shell.
  const cached=app.getCachedRecordInsights();Object.defineProperty(cached.data,'facets',{get(){throw Error('cached charts');}});
  assert.throws(()=>app.renderAnalytics(),/cached charts/);assert.equal(requests,1);
  vm.runInContext('STATE.recordInsights=null;',app);
  app.rememberRecordProtection({storageRevision:11});assert.equal(app.getCachedRecordInsights(),null);
  await app.loadRecordInsights();const fresh=app.getCachedRecordInsights();fresh.until=0;
  vm.runInContext('STATE.recordInsights.until=0;',app);assert.equal(app.getCachedRecordInsights(),null);
  app.invalidateRecordInsights();assert.equal(vm.runInContext('recordInsightsCache.size',app),0);
});
test('late Insights response after a save is discarded and cannot overwrite a fresh request',async()=>{
  const app=fixture(true),pending=[];
  app.fetch=url=>new Promise(resolve=>pending.push({url,resolve}));
  const old=app.loadRecordInsights();await tick();app.invalidateRecordInsights();
  const fresh=app.loadRecordInsights();await tick();
  pending[1].resolve({ok:true,json:async()=>({revision:11})});await fresh;
  pending[0].resolve({ok:true,json:async()=>({revision:10})});assert.equal(await old,false);
  assert.equal(app.getCachedRecordInsights().data.revision,11);
  assert.equal(vm.runInContext('recordInsightsRequests.size',app),0);
});

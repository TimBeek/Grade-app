// Local synthetic data only. Does not contact or modify the live workspace.
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { loadAppSandbox } = require('../tests/app-sandbox.cjs');
const app = loadAppSandbox();
vm.runInContext(`
  STATE.currentUser={id:'m',rol:'Manager'};
  STATE.history=Array.from({length:10000},(_,i)=>({id:'h'+i,sticker:String(i),grade:'B',duurSec:60,
    user_id:'one',user_naam:'Employee',batchId:'b',batchNummer:'One batch',leverancier_class:'B',
    savedAt:new Date().toISOString(),result:{problems:[]}}));
  BATCHES.splice(0,BATCHES.length,{id:'b',nummer:'One batch',laptops:[]});
  MONITOR_BATCHES.splice(0);
`,app);
for (const tab of ['overview','batch','throughput','repair']) {
  vm.runInContext(`STATE.analyticsTab='${tab}'`,app);
  const start=performance.now(), html=app.renderAnalytics();
  console.log(`${tab}: ${Math.round(performance.now()-start)} ms; ${Buffer.byteLength(html)} bytes`);
}

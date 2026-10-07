const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppSandbox}=require('./app-sandbox.cjs');

function fixture() {
  const app=loadAppSandbox(), timers=[], nodes=new Map();let buttons=[];
  const node=(dataset={})=>({dataset:{...dataset},attrs:new Map(),classes:new Set(),disabled:false,
    matches:()=>true,setAttribute(name,value){this.attrs.set(name,String(value));},
    getAttribute(name){return this.attrs.get(name)??null;},removeAttribute(name){this.attrs.delete(name);},
    remove(){nodes.delete(this.id);},
    get classList(){return {add:name=>this.classes.add(name),remove:name=>this.classes.delete(name)};}});
  app.setTimeout=(fn,delay)=>{const timer={fn,delay};timers.push(timer);return timer;};
  app.clearTimeout=timer=>{if(timer)timer.cancelled=true;};
  app.document.createElement=()=>node();
  app.document.body={appendChild(element){nodes.set(element.id,element);}};
  app.document.getElementById=id=>id==='app'?app.__appElement:nodes.get(id)||null;
  app.document.querySelectorAll=selector=>selector==='button, [role="button"]'?buttons:[];
  return {app,node,nodes,setButtons(value){buttons=value;},reveal(){for(const timer of timers.splice(0))if(!timer.cancelled&&timer.delay===120)timer.fn();}};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}

test('fast UI actions run immediately, preserve browser gestures and do not flash a loader',()=>{
  const f=fixture(),button=f.node({action:'toggle_fullscreen'});let calls=0;
  assert.equal(f.app.runUiAction(button,()=>{calls++;return 42;}),42);
  assert.equal(calls,1);f.reveal();assert.equal(f.nodes.size,0);assert.equal(button.classes.size,0);
  assert.throws(()=>f.app.runUiAction(button,()=>{throw Error('sync failure');}),/sync failure/);
  assert.equal(vm.runInContext('pendingUiActions.size',f.app),0);
});
test('slow UI actions coalesce duplicate buttons, survive repaint and restore ARIA and native state',async()=>{
  const f=fixture(),button=f.node({action:'create_user'}),work=deferred();let calls=0;
  vm.runInContext("STATE.language='nl';",f.app);
  const pending=f.app.runUiAction(button,()=>{calls++;return work.promise;});
  const replacement=f.node({action:'create_user'});replacement.setAttribute('aria-disabled','false');
  f.setButtons([replacement]);
  assert.equal(f.app.runUiAction(replacement,()=>{calls++;}),pending);
  assert.equal(calls,1);assert.equal(f.nodes.size,0);
  f.reveal();assert.equal(button.getAttribute('aria-busy'),'true');
  assert.equal(replacement.getAttribute('aria-busy'),'true');
  assert.match(f.nodes.get('ui-action-status').innerHTML,/Opslaan/);
  replacement.disabled=true; // A business rule, not owned by feedback.
  work.resolve(true);assert.equal(await pending,true);
  assert.equal(f.nodes.size,0);assert.equal(button.getAttribute('aria-busy'),null);
  assert.equal(replacement.getAttribute('aria-disabled'),'false');assert.equal(replacement.disabled,true);
});
test('failed actions clean up their loader, propagate the error and permit a retry',async()=>{
  const f=fixture(),button=f.node({sticker:'L-1'}),work=deferred();
  const pending=f.app.runUiAction(button,()=>work.promise);f.reveal();
  assert.match(f.nodes.get('ui-action-status').innerHTML,/Checking device/);
  const rejected=assert.rejects(pending,/connection lost/);work.reject(Error('connection lost'));await rejected;
  assert.equal(f.nodes.size,0);assert.equal(button.classes.size,0);
  assert.equal(f.app.runUiAction(button,()=>true),true);
});
test('a navigation button remains coalesced when its handler changes screen before data arrives',async()=>{
  const f=fixture(),button=f.node({action:'analytics'}),work=deferred();let calls=0;
  const pending=f.app.runUiAction(button,()=>{calls++;vm.runInContext("STATE.currentScreen='analytics';",f.app);return work.promise;});
  assert.equal(f.app.runUiAction(button,()=>{calls++;}),pending);assert.equal(calls,1);
  work.resolve();await pending;
});
test('unrelated pending actions do not block each other or prematurely clear the remaining indicator',async()=>{
  const f=fixture(),a=deferred(),b=deferred();
  const pa=f.app.runUiAction(f.node({batchStats:'one'}),()=>a.promise);
  const pb=f.app.runUiAction(f.node({batchStats:'two'}),()=>b.promise);
  f.reveal();a.resolve();await pa;assert.ok(f.nodes.has('ui-action-status'));
  b.resolve();await pb;assert.equal(f.nodes.size,0);
});
test('bound and delegated monitor selection both track the full async operation',async()=>{
  const f=fixture(),button=f.node({monitorSelect:'M-1'});let work=deferred(),calls=0;
  f.app.selectMonitorForLabel=()=>{calls++;return work.promise;};
  f.app.document.querySelectorAll=selector=>selector==='[data-monitor-select]'?[button]:[];
  f.app.bindRenderedControlHandlers();
  const event={target:{closest:selector=>['button, [role="button"]','[data-monitor-select]'].includes(selector)?button:null},preventDefault(){},stopPropagation(){}};
  const pending=button.onclick(event);button.onclick(event);assert.equal(calls,1);
  f.reveal();assert.equal(button.getAttribute('aria-busy'),'true');work.resolve();await pending;
  work=deferred();const fallback=f.app.handleDelegatedClick(event);assert.equal(calls,2);
  f.reveal();assert.ok(f.nodes.has('ui-action-status'));work.resolve();await fallback;assert.equal(f.nodes.size,0);
});
test('all inventory lists have bounded markup and still find, page and scan devices outside the first page',async()=>{
  const app=loadAppSandbox();
  app.inventory=Array.from({length:1000},(_,i)=>({sticker:'L-'+i,serial:'SERIAL-'+i,merk:'Dell',model:'Latitude',batchId:'large'}));
  app.monitors=Array.from({length:1000},(_,i)=>({sticker:'M-'+i,serial:'MSERIAL-'+i,merk:'Dell',model:'P24'}));
  vm.runInContext("STATE.currentUser=USERS.find(u=>u.id==='tim');STATE.currentScreen='scan';BATCHES.splice(0,BATCHES.length,{id:'large',nummer:'large',laptops:inventory});MONITOR_BATCHES.splice(0,MONITOR_BATCHES.length,{id:'mon',nummer:'mon',monitors});rebuildLaptopIndex();rebuildMonitorIndex();",app);
  for(const [render,attribute] of [[app.renderScan,'data-sticker='],[app.renderStickerScan,'data-sticker-label='],[app.renderMonitorLabelScan,'data-monitor-select=']]) {
    const html=render();assert.equal(html.split(attribute).length-1,50);
    assert.ok(Buffer.byteLength(html)<80000);assert.match(html,/data-action="inventory_page"/);
  }
  const scope=JSON.stringify(['grading','']);
  await app.handleAction('inventory_page',{dataset:{inventoryScope:scope,inventoryPage:'20'}});
  assert.match(app.renderScan(),/data-sticker="L-999"/);
  vm.runInContext("STATE.scanSearch='SERIAL-999';",app);
  assert.equal(app.renderScan().split('data-sticker=').length-1,1);
  assert.match(app.renderScan(),/data-sticker="L-999"/);
  assert.equal(app.getLaptopBySticker('SERIAL-999').sticker,'L-999');
  assert.equal(vm.runInContext('getAllLaptops().length',app),1000);
});
test('completion membership and audit attempt indexing preserve normalized codes, reopen and print-attempt semantics',()=>{
  const app=loadAppSandbox();
  vm.runInContext(`BATCHES.splice(0,BATCHES.length,{id:'a',laptops:[{sticker:'00123'},{sticker:'456'},{sticker:'789'}],
    completionReview:{status:'physically_complete',verifiedStickers:['123']}});
    STATE.auditLogs=[{entityType:'laptop',entityId:'000456',action:'print_label_failed'},
    {entityType:'laptop',entityId:'789',action:'irrelevant'},{entityType:'monitor',entityId:'789',action:'print_label'}];rebuildLaptopIndex();`,app);
  const audit=vm.runInContext('getBatchCompletionAudit(BATCHES[0])',app);
  assert.equal(audit.verifiedGaps.length,1);assert.equal(audit.unresolvedGaps.length,2);
  assert.equal(audit.printAttemptGaps.length,1);assert.equal(audit.printAttemptGaps[0].sticker,'456');
  assert.equal(vm.runInContext('openLaptopCount(BATCHES[0])',app),2);
  assert.equal(vm.runInContext('getBatchCompletionAudit(BATCHES[0],{includePrintAttempts:false}).printAttemptGaps.length',app),0);
  vm.runInContext("BATCHES[0].completionReview={status:'reopened'};",app);
  assert.equal(vm.runInContext('openLaptopCount(BATCHES[0])',app),3);
});
test('home only builds the visible workflow and does not calculate hidden print-attempt detail',()=>{
  const app=loadAppSandbox();let calculations=0;
  app.getDashboardData=()=>{calculations++;throw Error('Hidden inventory should not be built');};
  vm.runInContext("STATE.currentUser=USERS.find(u=>u.id==='tim');STATE.homeTab='support';",app);
  assert.match(app.renderHome(),/Operations/);assert.equal(calculations,0);
});
test('expanded batch audits render a bounded page while counts describe the entire batch',()=>{
  const app=loadAppSandbox();app.inventory=Array.from({length:1000},(_,i)=>({sticker:'GAP-'+i,merk:'Dell',model:'Latitude'}));
  vm.runInContext("BATCHES.splice(0,BATCHES.length,{id:'audit',nummer:'audit',laptops:inventory});rebuildLaptopIndex();",app);
  const audit=vm.runInContext('getBatchCompletionAudit(BATCHES[0])',app);
  const html=app.renderBatchCompletionAuditPanel(vm.runInContext('BATCHES[0]',app),audit,true);
  assert.equal(html.split('class="batch-audit-device ').length-1,50);
  assert.match(html,/0\/1000 digitally traceable/);assert.ok(Buffer.byteLength(html)<40000);
});
test('startup starts independent reads concurrently and static model loading is cached without changing live auth',async()=>{
  const app=loadAppSandbox();const ports=deferred(),directory=deferred();let modelStarted=false,usersStarted=false;
  app.loadMonitorPortDatabase=()=>{modelStarted=true;return ports.promise;};
  app.refreshSharedUsers=()=>{usersStarted=true;return directory.promise;};
  vm.runInContext('STATE.serverAuth=true;',app);
  const pending=app.initApp();assert.equal(modelStarted,true);assert.equal(usersStarted,true);
  ports.resolve();directory.resolve();await pending;
  const another=loadAppSandbox();let settings;
  vm.runInContext('MONITOR_PORT_DATABASE.length=0;',another);
  another.fetch=async(url,options)=>{settings={url,options};return {ok:true,json:async()=>({entries:[]})};};
  await another.loadMonitorPortDatabase();assert.equal(settings.options.cache,'force-cache');assert.match(settings.url,/\?v=/);
});

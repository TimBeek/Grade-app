const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAppSandbox } = require('./app-sandbox.cjs');

function duplicateFixture(role = 'Grader') {
  const app = loadAppSandbox();
  vm.runInContext(`
    STATE.currentUser={id:'worker',naam:'Worker',rol:'${role}',laptopAccess:'${role === 'Stickeraar' ? 'label' : 'grade'}',voorkeur:'beginner'};
    STATE.currentScreen='scan';
    STATE.history=[{id:'previous',sticker:'8460024',grade:'C',merk:'HP',model:'EliteBook 645 G9',
      savedAt:'2026-10-07T07:00:00Z',result:{eindgrade:'C',score:30,problems:['Broken hinge']}}];
    rebuildHistoryIndexes();globalThis.printCalls=[];
    printLabelFor=async(laptop,result,type)=>{printCalls.push({sticker:laptop.sticker,grade:result.eindgrade,type});return true;};
  `, app);
  return app;
}

test('duplicate barcode and serial scans show three choices before any printing or grading', async () => {
  for (const code of ['8460024', '0008460024', '5CD3258381']) {
    const app = duplicateFixture();
    await app.selectLaptop(code);
    assert.equal(vm.runInContext('STATE.laptopReprintPrompt.sticker', app), '8460024');
    assert.equal(vm.runInContext('printCalls.length', app), 0);
    assert.equal(vm.runInContext('STATE.currentGrading', app), null);
    const html = app.renderLaptopReprintModal(vm.runInContext('STATE.laptopReprintPrompt', app));
    assert.match(html, /already been graded/);
    for (const action of ['laptop_reprint_confirm', 'laptop_regrade', 'laptop_reprint_cancel']) assert.match(html, new RegExp(action));
    assert.match(html, /Previous grade:<\/strong> C/);
    await app.selectLaptop('7771198');
    assert.equal(vm.runInContext('STATE.laptopReprintPrompt.sticker', app), '8460024', 'A second scan cannot replace the pending choice');
  }
});

test('reprint uses the saved grade and repair label without appending another assessment', async () => {
  const app = duplicateFixture();
  await app.selectLaptop('8460024');
  await app.handleAction('laptop_reprint_confirm');
  assert.equal(vm.runInContext('printCalls.length', app), 2);
  assert.equal(vm.runInContext('printCalls[0].grade', app), 'C');
  assert.equal(vm.runInContext('printCalls[1].type', app), 'problems');
  assert.equal(vm.runInContext('STATE.history.length', app), 1);
  assert.equal(vm.runInContext('STATE.laptopReprintPrompt', app), null);
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'scan');
});

test('grade again starts clean at step one, retains previous assessment and can save a new result', async () => {
  const app = duplicateFixture();
  vm.runInContext(`STATE.currentLaptop=getLaptopBySticker('8460024');startGrading('beginner');
    STATE.currentGrading.keuzes.bovenkap='C';STATE.currentGrading.huidigeIndex=4;persistGuidedDraft();`, app);
  await app.selectLaptop('8460024');
  await app.handleAction('laptop_regrade');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'grading_beginner');
  assert.equal(vm.runInContext('STATE.currentGrading.huidigeIndex', app), 0);
  assert.equal(vm.runInContext('Object.keys(STATE.currentGrading.keuzes).length', app), 0);
  assert.equal(vm.runInContext('STATE.history[0].grade', app), 'C');
  assert.equal(vm.runInContext('printCalls.length', app), 0);
  // Exercise the existing expert save boundary separately from guided QA gates.
  vm.runInContext(`startGrading('expert');STATE.currentGrading.result=buildExpertDirectResult('B');
    STATE.currentGrading.bevestigd=Date.now();STATE.currentScreen='result';`, app);
  await app.saveGrading();
  assert.equal(vm.runInContext('STATE.history.length', app), 2);
  assert.equal(vm.runInContext('getLatestHistoryForSticker("8460024").grade', app), 'B');
  assert.equal(vm.runInContext('STATE.history[0].grade', app), 'C');
  await app.selectLaptop('8460024');
  await app.handleAction('laptop_reprint_confirm');
  assert.equal(vm.runInContext('printCalls[0].grade',app),'B','A reprint after regrading uses the new saved grade');
});

test('label-only employee can reprint or go back but cannot regrade; label-only completion warning is accurate', async () => {
  const app = duplicateFixture('Stickeraar');
  vm.runInContext(`STATE.history=[];STATE.labelPrints=[{id:'label',sticker:'8460024'}];rebuildHistoryIndexes();`, app);
  await app.scanAndPrintStickerLabel('8460024');
  const html = app.renderLaptopReprintModal(vm.runInContext('STATE.laptopReprintPrompt', app));
  assert.match(html, /a label has already been printed/);
  assert.doesNotMatch(html, /already been graded/);
  assert.match(html, /data-action="laptop_regrade"[^>]+disabled/);
  await app.handleAction('laptop_regrade');
  assert.equal(vm.runInContext('STATE.currentGrading', app), null);
  await app.handleAction('laptop_reprint_cancel');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'sticker_scan');
  assert.equal(vm.runInContext('printCalls.length', app), 0);
});

test('duplicate label-scan supports regrade for graders and Escape returns to its original scanner', async () => {
  const app = duplicateFixture();
  await app.scanAndPrintStickerLabel('8460024');
  let prevented = false;
  app.handleDelegatedKeydown({key:'Escape',preventDefault(){prevented=true;},target:{id:'laptop-repeat-dialog'}});
  assert.equal(prevented, true);
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'sticker_scan');
  await app.scanAndPrintStickerLabel('8460024');
  await app.handleAction('laptop_regrade');
  assert.equal(vm.runInContext('STATE.currentScreen', app), 'grading_beginner');
});

test('double-click printing is coalesced, failures retain the choice and retries remain possible', async () => {
  const app = duplicateFixture();
  let release;
  const wait = new Promise(resolve => {release=resolve;});
  let calls = 0;
  app.printLabelFor = async () => {calls++;await wait;return false;};
  await app.selectLaptop('8460024');
  const first = app.handleAction('laptop_reprint_confirm');
  await app.handleAction('laptop_reprint_confirm');
  await app.handleAction('laptop_reprint_cancel');
  assert.ok(vm.runInContext('STATE.laptopReprintPrompt', app));
  release();await first;
  assert.equal(calls, 1);
  assert.equal(vm.runInContext('STATE.laptopReprintBusy', app), false);
  assert.ok(vm.runInContext('STATE.laptopReprintPrompt', app));
  assert.match(app.renderLaptopReprintModal(vm.runInContext('STATE.laptopReprintPrompt',app)),/role="alert"[^>]*>Reprint for barcode/);
  app.printLabelFor=async()=>true;
  await app.handleAction('laptop_reprint_confirm');
  assert.equal(vm.runInContext('STATE.laptopReprintPrompt', app), null);
});

test('manager standard reset ignores empty fields; personal setting confirms server write and removes old offline verifier', async () => {
  const app = loadAppSandbox({gzip:true});
  vm.runInContext(`STATE.currentUser=USERS.find(u=>u.id==='tim');STATE.currentScreen='accounts';STATE.serverAuth=true;
    USERS.push({id:'employee',naam:'Employee',rol:'Grader',passwordHash:'server-managed',mustChangePassword:false});
    localStorage.setItem(OFFLINE_LOGIN_KEY,JSON.stringify({employee:{proof:'old'}}));`, app);
  const fields={'resetUserPassword-employee':{value:'PersonalNew123!'},'confirmResetUserPassword-employee':{value:'PersonalNew123!'}};
  app.document.getElementById=id=>id==='app'?app.__appElement:fields[id]||null;
  const sent=[];
  app.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);sent.push(body);
    return new Response(JSON.stringify({user:{id:'employee',naam:'Employee',rol:'Grader',passwordHash:'server-managed',
      mustChangePassword:body.action!=='set_user_password',passwordUpdatedAt:'2026-10-07T11:00:00Z'},recordRevisions:{}}));
  };
  await app.handleAction('reset_user_password',{dataset:{userId:'employee',resetMode:'standard'}});
  assert.equal(sent[0].resetMode,'standard');assert.equal(sent[0].password,undefined);
  assert.equal(vm.runInContext('USERS.find(u=>u.id==="employee").mustChangePassword', app), true);
  assert.equal(vm.runInContext('offlineLoginEntries().employee', app), undefined);
  await app.handleAction('set_user_password',{dataset:{userId:'employee'}});
  assert.equal(sent[1].action,'set_user_password');assert.equal(sent[1].password,'PersonalNew123!');
  assert.equal(vm.runInContext('USERS.find(u=>u.id==="employee").mustChangePassword', app), false);
  assert.doesNotMatch(vm.runInContext('localStorage.getItem(DEMO_STORAGE_KEYS.users)',app),/PersonalNew123/);
});

test('personal password requires matching fields and both manager actions stay blocked during an outage', async () => {
  const app = loadAppSandbox();
  vm.runInContext(`STATE.currentUser=USERS.find(u=>u.id==='tim');STATE.currentScreen='accounts';STATE.serverAuth=true;
    USERS.push({id:'employee',naam:'Employee',rol:'Grader'});`,app);
  let calls=0;app.fetch=async()=>{calls++;throw Error('Must not send');};
  const fields={'resetUserPassword-employee':{value:'NewPersonal123!'},'confirmResetUserPassword-employee':{value:'different'}};
  app.document.getElementById=id=>id==='app'?app.__appElement:fields[id]||null;
  await app.handleAction('set_user_password',{dataset:{userId:'employee'}});
  assert.equal(calls,0);assert.match(vm.runInContext('STATE.appMessage.text',app),/not the same/);
  vm.runInContext(`STATE.sharedStorageError='STORAGE_UNAVAILABLE';STATE.offlineWork=true;STATE.storageFormat=3;`,app);
  await app.handleAction('reset_user_password',{dataset:{userId:'employee',resetMode:'standard'}});
  await app.handleAction('set_user_password',{dataset:{userId:'employee'}});
  assert.equal(calls,0);
  vm.runInContext(`STATE.language='nl';`,app);
  assert.equal(app.translateCopy('Print previous label'),'Vorige label printen');
  assert.equal(app.translateCopy('Set personal password'),'Persoonlijk wachtwoord instellen');
});

test('a revoked session cannot leave a previous employee duplicate popup behind', async()=>{
  const app=duplicateFixture();
  await app.selectLaptop('8460024');
  app.clearSessionUser();
  assert.equal(vm.runInContext('STATE.laptopReprintPrompt',app),null);
});

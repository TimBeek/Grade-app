// Real session handlers + real SQL, isolated from production by an in-memory
// Postgres fixture behind the Neon SDK transport. No .env is loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { loadAppSandbox } from './app-sandbox.cjs';
import { PGlite } from '@electric-sql/pglite';
import { neonConfig } from '@neondatabase/serverless';
import { createRecordStore } from '../api/_lib/record-state.mjs';
import { passwordHash, passwordMatches, issueSession } from '../api/_lib/session-auth.mjs';
import { createRateLimiter } from '../api/_lib/rate-limit.mjs';

test('employee login and manager password administration remain reliable on a shared office network', async t => {
  Object.assign(process.env, { REMARKT_DATABASE_URL:'postgresql://qa:fake@qa.neon.tech/qa',
    REMARKT_WORKSPACE_ID:'login-qa', REMARKT_STORAGE_FORMAT:'3',
    REMARKT_SESSION_SECRET:'isolated-synthetic-session-secret-only-for-tests' });
  const db=new PGlite();
  await db.exec(await fs.readFile(new URL('../migrations/003-record-storage.sql',import.meta.url),'utf8'));
  await db.query("INSERT INTO remarkt_workspaces(id) VALUES ('login-qa')");
  const sql=(parts,...values)=>db.query(parts.reduce((out,part,i)=>out+(i?`$${i}`:'')+part,''),values).then(result=>result.rows);
  const store=createRecordStore(sql,'login-qa');
  const sharedHash=passwordHash('SyntheticPassword123!');
  const user=(id,rol='Grader')=>({id,naam:id,rol,laptopAccess:'grade',monitorAccess:'grade',voorkeur:'beginner',
    passwordHash:sharedHash,mustChangePassword:false});
  const manager=user('manager','Manager'),staff=Array.from({length:45},(_,i)=>user('staff-'+i));
  await store.merge({mutationId:randomUUID(),operations:[manager,...staff,user('legacy')].map(payload=>
    ({collection:'users',id:payload.id,expectedRevision:0,payload:payload.id==='legacy'?
      {...payload,passwordHash:createHash('sha256').update('remarkt-demo:LegacyPassword123!').digest('hex')}:payload}))});
  let unavailable=false;
  neonConfig.fetchFunction=async(_url,options)=>{
    if(unavailable)return new Response(JSON.stringify({message:'database temporarily unavailable'}),{status:503});
    const body=JSON.parse(options.body);
    const execute=async(connection,q)=>{
      const result=await connection.query(q.query,q.params);
      return {...result,rows:result.rows.map(row=>result.fields.map(field=>{
        const value=row[field.name];
        if(value===null || value===undefined)return null;
        if(value instanceof Date)return value.toISOString();
        return typeof value==='object'?JSON.stringify(value):typeof value==='boolean'?(value?'t':'f'):String(value);
      }))};
    };
    try {
      const data=body.queries?{results:await db.transaction(async tx=>{
        const results=[];for(const query of body.queries)results.push(await execute(tx,query));return results;
      })}:await execute(db,body);
      return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
    }catch(error){return new Response(JSON.stringify({message:error.message,code:error.code}),{status:400});}
  };
  const handler=(await import('../api/session.mjs')).default;
  const directory=(await import('../api/demo-state.mjs')).default;
  const request=async(body,token='',ip='office',handle=handler)=>{
    const result={headers:{},statusCode:200,setHeader(name,value){this.headers[name]=value;},
      status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}};
    await handle({method:handle===directory?'GET':'POST',url:handle===directory?'/api/demo-state?users=1':'/api/session',
      headers:{'x-forwarded-for':ip,...(token?{authorization:'Bearer '+token}:{})},body},result);
    return result;
  };
  const managerToken=issueSession(manager,'login-qa');
  try {
    await t.test('45 employees can sign in successfully from one IP; legacy passwords still work',async()=>{
      for(const account of staff) {
        const response=await request({id:account.id,password:'SyntheticPassword123!'});
        assert.equal(response.statusCode,200,account.id);
        assert.equal(response.data.user.passwordHash,'server-managed');
      }
      assert.equal((await request({id:'legacy',password:'LegacyPassword123!'})).statusCode,200);
      const failures=await db.query('SELECT hits FROM remarkt_rate_limits WHERE hits<45');
      assert.equal(failures.rows.length,0,'Successful sign-ins do not consume failed-attempt counters');
    });
    await t.test('one repeatedly failing account does not lock out its colleagues; 429 is not an outage',async()=>{
      for(let i=0;i<20;i++)assert.equal((await request({id:'staff-0',password:'wrong'})).statusCode,401);
      const rejected=await request({id:'staff-0',password:'SyntheticPassword123!'});
      assert.equal(rejected.statusCode,429);assert.equal(rejected.data.code,'RATE_LIMITED');
      assert.ok(Number(rejected.headers['Retry-After'])>=1 && Number(rejected.headers['Retry-After'])<=900);
      assert.match(rejected.data.error,/Too many attempts/);assert.doesNotMatch(rejected.data.error,/Database access failed/);
      assert.equal((await request({id:'staff-1',password:'SyntheticPassword123!'})).statusCode,200);
      assert.equal((await request({id:'staff-0',password:'SyntheticPassword123!'},'','another-office')).statusCode,200);
    });
    await t.test('manager creates a new employee with a private temporary password and correct access',async()=>{
      const created=await request({action:'create_user',id:'new-employee',naam:'New Employee',rol:'Stickeraar',
        laptopAccess:'label',monitorAccess:'grade',voorkeur:'beginner',password:'ChosenTemporary123!'},managerToken);
      assert.equal(created.statusCode,200);assert.equal(created.data.user.mustChangePassword,true);
      assert.ok(created.data.recordRevisions['["users","new-employee"]']);
      assert.doesNotMatch(JSON.stringify(created.data),/ChosenTemporary|scrypt\$/);
      const login=await request({id:'new-employee',password:'ChosenTemporary123!'},'','other-workstation');
      assert.equal(login.statusCode,200);assert.equal(login.data.user.laptopAccess,'label');
      const changed=await request({action:'password',password:'NewPersonalPassword123!'},login.data.token);
      assert.equal(changed.statusCode,200);assert.equal(changed.data.user.mustChangePassword,false);
      assert.equal((await request({id:'new-employee',password:'ChosenTemporary123!'})).statusCode,401);
      assert.equal((await request({id:'new-employee',password:'NewPersonalPassword123!'},'','workstation-3')).statusCode,200);
    });
    await t.test('reset revokes old sessions, preserves employee access and requires a different personal password',async()=>{
      const old=await request({id:'staff-2',password:'SyntheticPassword123!'});
      const reset=await request({action:'reset_user_password',id:'staff-2',password:'NewTemporary123!'},managerToken);
      assert.equal(reset.statusCode,200);assert.equal(reset.data.user.mustChangePassword,true);
      assert.equal((await request({action:'password',password:'NewPersonal123!'},old.data.token)).statusCode,401);
      assert.equal((await request({id:'staff-2',password:'SyntheticPassword123!'})).statusCode,401);
      const login=await request({id:'staff-2',password:'NewTemporary123!'},'','other-pc');
      assert.equal(login.statusCode,200);
      assert.equal((await request({action:'password',password:'NewTemporary123!'},login.data.token)).statusCode,400);
      assert.equal((await request({action:'password',password:'PersonalAfterReset123!'},login.data.token)).statusCode,200);
      assert.equal((await request({id:'staff-2',password:'PersonalAfterReset123!'})).statusCode,200);
    });
    await t.test('password changes use their own account quota, not the failed-login network quota',async()=>{
      const token=issueSession(staff[0],'login-qa');
      assert.equal((await request({action:'password',password:'ChangedAfterFailures123!'},token)).statusCode,200);
    });
    await t.test('manager reset unlocks the new password after the previous account password was rate limited',async()=>{
      for(let i=0;i<20;i++)assert.equal((await request({id:'staff-5',password:'wrong'})).statusCode,401);
      assert.equal((await request({id:'staff-5',password:'SyntheticPassword123!'})).statusCode,429);
      assert.equal((await request({action:'reset_user_password',id:'staff-5',password:'ResetUnlocked123!'},managerToken)).statusCode,200);
      assert.equal((await request({id:'staff-5',password:'ResetUnlocked123!'})).statusCode,200);
    });
    await t.test('validation, permissions and concurrent duplicate accounts are enforced by the server',async()=>{
      const staffToken=issueSession(staff[3],'login-qa');
      assert.equal((await request({action:'reset_user_password',id:'staff-4',password:'Temporary123!'},staffToken)).statusCode,403);
      assert.equal((await request({action:'reset_user_password',id:'manager',password:'Temporary123!'},managerToken)).statusCode,400);
      assert.equal((await request({action:'reset_user_password',id:'missing',password:'Temporary123!'},managerToken)).statusCode,400);
      for(const password of ['short','x'.repeat(257)])assert.equal((await request({action:'reset_user_password',id:'staff-4',password},managerToken)).statusCode,400);
      const details={action:'create_user',id:'duplicate',naam:'Duplicate',rol:'Grader',laptopAccess:'grade',monitorAccess:'grade',voorkeur:'beginner',password:'Temporary123!'};
      assert.equal((await request({...details,rol:'invalid'},managerToken)).statusCode,400);
      assert.equal((await request({...details,id:'bad id'},managerToken)).statusCode,400);
      const result=await Promise.all([request(details,managerToken),request(details,managerToken)]);
      assert.equal(result.filter(row=>row.statusCode===200).length,1);
      assert.ok(result.some(row=>[400,409].includes(row.statusCode)));
      const audit=await store.page({collection:'auditLogs'});
      assert.doesNotMatch(JSON.stringify(audit),/Temporary123|scrypt\$/);
    });
    await t.test('server failure does not alter the existing account',async()=>{
      const before=await store.detail('users','staff-4');
      unavailable=true;
      const failed=await request({action:'reset_user_password',id:'staff-4',password:'Temporary123!'},managerToken);
      unavailable=false;
      assert.equal(failed.statusCode,503);
      assert.deepEqual((await store.detail('users','staff-4')).payload,before.payload);
      assert.ok(passwordMatches('SyntheticPassword123!',before.payload.passwordHash));
    });
    await t.test('new directory quota permits refreshes by many workstations on one network',async()=>{
      for(let i=0;i<65;i++)assert.equal((await request(undefined,'','office',directory)).statusCode,200);
    });
    await t.test('SQL rate limits are workspace isolated and recover after the real window expires',async()=>{
      let now=120000;const limiter=createRateLimiter(sql,'clock-test',()=>now);
      await limiter.consume('test',1,60000);
      await assert.rejects(limiter.consume('test',1,60000),error=>error.retryAfterSeconds===60);
      now+=59000;
      await assert.rejects(limiter.check([{scope:'test',limit:1}],60000),error=>error.retryAfterSeconds===1);
      await createRateLimiter(sql,'different-workspace',()=>now).consume('test',1,60000);
      now+=1000;await limiter.check([{scope:'test',limit:1}],60000);await limiter.consume('test',1,60000);
    });
    await t.test('rotating IP addresses cannot bypass the account-wide failed-password limit',async()=>{
      for(let i=0;i<50;i++)assert.equal((await request({id:'staff-6',password:'wrong'},'',`isolated-network-${i}`)).statusCode,401);
      assert.equal((await request({id:'staff-6',password:'SyntheticPassword123!'},'','another-new-network')).statusCode,429);
      assert.equal((await request({id:'staff-7',password:'SyntheticPassword123!'},'','another-new-network')).statusCode,200);
    });
    await t.test('actual employee client: fresh login, database outage, local work, reload and idempotent recovery',async()=>{
      await store.merge({mutationId:randomUUID(),operations:[
        {collection:'batches',id:'work-batch',expectedRevision:0,payload:{id:'work-batch',nummer:'QA',leverancier:'Synthetic'}},
        {collection:'laptops',id:'["work-batch","QA-100"]',batchId:'work-batch',expectedRevision:0,
          payload:{sticker:'QA-100',serial:'SNQA100',merk:'Dell',model:'QA',batchId:'work-batch',batchNummer:'QA'}},
      ]});
      const app=loadAppSandbox({gzip:true,indexedDB:new IDBFactory()});
      app.URLSearchParams=URLSearchParams;app.window.crypto=webcrypto;
      const fields={loginUser:{value:'staff-8'},loginPassword:{value:'SyntheticPassword123!'}};
      app.document.getElementById=id=>id==='app'?app.__appElement:fields[id]||null;
      let phase='online',statsCalls=0,posts=0,lost=false;const urls=[];
      app.fetch=async(url,options={})=>{
        urls.push(url);
        if(url.startsWith('/api/stats')){statsCalls++;return new Response('{}',{status:503});}
        if(phase==='offline' || (phase==='data-outage' && url!=='/api/session'))
          return new Response(JSON.stringify({code:'STORAGE_QUOTA_EXCEEDED'}),{status:503});
        const result={headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(data){this.data=data;}};
        const handle=url==='/api/session'?handler:directory;
        if((options.method||'GET')==='POST' && handle===directory)posts++;
        await handle({method:options.method||'GET',url,headers:{'x-forwarded-for':'client-qa',authorization:options.headers?.Authorization},
          body:options.body?JSON.parse(options.body):undefined},result);
        if(lost && handle===directory && options.method==='POST' && result.statusCode===200){lost=false;throw Error('response lost after commit');}
        return new Response(JSON.stringify(result.data),{status:result.statusCode,headers:result.headers});
      };
      vm.runInContext("STATE.serverAuth=true;STATE.storageFormat=3;STATE.currentUser=null;STATE.currentScreen='login';",app);
      await app.loginWithPassword();
      assert.equal(vm.runInContext('STATE.currentScreen',app),'home');
      assert.equal(vm.runInContext('BATCHES.length',app),1);
      assert.equal(app.getLaptopBySticker('SNQA100').sticker,'QA-100');
      assert.equal(statsCalls,0);assert.equal(urls.filter(url=>url.includes('?work=1')).length,1);
      assert.ok(!urls.some(url=>url.includes('collection=')),'fresh inventory is one compressed request');
      assert.doesNotMatch(app.localStorage.getItem('remarktOfflineLoginV1'),/SyntheticPassword123/);
      phase='data-outage';
      await app.loginWithPassword();
      assert.equal(vm.runInContext('STATE.currentScreen',app),'home');
      assert.equal(vm.runInContext('canWorkLocally()',app),true);
      let physicalPrints=0;app.printRowsWithDymo=async()=>{physicalPrints++;return {printerName:'Synthetic DYMO'};};
      vm.runInContext(`STATE.currentLaptop=getLaptopBySticker('QA-100');STATE.currentScreen='result';
        STATE.currentGrading={gestart:Date.now()-20000,bevestigd:Date.now(),modus:'beginner',
          keuzes:Object.fromEntries(getGradingOnderdelen().map(part=>[part.id,'A'])),triggers:[],impactOverrides:{},
          result:{eindgrade:'A',score:0,problems:[],redenen:[]}};`,app);
      await app.confirmSaveWithAutomaticLabels();
      assert.equal(physicalPrints,1);assert.equal(vm.runInContext('STATE.history.length',app),1);
      assert.match(vm.runInContext('STATE.appMessage.text',app),/saved locally/);
      assert.equal(vm.runInContext("STATE.pendingRecordMutation.operations.filter(op=>op.collection==='batches').length",app),0);
      const originalMutation=vm.runInContext('STATE.pendingRecordMutation.mutationId',app);
      vm.runInContext(`STATE.history.push({id:'offline-history-2',sticker:'QA-101',batchId:'work-batch',grade:'B',savedAt:new Date().toISOString(),user_id:'staff-8',user_naam:'QA'});`,app);
      assert.equal(await app.saveSharedDemoState(),true);
      assert.equal(vm.runInContext('STATE.pendingRecordMutation.mutationId',app),originalMutation);
      assert.equal(app.readLocalDemoStateBackup().history.length,2);
      // The next pre-print/draft check must not clear the sealed first write.
      await app.saveLocalDemoStateBackup();
      assert.equal(app.readLocalDemoStateBackup()._pendingRecordMutation.mutationId,originalMutation);
      const secured=structuredClone(app.readLocalDemoStateBackup());
      app.clearSessionUser();vm.runInContext("STATE.currentUser=null;STATE.currentScreen='login';",app);
      phase='offline';await app.loginWithPassword();
      assert.equal(vm.runInContext('STATE.currentScreen',app),'home');
      assert.equal(vm.runInContext('STATE.history.length',app),2);
      phase='online';lost=true;
      await app.loginWithPassword(); // first replay commits, its response is lost
      assert.equal(vm.runInContext('canWorkLocally()',app),true);
      assert.equal(app.readLocalDemoStateBackup()._pendingRecordMutation.mutationId,originalMutation);
      await app.handleAction('retry_storage',{});
      assert.equal(vm.runInContext('STATE.sharedStorageError',app),null);
      assert.equal(vm.runInContext('STATE.sharedSyncPending',app),false);
      assert.equal((await store.page({collection:'history',userId:'staff-8'})).records.length,2);
      assert.equal((await store.detail('history','offline-history-2')).payload.grade,'B');
      assert.ok(posts>=3);
      // An exported pending snapshot remains independently recoverable.
      assert.equal(secured.history.length,2);assert.ok(secured._pendingRecordMutation);
      fields.loginPassword.value='wrong';phase='online';await app.loginWithPassword();
      assert.match(vm.runInContext('STATE.appMessage.text',app),/Incorrect account/);
      assert.equal(JSON.parse(app.localStorage.getItem('remarktOfflineLoginV1'))['staff-8'],undefined);
    });
  } finally {neonConfig.fetchFunction=undefined;await db.close();}
});

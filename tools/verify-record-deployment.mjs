// Read-only maintenance verification. No login/password changes or data writes.
// Uses operator-held DB credentials to issue a short-lived diagnostic session;
// never prints that session, private URLs or assessment/product payloads.
import {neon} from '@neondatabase/serverless';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {loadEnv} from '../scripts/_lib/env.mjs';
import {issueSession,publicUser} from '../api/_lib/session-auth.mjs';
const exec=promisify(execFile);
const deployment=process.argv[2];
if(!/^https:\/\/(?:grade-app-three|grade-[a-z0-9]+-re-markt)\.vercel\.app$/.test(deployment || ''))throw new Error('Specify the observed ReMarkt deployment URL.');
loadEnv(process.env.REMARKT_ENV_FILE);
process.env.REMARKT_DATABASE_URL=process.env.RECOVERY_DATABASE_URL || process.env.REMARKT_DATABASE_URL;
process.env.REMARKT_WORKSPACE_ID='recovery-20261005';
const sql=neon(process.env.REMARKT_DATABASE_URL);
const manager=await sql`SELECT payload FROM remarkt_records WHERE workspace_id=${process.env.REMARKT_WORKSPACE_ID}
  AND collection='users' AND NOT deleted AND lower(payload->>'rol') IN ('manager','admin') ORDER BY id LIMIT 1`;
assert.ok(manager[0],'No migrated manager found.');
const token=issueSession(manager[0].payload,process.env.REMARKT_WORKSPACE_ID);
async function get(route) {
  const started=Date.now();let stdout;
  try {
    ({stdout}=await exec('powershell.exe',['-NoProfile','-Command',
      `$result = & npx --yes vercel curl '${route}' --deployment '${deployment}' -- --silent --header 'Authorization: Bearer ${token}'; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}; $result`],
      {cwd:process.cwd(),maxBuffer:4*1024*1024,timeout:45000}));
  }catch {throw new Error('Protected read-only request failed; private command details withheld.');}
  let data;try{data=JSON.parse(stdout.trim());}catch{throw new Error('Unexpected non-JSON verification response.');}
  if(data.ok===false)throw new Error(`Read-only verification: ${data.code || 'ERROR'}`);
  console.log(JSON.stringify({route,bytes:Buffer.byteLength(stdout),elapsedMs:Date.now()-started}));
  return data;
}
const directory=await get('/api/demo-state?users=1');
assert.equal(directory.storageFormat,3);assert.equal(directory.serverAuth,true);
assert.ok(directory.users.every(user=>user.passwordHash==='server-managed'));
const meta=await get('/api/demo-state?meta=1');assert.equal(meta.storageFormat,3);
const health=await get('/api/health');
const products=await get('/api/demo-state?collection=laptops');assert.ok(products.records.length<=50);
const stats=await get('/api/stats');assert.equal(stats.totals.laptopsInVoorraad,5004);
assert.equal(stats.totals.monitorsInVoorraad,1827);
const insights=await get('/api/stats?insights=1&productType=all&dateRange=all');
assert.equal(Number(insights.revision),Number(meta.storageRevision));
assert.ok(Array.isArray(insights.bins) && Array.isArray(insights.employees));
assert.ok(!Object.hasOwn(insights,'history') && !Object.hasOwn(insights,'payload'));
assert.equal(health.counts.users,29);assert.equal(health.counts.batches,10);assert.equal(health.counts.monitorBatches,3);
console.log(JSON.stringify({verified:true,counts:health.counts,revision:meta.storageRevision,backup:health.backup}));
if(process.argv.includes('--browser')) {
  const browserCommand=command=>exec('powershell.exe',['-NoProfile','-Command',
    `& npx --yes agent-browser --session record-live-readonly ${command}`],{cwd:process.cwd(),timeout:60000,maxBuffer:2*1024*1024});
  const evaluate=script=>new Promise((resolve,reject)=>{
    // Keep the maintenance session out of process arguments and shell history.
    const child=spawn('powershell.exe',['-NoProfile','-Command','& npx --yes agent-browser --session record-live-readonly eval --stdin'],
      {cwd:process.cwd(),stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.resume();
    child.on('error',()=>reject(new Error('Browser verification failed.')));
    child.on('exit',code=>code===0?resolve(output):reject(new Error('Browser evaluation failed. Private inputs withheld.')));
    child.stdin.end(script);
  });
  try {
    await browserCommand(`--executable-path 'C:/Program Files/Google/Chrome/Application/chrome.exe' open '${deployment}'`);
    await browserCommand('snapshot -i');
    const result=await evaluate(`(async()=>{setLiveSessionToken(${JSON.stringify(token)});STATE.currentUser=${JSON.stringify(publicUser(manager[0].payload))};
      saveSessionUser(STATE.currentUser);STATE.currentScreen='home';await loadSharedDemoState();render();
      return {format:STATE.storageFormat,laptops:getAllLaptops().length,monitors:getAllMonitors().length,error:STATE.sharedStorageError};})()`);
    if(!result.includes('5004') || !result.includes('1827') || !result.includes('"error": null'))throw new Error('Browser did not load all preserved products.');
    console.log(result.trim());
    await evaluate("handleAction('dismiss_recovery_notice',{}).then(()=>({noticeClosed:!renderStorageStatus().includes('dismiss_recovery_notice')}))");
    const errors=await browserCommand('errors');if(errors.stdout.trim())throw new Error('Browser reported an application error.');
    console.log('Live read-only browser verified: inventory loaded, notice dismissed, no browser errors.');
  }finally {
    try{await evaluate('clearSessionUser();true');await browserCommand('close');}catch{ /* No private session output. */ }
  }
}

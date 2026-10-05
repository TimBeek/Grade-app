// Real HTTP integration against disposable LOCAL SQL only. No production URLs,
// real employees or printers can be reached by this harness.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {passwordHash} from '../api/_lib/session-auth.mjs';
const base='http://127.0.0.1:8094',workspaceId='recovery-local-qa';
async function call(route,token,body) {
  const response=await fetch(base+route,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`}:{}) ,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  return {status:response.status,data:await response.json()};
}
const login=await call('/api/session','',{id:'qa-manager',password:'StorageQA123!'});
assert.equal(login.status,200);const manager=login.data.token,prefix='stress-'+randomUUID();
const users=Array.from({length:4},(_,i)=>({id:prefix+'-'+i,naam:'Synthetic operator '+i,rol:'Grader',voorkeur:'expert',
  laptopAccess:'grade',monitorAccess:'grade',passwordHash:passwordHash('SyntheticQA123!')}));
const prepared=await call('/api/demo-state',manager,{workspaceId,mutationId:randomUUID(),operations:users.map(user=>({collection:'users',id:user.id,payload:user,expectedRevision:0}))});
assert.equal(prepared.status,200);
const tokens=await Promise.all(users.map(async user=>{
  const result=await call('/api/session','',{id:user.id,password:'SyntheticQA123!'});assert.equal(result.status,200);return result.data.token;
}));
const batches=await call('/api/demo-state?collection=batches',manager);assert.equal(batches.status,200);
const grade=async(i)=>{
  const id=prefix+'-grading-'+i,employee=i%4;
  const payload={id,sticker:prefix+'-'+i,serial:'SYNTHETIC'+i,batchId:'qa-batch',batchNummer:'QA',grade:i%3===0?'A':'B',
    user_id:users[employee].id,user_naam:users[employee].naam,savedAt:new Date().toISOString(),duurSec:30+i,
    result:{problems:[],inspection:{synthetic:true}}};
  const body={workspaceId,mutationId:randomUUID(),operations:[{collection:'history',id,batchId:'qa-batch',payload,expectedRevision:0}]};
  const saved=await call('/api/demo-state',tokens[employee],body);assert.equal(saved.status,200);
  const replay=await call('/api/demo-state',tokens[employee],body);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
  const detail=await call('/api/demo-state?collection=history&id='+encodeURIComponent(id),tokens[employee]);assert.equal(detail.status,200);
  const newer=await call('/api/demo-state',tokens[employee],{...body,mutationId:randomUUID(),operations:[{...body.operations[0],expectedRevision:Number(detail.data.record.revision),payload:{...payload,grade:'C'}}]});assert.equal(newer.status,200);
  const stale=await call('/api/demo-state',tokens[employee],{...body,mutationId:randomUUID()});assert.equal(stale.status,409);
  return id;
};
const savedIds=await Promise.all(Array.from({length:24},(_,i)=>grade(i)));
const summary=await call('/api/stats?insights=1&productType=laptop&batch=qa-batch',manager);
assert.equal(summary.status,200);assert.ok(summary.data.completed>=savedIds.length);
for(const [i,user] of users.entries()) {
  const stats=await call('/api/stats?insights=1&employee='+encodeURIComponent(user.id),tokens[i]);
  assert.equal(stats.status,200);assert.equal(stats.data.completed,6);assert.equal(stats.data.counts.C,6);
  const other=await call('/api/stats?insights=1&employee='+encodeURIComponent(users[(i+1)%4].id),tokens[i]);
  assert.equal(other.status,200);assert.equal(other.data.completed,0);
}
await call('/__qa__/quota?on=1');
const blocked=await call('/api/stats?insights=1',manager);assert.equal(blocked.status,503);assert.equal(blocked.data.code,'STORAGE_QUOTA_EXCEEDED');
await call('/__qa__/quota?on=0');
const recovered=await call('/api/stats?insights=1&batch=qa-batch',manager);assert.equal(recovered.status,200);assert.ok(recovered.data.completed>=24);
console.log(JSON.stringify({localOnly:true,operators:4,assessments:24,replays:24,staleWritesRejected:24,quotaRecovered:true,
  inspectionArchiveNotTransferred:!JSON.stringify(recovered.data).includes('synthetic'),realPrinterTested:false}));

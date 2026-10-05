// Synthetic localhost QA through the ACTUAL HTTP handlers and Neon SDK.
// Never imports .env or connects to a remote database. PGlite is disposable.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { neonConfig } from '@neondatabase/serverless';
import { createRecordStore, snapshotRecords } from '../api/_lib/record-state.mjs';
import { emptyState } from '../api/_lib/state-core.mjs';
import { passwordHash } from '../api/_lib/session-auth.mjs';

process.env.REMARKT_DATABASE_URL='postgresql://qa:fake@qa.neon.tech/qa';
process.env.REMARKT_WORKSPACE_ID='recovery-local-qa';
process.env.REMARKT_STORAGE_FORMAT='3';
process.env.REMARKT_SESSION_SECRET='synthetic-local-session-secret-not-used-in-production';
const db=new PGlite();
await db.exec(await fs.readFile(new URL('../migrations/003-record-storage.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../migrations/005-backup-monitor.sql',import.meta.url),'utf8'));
await db.query('INSERT INTO remarkt_workspaces(id) VALUES ($1)',[process.env.REMARKT_WORKSPACE_ID]);
const sql=(parts,...values)=>{
  const text=parts.reduce((out,part,i)=>out+(i?`$${i}`:'')+part,'');
  return db.query(text,values).then(result=>result.rows);
};
const store=createRecordStore(sql,process.env.REMARKT_WORKSPACE_ID);
await store.merge({mutationId:randomUUID(),operations:snapshotRecords({...emptyState(),users:[{
  id:'qa-manager',naam:'QA Manager',rol:'Manager',voorkeur:'beginner',laptopAccess:'grade',monitorAccess:'grade',passwordHash:passwordHash('StorageQA123!'),
}],batches:[{id:'qa-batch',nummer:'QA',leverancier:'Synthetic supplier',laptops:[{
  sticker:'QA-100',serial:'MP2526X1',merk:'Dell',model:'Latitude QA',processor:'i5',ram:'8GB',ssd:'256GB',display:'14 inch',battery:'90%',batchId:'qa-batch',batchNummer:'QA',
}]}]}).map(row=>({...row,expectedRevision:0}))});
let quota=false;
neonConfig.fetchFunction=async(_url,options)=>{
  if(quota)return new Response(JSON.stringify({message:'quota exceeded',code:'53000'}),{status:402});
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
      const results=[];for(const q of body.queries)results.push(await execute(tx,q));return results;
    })}:await execute(db,body);
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  }catch(error){return new Response(JSON.stringify({message:error.message,code:error.code}),{status:400});}
};
const handlers={
  '/api/demo-state':(await import('../api/demo-state.mjs')).default,
  '/api/session':(await import('../api/session.mjs')).default,
  '/api/stats':(await import('../api/stats.mjs')).default,
  '/api/health':(await import('../api/health.mjs')).default,
};
const root=process.cwd();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.status=code=>{res.statusCode=code;return res;};
  res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  try{
    if(url.pathname==='/__qa__/quota'){quota=url.searchParams.get('on')==='1';return res.json({quota});}
    if(handlers[url.pathname])return await handlers[url.pathname](req,res);
    if(url.pathname!=='/' && !url.pathname.startsWith('/assets/'))return res.status(404).json({error:'Not found'});
    const file=path.resolve(root,url.pathname==='/'?'index.html':'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root+path.sep))return res.status(403).json({error:'Forbidden'});
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.status(500).json({error:'Synthetic QA request failed'});}
}).listen(8094,'127.0.0.1',()=>console.log('Record QA http://127.0.0.1:8094 ; qa-manager / StorageQA123! ; synthetic data only'));

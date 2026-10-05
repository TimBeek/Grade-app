// Disposable localhost-only storage QA. Never uses .env or operational files.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createShardedStore } from '../api/_lib/sharded-state.mjs';
import { emptyState, toEnvelope, fromBody } from '../api/_lib/state-core.mjs';
import { createHash } from 'node:crypto';

const db = new PGlite();
const sql = (strings, ...values) => {
  const query = { text: strings.reduce((out, part, i) => out + (i ? `$${i}` : '') + part, ''), values };
  query.then = (resolve, reject) => db.query(query.text, query.values).then(result => result.rows).then(resolve, reject);
  return query;
};
sql.transaction = queries => db.transaction(async tx => {
  const results = [];
  for (const query of queries) results.push((await tx.query(query.text, query.values)).rows);
  return results;
});
const schema = () => db.exec(`CREATE TABLE IF NOT EXISTS remarkt_app_state (
  id TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), byte_size INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS remarkt_app_backups (id BIGSERIAL PRIMARY KEY, payload JSONB NOT NULL,
  reason TEXT NOT NULL DEFAULT 'daily', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), byte_size INTEGER NOT NULL DEFAULT 0);`);
await schema();
const store = createShardedStore(sql, schema);
await store.replace({ ...emptyState(), users: [{
  id: 'qa-manager', naam: 'QA Manager', rol: 'Manager', voorkeur: 'beginner',
  passwordHash: createHash('sha256').update('remarkt-demo:StorageQA123!').digest('hex'),
}], batches: [{ id:'qa-batch', nummer:'QA', leverancier:'QA supplier', laptops:[{
  sticker:'QA-100', merk:'Dell', model:'Latitude QA', serial:'QA-SN-100', processor:'i5', ram:'8GB', ssd:'256GB',
  display:'14 inch', batchId:'qa-batch', batchNummer:'QA',
}] }], history:[{id:'qa-original',sticker:'OLD',grade:'B',user_id:'qa-manager',savedAt:new Date().toISOString()}] });

let quota = false;
const root = process.cwd();
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml' };
const json = (res, status, data) => { res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(data)); };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__qa__/quota') { quota = url.searchParams.get('on') !== '0'; return json(res,200,{quota}); }
    if (url.pathname.startsWith('/api/')) {
      if (quota) return json(res,503,{ok:false,code:'STORAGE_QUOTA_EXCEEDED'});
      if (url.pathname === '/api/stats') return json(res,200,await store.readStats());
      if (url.pathname === '/api/demo-state') {
        if (req.method === 'POST') {
          let body = ''; for await (const chunk of req) body += chunk;
          return json(res,200,{ok:true,...await store.merge(fromBody(JSON.parse(body)))});
        }
        const meta = await store.peekMeta();
        if (url.searchParams.has('meta')) return json(res,200,{updatedAt:meta.updatedAt});
        if (url.searchParams.has('users')) return json(res,200,{users:meta.users});
        if (url.searchParams.has('since')) {
          const delta = await store.readChanges(Number(url.searchParams.get('since')));
          if (delta) return json(res,200,delta);
        }
        return json(res,200,toEnvelope(await store.readState()));
      }
      return json(res,404,{ok:false});
    }
    if (url.pathname !== '/' && !url.pathname.startsWith('/assets/')) { res.writeHead(404); return res.end(); }
    const file = path.resolve(root, url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    const content = await fs.readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'}); res.end(content);
  } catch (error) { json(res,500,{error:error.message}); }
}).listen(8093,'127.0.0.1',()=>console.log('Synthetic storage QA: http://127.0.0.1:8093 — test credentials StorageQA123!'));

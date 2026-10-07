// Local in-memory Postgres only; no live connection or source data.
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {readRecordInsights} from '../api/_lib/record-insights.mjs';
const db=new PGlite();
try {
  await db.exec(await readFile(new URL('../migrations/003-record-storage.sql',import.meta.url),'utf8'));
  await db.exec("INSERT INTO remarkt_workspaces(id) VALUES('benchmark')");
  await db.exec(`INSERT INTO remarkt_records(workspace_id,collection,id,batch_id,payload,summary,revision,sticker,user_id,occurred_ms,duration_sec)
    SELECT 'benchmark','batches','b'||n,'b'||n,'{}',jsonb_build_object('nummer','Batch '||n,'leverancier','Supplier'),1,'','',0,0 FROM generate_series(1,100) n;
    INSERT INTO remarkt_records(workspace_id,collection,id,batch_id,payload,summary,revision,sticker,user_id,occurred_ms,duration_sec)
    SELECT 'benchmark',collection,collection||n,'b'||(n%100+1),'{}',
      CASE WHEN collection='history' THEN jsonb_build_object('grade','B','user_naam','Employee','result',jsonb_build_object('problems','[]'::jsonb))
      ELSE jsonb_build_object('leverancier_class','B') END,
      1,n::text,CASE WHEN collection='history' THEN 'one' ELSE '' END,
      (extract(epoch FROM now())*1000)::bigint,60 FROM generate_series(1,10000) n CROSS JOIN (VALUES('history'),('laptops')) c(collection);
    ANALYZE remarkt_records;`);
  let statement,values;
  const sql=(parts,...args)=>{
    statement=parts.reduce((s,p,i)=>s+(i?'$'+i:'')+p,'');values=args;
    return db.query(statement,args).then(result=>result.rows);
  };
  const filters={productType:'all',employee:'all',batch:'all',brand:'all',grade:'all',status:'all',query:'',dateRange:'all',viewer:''};
  const start=performance.now(),result=await readRecordInsights(sql,'benchmark',filters);
  console.log(`10,000 assessments + 10,000 laptops + 100 batches: ${Math.round(performance.now()-start)} ms; ${JSON.stringify(result).length} bytes; completed=${result.completed}; open=${result.open}`);
  const plan=await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) '+statement,values);
  console.log(plan.rows.map(row=>row['QUERY PLAN']).filter(line=>/Execution Time|Join|Scan|Rows Removed/.test(line)).join('\n'));
} finally {await db.close();}

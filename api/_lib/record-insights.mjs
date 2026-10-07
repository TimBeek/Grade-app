// Filter and aggregate in Postgres. No assessment payload/inspection archive
// leaves the database; result size grows with chart categories, not devices.
import { storageError } from './storage-safety.mjs';
export function insightFilters(params, user) {
  const values={};
  for(const key of ['productType','dateRange','employee','batch','brand','grade','status','query'])
    values[key]=String(params.get(key) || (key==='query'?'':'all')).slice(0,key==='query'?160:100);
  if(!['all','laptop','monitor'].includes(values.productType) || !['all','today','week','month'].includes(values.dateRange) ||
    !['all','graded','repair','open','label'].includes(values.status) || !['all','A','B','C','X'].includes(values.grade))
    throw storageError('REQUEST_INVALID','Invalid analysis filter.',400);
  values.viewer=/^(manager|admin)$/i.test(user.rol)?'':user.id;
  return values;
}
const percent=(part,total)=>total?Math.round(Number(part)*100/Number(total)):0;
export async function readRecordInsights(sql,workspace,f) {
  const search=`%${f.query.replace(/[\\%_]/g,'\\$&')}%`;
  // Keep this projection inline so batch joins can use the existing primary
  // key instead of scanning a materialized copy of every workspace record.
  const rows=await sql`WITH records AS NOT MATERIALIZED (
    SELECT collection,id,batch_id,sticker,user_id,occurred_ms,started_ms,duration_sec,summary,search_text
    FROM remarkt_records WHERE workspace_id=${workspace} AND NOT deleted
  ), completion AS MATERIALIZED (
    SELECT sticker,bool_or(collection='history') graded,bool_or(collection='labelPrints') labelled,
      bool_or(collection='monitorLabelPrints') monitor_labelled
    FROM remarkt_records WHERE workspace_id=${workspace} AND NOT deleted
      AND collection IN ('history','labelPrints','monitorLabelPrints') GROUP BY sticker
  ), raw AS (
    SELECT r.*,COALESCE(NULLIF(r.summary->>'batchNummer',''),b.summary->>'nummer',NULLIF(r.batch_id,''),'—') batch,
      COALESCE(b.summary->>'leverancier',r.summary->>'leverancier','Unknown') supplier,
      COALESCE(NULLIF(r.summary->>'user_naam',''),NULLIF(r.user_id,''),'Unknown') employee,
      COALESCE(r.summary->>'merk','') brand,
      CASE WHEN r.collection IN ('monitorLabelPrints','monitors') THEN 'monitor' ELSE 'laptop' END product,
      CASE WHEN r.collection IN ('laptops','monitors') THEN 'open' WHEN r.collection='labelPrints' THEN 'label'
        WHEN upper(r.summary->>'grade') IN ('D','X') OR CASE WHEN jsonb_typeof(r.summary->'result'->'problems')='array' THEN jsonb_array_length(r.summary->'result'->'problems') ELSE 0 END>0 THEN 'repair' ELSE 'graded' END status,
      CASE WHEN jsonb_typeof(r.summary->'result'->'problems')='array' THEN r.summary->'result'->'problems' ELSE '[]'::jsonb END problem_array,
      CASE WHEN jsonb_typeof(r.summary->'result'->'repairActions')='array' THEN r.summary->'result'->'repairActions' ELSE '[]'::jsonb END repair_actions,
      CASE WHEN upper(r.summary->>'grade') IN ('D','X') THEN 'D' ELSE upper(r.summary->>'grade') END grade,
      upper(substring(COALESCE(NULLIF(r.summary->>'leverancier_class',''),r.summary->>'supplierGradeRaw',l.summary->>'leverancier_class','')
        from '(?i)(?:CLASS|GRADE)?[[:space:]]*([ABCDX])(?:[^[:alnum:]_]|$)')) supplier_grade_raw,
      CASE WHEN r.occurred_ms>0 THEN to_timestamp(r.occurred_ms/1000.0)
        WHEN b.occurred_ms>0 THEN to_timestamp(b.occurred_ms/1000.0) ELSE now() END at,
      COALESCE((r.summary->>'_repairLabel')::boolean,false) repair_label,
      COALESCE(r.summary->'result'->>'repairLabelType',r.summary->'result'->'repairPolicy'->>'labelType','reject') route
    FROM records r LEFT JOIN records b ON b.collection=CASE WHEN r.collection IN ('monitorLabelPrints','monitors') THEN 'monitorBatches' ELSE 'batches' END AND b.id=r.batch_id
    LEFT JOIN completion done ON done.sticker=r.sticker
    LEFT JOIN LATERAL (SELECT summary FROM remarkt_records WHERE workspace_id=${workspace} AND NOT deleted AND collection='laptops' AND sticker=r.sticker
      AND r.collection='history' AND NULLIF(r.summary->>'leverancier_class','') IS NULL AND r.summary->>'supplierGradeRaw' IS NULL
      ORDER BY (batch_id=r.batch_id) DESC,id LIMIT 1) l ON true
    WHERE r.collection IN ('history','labelPrints','monitorLabelPrints','laptops','monitors')
      AND NOT (COALESCE(done.graded,false) AND r.collection IN ('laptops','labelPrints') OR
        COALESCE(done.labelled,false) AND r.collection='laptops' OR
        COALESCE(done.monitor_labelled,false) AND r.collection='monitors')
      AND (${f.viewer}='' OR r.user_id=${f.viewer} OR r.collection IN ('laptops','monitors'))
  ), enriched AS (
    SELECT *,CASE WHEN supplier_grade_raw='X' THEN 'D' ELSE supplier_grade_raw END supplier_grade,
      (at AT TIME ZONE 'Europe/Amsterdam')::date AS day,
      (CASE grade WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 WHEN 'D' THEN 1 END)-
      (CASE supplier_grade_raw WHEN 'A' THEN 4 WHEN 'B' THEN 3 WHEN 'C' THEN 2 WHEN 'D' THEN 1 WHEN 'X' THEN 1 END) delta
    FROM raw
  ), selected AS MATERIALIZED (
    SELECT * FROM enriched WHERE (${f.productType}='all' OR product=${f.productType})
      AND (${f.employee}='all' OR employee=${f.employee} OR user_id=${f.employee})
      AND (${f.batch}='all' OR batch=${f.batch} OR batch_id=${f.batch})
      AND (${f.brand}='all' OR brand=${f.brand})
      AND (${f.grade}='all' OR grade=CASE WHEN ${f.grade}='X' THEN 'D' ELSE ${f.grade} END)
      AND (${f.status}='all' OR status=${f.status})
      AND (${f.query}='' OR concat_ws(' ',search_text,supplier,summary->>'serial',summary->>'model',summary->'result'->'problems') ILIKE ${search})
      AND (${f.dateRange}='all' OR (${f.dateRange}='today' AND day=(now() AT TIME ZONE 'Europe/Amsterdam')::date) OR
        (${f.dateRange} IN ('week','month') AND at<=now() AND day>=(now() AT TIME ZONE 'Europe/Amsterdam')::date-
          CASE WHEN ${f.dateRange}='week' THEN 6 ELSE 29 END))
  ), completed AS (SELECT * FROM selected WHERE status IN ('graded','repair')),
  timing AS (
    SELECT *,max(occurred_ms) OVER(PARTITION BY user_id,day ORDER BY started_ms,occurred_ms ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prev_end
      FROM completed WHERE product='monitor' AND started_ms>0 AND occurred_ms>=started_ms AND duration_sec BETWEEN 1 AND 1200
  ), flags AS (
    SELECT *,sum(CASE WHEN prev_end IS NULL OR started_ms-prev_end>1200000 THEN 1 ELSE 0 END)
      OVER(PARTITION BY user_id,day ORDER BY started_ms,occurred_ms) session_id FROM timing
  ), sessions AS (
    SELECT user_id,day,session_id,count(*) units,greatest(1,round((max(occurred_ms)-min(started_ms))/1000.0)) seconds
      FROM flags GROUP BY user_id,day,session_id
  ), comparisons AS (SELECT * FROM completed WHERE collection='history' AND delta IS NOT NULL),
  repair AS (SELECT * FROM completed WHERE collection='history' AND repair_label),
  actions AS (
    SELECT r.*,a.value action FROM repair r CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_array_length(repair_actions)>0
        THEN repair_actions ELSE '[{"repairSeverity":"reject"}]'::jsonb END) a
  ), bins AS (
    SELECT CASE WHEN lower(action->>'componentId')='lcd' THEN 'Display / screen'
      WHEN lower(action->>'componentId') IN ('scharnier','scharnieren') THEN 'Hinges'
      WHEN lower(action->>'componentId') IN ('keyboard','toetsenbord') THEN 'Keyboard'
      WHEN lower(action->>'componentId')='touchpad' THEN 'Touchpad'
      WHEN lower(action->>'componentId') IN ('bovenkap','zijkant','onderkant','palmrest') THEN 'Housing / cosmetic'
      WHEN concat_ws(' ',action->>'issue',action->>'triggerId') ~* 'batter|accu|power|voeding' THEN 'Battery / power'
      WHEN concat_ws(' ',action->>'issue',action->>'triggerId') ~* 'usb|poort|port|hdmi' THEN 'Ports'
      WHEN concat_ws(' ',action->>'issue',action->>'triggerId') ~* 'key|toets' THEN 'Keyboard'
      WHEN concat_ws(' ',action->>'issue',action->>'triggerId') ~* 'lcd|scherm|pixel|display|screen' THEN 'Display / screen'
      WHEN concat_ws(' ',action->>'issue',action->>'triggerId') ~* 'touch' THEN 'Touchpad'
      WHEN concat_ws(' ',action->>'issue',action->>'triggerId') ~* 'scharnier|hinge' THEN 'Hinges' ELSE 'Other' END bin,
      COALESCE(action->>'repairSeverity','light') severity FROM actions
  ) SELECT jsonb_build_object(
    'revision',(SELECT revision FROM remarkt_workspaces WHERE id=${workspace}),
    'total',(SELECT count(*) FROM selected),'completed',(SELECT count(*) FROM completed),'open',(SELECT count(*) FROM selected WHERE status='open'),
    'today',(SELECT count(*) FROM completed WHERE day=(now() AT TIME ZONE 'Europe/Amsterdam')::date),
    'week',(SELECT count(*) FROM completed WHERE day>=(now() AT TIME ZONE 'Europe/Amsterdam')::date-6 AND at<=now()),
    'grades',COALESCE((SELECT jsonb_object_agg(grade,n) FROM (SELECT grade,count(*) n FROM completed WHERE grade IN ('A','B','C','D') GROUP BY grade) g),'{}'),
    'facets',jsonb_build_object('employee',COALESCE((SELECT jsonb_agg(DISTINCT employee ORDER BY employee) FROM enriched WHERE collection IN ('history','labelPrints','monitorLabelPrints')),'[]'),
      'batch',COALESCE((SELECT jsonb_agg(DISTINCT batch ORDER BY batch) FROM enriched),'[]'),
      'brand',COALESCE((SELECT jsonb_agg(DISTINCT brand ORDER BY brand) FROM enriched WHERE brand<>''),'[]')),
    'durations',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT product,user_id,count(*) total,
      count(*) FILTER(WHERE duration_sec>0 AND (product='laptop' OR started_ms>0 AND occurred_ms>=started_ms AND duration_sec<=1200)) measured,
      avg(duration_sec) FILTER(WHERE duration_sec>0) avg,
      sum(duration_sec) FILTER(WHERE duration_sec>0 AND (product='laptop' OR started_ms>0 AND occurred_ms>=started_ms AND duration_sec<=1200)) seconds,
      percentile_cont(0.5) WITHIN GROUP(ORDER BY duration_sec) FILTER(WHERE duration_sec>0 AND (product='laptop' OR started_ms>0 AND occurred_ms>=started_ms AND duration_sec<=1200)) median,
      percentile_cont(0.9) WITHIN GROUP(ORDER BY duration_sec) FILTER(WHERE duration_sec>0 AND (product='laptop' OR started_ms>0 AND occurred_ms>=started_ms AND duration_sec<=1200)) p90,
      count(*) FILTER(WHERE product='monitor' AND duration_sec>1200 AND started_ms>0) interrupted,
      count(*) FILTER(WHERE product='monitor' AND (summary->>'entryMode'='manual' OR batch_id='monitor_manual')) manual
      FROM completed GROUP BY product,user_id) t),'[]'),
    'overallTiming',COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT product,count(*) total,
      count(*) FILTER(WHERE duration_sec>0 AND (product='laptop' OR started_ms>0 AND occurred_ms>=started_ms AND duration_sec<=1200)) measured,
      sum(duration_sec) FILTER(WHERE duration_sec>0 AND (product='laptop' OR started_ms>0 AND occurred_ms>=started_ms AND duration_sec<=1200)) seconds,
      percentile_cont(0.5) WITHIN GROUP(ORDER BY duration_sec) FILTER(WHERE duration_sec>0 AND (product='laptop' OR started_ms>0 AND occurred_ms>=started_ms AND duration_sec<=1200)) median,
      percentile_cont(0.9) WITHIN GROUP(ORDER BY duration_sec) FILTER(WHERE duration_sec>0 AND (product='laptop' OR started_ms>0 AND occurred_ms>=started_ms AND duration_sec<=1200)) p90,
      count(*) FILTER(WHERE product='monitor' AND duration_sec>1200 AND started_ms>0) interrupted,
      count(*) FILTER(WHERE product='monitor' AND (summary->>'entryMode'='manual' OR batch_id='monitor_manual')) manual
      FROM completed GROUP BY product) t),'[]'),
    'sessions',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT user_id,count(*) sessions,sum(units) units,sum(seconds) seconds FROM sessions GROUP BY user_id) s),'[]'),
    'employees',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY name) FROM (SELECT user_id,employee name,
      count(*) FILTER(WHERE status IN ('graded','repair')) count,count(*) FILTER(WHERE status='label') labels,
      count(*) FILTER(WHERE status='repair') repair FROM selected WHERE collection IN ('history','labelPrints','monitorLabelPrints') GROUP BY user_id,employee) e),'[]'),
    'trend',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY day) FROM (SELECT day,count(*) value,count(*) FILTER(WHERE status='repair') repair
      FROM completed WHERE day>=(now() AT TIME ZONE 'Europe/Amsterdam')::date-6 AND at<=now() GROUP BY day) t),'[]'),
    'comparisons',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT batch_id,batch,supplier,supplier_grade,grade,count(*) n
      FROM comparisons GROUP BY batch_id,batch,supplier,supplier_grade,grade) c),'[]'),
    'repairCount',(SELECT count(*) FROM repair),
    'repairRoutes',COALESCE((SELECT jsonb_object_agg(route,n) FROM (SELECT route,count(*) n FROM repair GROUP BY route) r),'{}'),
    'repairBatches',COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY repair DESC) FROM (SELECT batch,count(*) graded,
      count(*) FILTER(WHERE repair_label) repair,count(*) FILTER(WHERE repair_label AND route='production') production,
      count(*) FILTER(WHERE repair_label AND route='direct') direct,count(*) FILTER(WHERE repair_label AND route NOT IN ('production','direct')) reject
      FROM completed WHERE collection='history' GROUP BY batch) b),'[]'),
    'bins',COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY total DESC) FROM (SELECT bin,count(*) total,
      count(*) FILTER(WHERE severity NOT IN ('heavy','reject')) light,count(*) FILTER(WHERE severity='heavy') heavy,count(*) FILTER(WHERE severity='reject') reject FROM bins GROUP BY bin) b),'[]'),
    'causes',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT problem label,count(*) value FROM repair
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_array_length(problem_array)>0
        THEN problem_array ELSE '["X / repair"]'::jsonb END) problem GROUP BY problem ORDER BY value DESC,problem LIMIT 8) c),'[]')
  ) result`;
  const data=rows[0].result;
  data.counts={A:0,B:0,C:0,D:0,...data.grades};
  const timing=(product,items,sessionRows)=>{
    const totals=items.filter(row=>row.product===product).reduce((a,row)=>{
      for(const key of ['total','measured','seconds','interrupted','manual'])a[key]+=Number(row[key]||0);
      a.median=Math.round(Number(row.median||0));a.p90=Math.round(Number(row.p90||0));return a;
    },{total:0,measured:0,seconds:0,interrupted:0,manual:0,median:0,p90:0});
    const sessions=sessionRows.reduce((a,row)=>({sessions:a.sessions+Number(row.sessions),seconds:a.seconds+Number(row.seconds)}),{sessions:0,seconds:0});
    return {...totals,coverage:percent(totals.measured,totals.total),avgSec:totals.measured?Math.round(totals.seconds/totals.measured):0,
      medianSec:totals.median,p90Sec:totals.p90,medianCycleSec:totals.median,p90CycleSec:totals.p90,
      sessions:sessions.sessions,avgUnitsPerSession:sessions.sessions?Math.round(totals.measured*10/sessions.sessions)/10:0,
      avgActiveSec:totals.measured?Math.round(sessions.seconds/totals.measured):0,
      planningSec:totals.measured?Math.round(sessions.seconds/totals.measured/0.85):0,barcode:totals.total-totals.manual,
      perActiveHour:(product==='monitor'?sessions.seconds:totals.seconds)>0?Math.round(totals.measured*36000/(product==='monitor'?sessions.seconds:totals.seconds))/10:0};
  };
  data.laptopTiming=timing('laptop',data.overallTiming,[]);data.monitorTiming=timing('monitor',data.overallTiming,data.sessions);
  data.employees=data.employees.map(row=>({...row,laptop:timing('laptop',data.durations.filter(t=>t.user_id===row.user_id),[]),
    monitor:timing('monitor',data.durations.filter(t=>t.user_id===row.user_id),data.sessions.filter(t=>t.user_id===row.user_id))}));
  const summary={total:0,improved:0,same:0,downgraded:0,netDelta:0,toAFromLower:0},batches=new Map(),suppliers=new Map();
  const finish=row=>({...row,improvedPercent:percent(row.improved,row.total),samePercent:percent(row.same,row.total),
    downgradedPercent:percent(row.downgraded,row.total),avgUplift:row.total?Math.round(row.netDelta*100/row.total)/100:0});
  for(const row of data.comparisons) {
    const delta={A:4,B:3,C:2,D:1}[row.grade]-{A:4,B:3,C:2,D:1}[row.supplier_grade];
    const type=delta>0?'improved':delta<0?'downgraded':'same',n=Number(row.n);
    const batchKey=row.batch_id || row.batch;
    const batch=batches.get(batchKey)||{...summary,batchKey,batchNummer:row.batch,batchSupplier:row.supplier,transitions:[]};
    const supplier=suppliers.get(row.supplier)||{...summary,supplier:row.supplier,toA:0};
    for(const item of [summary,batch,supplier]) {item.total+=n;item[type]+=n;item.netDelta+=delta*n;if(row.grade==='A' && row.supplier_grade!=='A')item.toAFromLower+=n;}
    supplier.toA=supplier.toAFromLower;batch.transitions.push({label:`${row.supplier_grade==='D'?'X':row.supplier_grade} -> ${row.grade==='D'?'X':row.grade}`,count:n});
    batches.set(batchKey,batch);suppliers.set(row.supplier,supplier);
  }
  data.supplierStats={summary:finish(summary),batches:[...batches.values()].map(finish).sort((a,b)=>b.total-a.total)};
  data.supplierScorecard=[...suppliers.values()].map(finish).sort((a,b)=>b.avgUplift-a.avgUplift || b.total-a.total);
  data.repairBatches=data.repairBatches.map(row=>({...row,rate:percent(row.repair,row.graded)}));
  return data;
}

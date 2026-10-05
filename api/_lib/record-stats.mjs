// Aggregation takes place inside Postgres. Only the resulting counters leave it.
export async function readRecordStats(sql, workspaceId) {
  const rows = await sql`WITH records AS MATERIALIZED (
    SELECT collection,id,batch_id,sticker,user_id,occurred_ms,started_ms,duration_sec,summary
      FROM remarkt_records WHERE workspace_id = ${workspaceId} AND NOT deleted
  ), events AS (
    SELECT *, COALESCE(NULLIF(summary->>'grade',''),'?') AS grade,
      COALESCE(NULLIF(summary->>'user_naam',''),NULLIF(user_id,''),'Unknown') AS operator,
      CASE WHEN occurred_ms > 0 THEN (to_timestamp(occurred_ms/1000.0) AT TIME ZONE 'Europe/Amsterdam')::date END AS day
      FROM records WHERE collection IN ('history','monitorLabelPrints')
  ), totals AS (
    SELECT count(*) AS graded,count(*) FILTER(WHERE collection='history') AS laptops,
      count(*) FILTER(WHERE collection='monitorLabelPrints') AS monitors,
      count(*) FILTER(WHERE day=(now() AT TIME ZONE 'Europe/Amsterdam')::date) AS today,
      count(*) FILTER(WHERE occurred_ms >= extract(epoch FROM now()-interval '7 days')*1000) AS week,
      count(*) FILTER(WHERE grade ~* '^(d|x)$|repair|reparat') AS repair,
      round(avg(duration_sec) FILTER(WHERE collection='history' AND duration_sec > 0)) AS avg_seconds
    FROM events
  ), stock_gaps AS (
    SELECT l.batch_id,l.sticker,
      EXISTS(SELECT 1 FROM records completed WHERE completed.collection IN ('history','labelPrints') AND completed.sticker=l.sticker) AS done,
      EXISTS(SELECT 1 FROM records b CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(b.summary->'completionReview'->'verifiedStickers','[]'::jsonb)) v
        WHERE b.collection='batches' AND b.batch_id=l.batch_id AND b.summary->'completionReview'->>'status'='physically_complete'
          AND regexp_replace(v.value,'^0+(?=[0-9])','')=l.sticker) AS verified,
      EXISTS(SELECT 1 FROM records a WHERE a.collection='auditLogs' AND a.summary->>'entityType'='laptop'
        AND a.summary->>'action' IN ('print_label','print_label_failed','print_label_attempt','print_label_fallback_opened')
        AND regexp_replace(a.summary->>'entityId','^0+(?=[0-9])','')=l.sticker) AS attempted
      FROM records l WHERE l.collection='laptops'
  ), timing AS (
    SELECT *,max(occurred_ms) OVER(PARTITION BY user_id ORDER BY started_ms,occurred_ms ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_end
      FROM events WHERE collection='monitorLabelPrints' AND started_ms > 0 AND occurred_ms >= started_ms AND duration_sec BETWEEN 1 AND 1200
  ), session_flags AS (
    SELECT *,sum(CASE WHEN prev_end IS NULL OR started_ms-prev_end > 1200000 THEN 1 ELSE 0 END)
      OVER(PARTITION BY user_id ORDER BY started_ms,occurred_ms) AS session_id FROM timing
  ), sessions AS (
    SELECT user_id,session_id,count(*) AS units,greatest(1,round((max(occurred_ms)-min(started_ms))/1000.0)) AS seconds
      FROM session_flags GROUP BY user_id,session_id
  ) SELECT jsonb_build_object(
    'generatedAt',now(),'storageRevision',(SELECT revision FROM remarkt_workspaces WHERE id=${workspaceId}),
    'updatedAt',(SELECT updated_at FROM remarkt_workspaces WHERE id=${workspaceId}),
    'totals',jsonb_build_object('graded',t.graded,'laptopGraded',t.laptops,'monitorGraded',t.monitors,
      'gradedToday',t.today,'gradedLast7Days',t.week,'repair',t.repair,
      'repairRatePct',CASE WHEN t.graded>0 THEN round(t.repair*1000.0/t.graded)/10 ELSE 0 END,
      'avgDurationSec',t.avg_seconds,'laptopAvgDurationSec',t.avg_seconds,
      'laptopsInVoorraad',(SELECT count(*) FROM records WHERE collection='laptops'),
      'monitorsInVoorraad',(SELECT count(*) FROM records WHERE collection='monitors'),
      'batches',(SELECT count(*) FROM records WHERE collection='batches'),
      'monitorBatches',(SELECT count(*) FROM records WHERE collection='monitorBatches'),
      'users',(SELECT count(*) FROM records WHERE collection='users'),
      'labelPrints',(SELECT count(*) FROM records WHERE collection='labelPrints'),
      'monitorLabelPrints',t.monitors,
      'monitorAvgActiveSec',(SELECT round(sum(seconds)/NULLIF(sum(units),0)) FROM sessions),
      'monitorTimingSamples',(SELECT count(*) FROM timing),'monitorSessions',(SELECT count(*) FROM sessions),
      'monitorTimingCoveragePct',CASE WHEN t.monitors>0 THEN round((SELECT count(*) FROM timing)*100.0/t.monitors) ELSE 0 END),
    'live',jsonb_build_object('today',t.today,
      'laptopToday',(SELECT count(*) FROM events WHERE collection='history' AND day=(now() AT TIME ZONE 'Europe/Amsterdam')::date),
      'monitorToday',(SELECT count(*) FROM events WHERE collection='monitorLabelPrints' AND day=(now() AT TIME ZONE 'Europe/Amsterdam')::date),
      'lastHour',(SELECT count(*) FROM events WHERE occurred_ms>=extract(epoch FROM now()-interval '1 hour')*1000),
      'activeOperators30m',(SELECT count(DISTINCT operator) FROM events WHERE occurred_ms>=extract(epoch FROM now()-interval '30 minutes')*1000),
      'activeOperatorNames',COALESCE((SELECT jsonb_agg(operator) FROM (SELECT DISTINCT operator FROM events
        WHERE occurred_ms>=extract(epoch FROM now()-interval '30 minutes')*1000 ORDER BY operator LIMIT 50) names),'[]'::jsonb),
      'exceptionsToday',(SELECT count(*) FROM events WHERE day=(now() AT TIME ZONE 'Europe/Amsterdam')::date AND grade ~* '^(d|x)$|repair|reparat'),
      'lastActivity',(SELECT jsonb_build_object('at',to_timestamp(occurred_ms/1000.0),'ms',occurred_ms,
        'kind',CASE WHEN collection='history' THEN 'laptop' ELSE 'monitor' END,'sticker',sticker,
        'device',COALESCE(summary->>'deviceName',concat_ws(' ',summary->>'merk',summary->>'model')),'user',operator,'grade',grade)
        FROM events WHERE occurred_ms>0 ORDER BY occurred_ms DESC LIMIT 1),
      'dataHealth',(SELECT jsonb_build_object('digitalGaps',count(*) FILTER(WHERE NOT done),
        'unresolvedGaps',count(*) FILTER(WHERE NOT done AND NOT verified),'verifiedGaps',count(*) FILTER(WHERE NOT done AND verified),
        'printAttemptGaps',count(*) FILTER(WHERE NOT done AND attempted),'healthy',count(*) FILTER(WHERE NOT done AND NOT verified)=0) FROM stock_gaps)),
    'dashboard',jsonb_build_object(
      'groups',COALESCE((SELECT jsonb_agg(jsonb_build_object('collection',collection,'userId',user_id,'count',n,'avg',seconds,'timeTotal',time_total,'timedCount',timed,'counts',counts)) FROM (
        SELECT collection,user_id,count(*) n,round(avg(duration_sec) FILTER(WHERE duration_sec>0)) seconds,
          sum(duration_sec) FILTER(WHERE duration_sec>0) time_total,count(*) FILTER(WHERE duration_sec>0) timed,
          jsonb_build_object('A',count(*) FILTER(WHERE upper(grade)='A'),'B',count(*) FILTER(WHERE upper(grade)='B'),
          'C',count(*) FILTER(WHERE upper(grade)='C'),'D',count(*) FILTER(WHERE upper(grade) IN ('D','X'))) counts
          FROM events GROUP BY collection,user_id) g),'[]'::jsonb),
      'batchRepairs',COALESCE((SELECT jsonb_object_agg(batch_id,jsonb_build_object('graded',graded,'repair',repair,'production',production,'reject',repair-production)) FROM (
        SELECT batch_id,count(*) graded,count(*) FILTER(WHERE (summary->>'_repairLabel')::boolean) repair,
          count(*) FILTER(WHERE (summary->>'_repairLabel')::boolean AND COALESCE(summary->'result'->>'repairLabelType',summary->'result'->'repairPolicy'->>'labelType')='production') production
          FROM events WHERE collection='history' GROUP BY batch_id) b),'{}'::jsonb)),
    'gradeDistribution',COALESCE((SELECT jsonb_object_agg(grade,n) FROM (SELECT grade,count(*) n FROM events GROUP BY grade) grades),'{}'::jsonb),
    'perUser',COALESCE((SELECT jsonb_agg(jsonb_build_object('label',operator,'value',n)) FROM
      (SELECT operator,count(*) n FROM events GROUP BY operator ORDER BY n DESC,operator LIMIT 20) users),'[]'::jsonb),
    'perSupplier',COALESCE((SELECT jsonb_agg(jsonb_build_object('label',supplier,'value',n)) FROM
      (SELECT COALESCE(NULLIF(summary->>'leverancier',''),NULLIF(summary->>'batchNummer',''),'Unknown') supplier,count(*) n
        FROM events WHERE collection='history' GROUP BY supplier ORDER BY n DESC,supplier LIMIT 20) suppliers),'[]'::jsonb),
    'perDay',COALESCE((SELECT jsonb_agg(jsonb_build_object('date',day,'value',n) ORDER BY day) FROM
      (SELECT day,count(*) n FROM events WHERE day IS NOT NULL GROUP BY day ORDER BY day DESC LIMIT 366) days),'[]'::jsonb)
  ) AS stats FROM totals t`;
  return rows[0].stats;
}

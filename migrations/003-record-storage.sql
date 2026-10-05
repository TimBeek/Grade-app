-- Additive only. Source shared_state[_v2], shards and backups remain untouched.
CREATE TABLE IF NOT EXISTS remarkt_workspaces (
  id text PRIMARY KEY, revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS remarkt_records (
  workspace_id text NOT NULL REFERENCES remarkt_workspaces(id),
  collection text NOT NULL, id text NOT NULL, batch_id text NOT NULL DEFAULT '',
  payload jsonb NOT NULL, summary jsonb NOT NULL,
  revision bigint NOT NULL, deleted boolean NOT NULL DEFAULT false,
  sticker text NOT NULL DEFAULT '', serial text NOT NULL DEFAULT '', user_id text NOT NULL DEFAULT '',
  search_text text NOT NULL DEFAULT '', PRIMARY KEY (workspace_id, collection, id)
);
ALTER TABLE remarkt_records ADD COLUMN IF NOT EXISTS occurred_ms bigint NOT NULL DEFAULT 0;
ALTER TABLE remarkt_records ADD COLUMN IF NOT EXISTS started_ms bigint NOT NULL DEFAULT 0;
ALTER TABLE remarkt_records ADD COLUMN IF NOT EXISTS duration_sec double precision NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS remarkt_records_changes_idx ON remarkt_records(workspace_id, revision, collection, id);
CREATE INDEX IF NOT EXISTS remarkt_records_batch_idx ON remarkt_records(workspace_id, collection, batch_id, id) WHERE NOT deleted;
CREATE INDEX IF NOT EXISTS remarkt_records_sticker_idx ON remarkt_records(workspace_id, collection, sticker) WHERE NOT deleted;
CREATE INDEX IF NOT EXISTS remarkt_records_serial_idx ON remarkt_records(workspace_id, collection, serial) WHERE NOT deleted;
CREATE INDEX IF NOT EXISTS remarkt_records_user_idx ON remarkt_records(workspace_id, collection, user_id, id) WHERE NOT deleted;
CREATE INDEX IF NOT EXISTS remarkt_records_time_idx ON remarkt_records(workspace_id, collection, occurred_ms, id) WHERE NOT deleted;
CREATE TABLE IF NOT EXISTS remarkt_mutations (
  workspace_id text NOT NULL REFERENCES remarkt_workspaces(id), id text NOT NULL,
  digest text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
CREATE TABLE IF NOT EXISTS remarkt_rate_limits (
  scope text NOT NULL, window_start bigint NOT NULL, hits integer NOT NULL,
  PRIMARY KEY(scope, window_start)
);
CREATE TABLE IF NOT EXISTS remarkt_backup_health (
  workspace_id text PRIMARY KEY REFERENCES remarkt_workspaces(id), revision bigint NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);
-- Invoker permissions, never SECURITY DEFINER. Each call is a single atomic
-- database transaction; only the tiny revision row serializes writes.
CREATE OR REPLACE FUNCTION remarkt_commit_records(ws text, mutation text, fingerprint text, operations jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  next_revision bigint; op jsonb; existing remarkt_records%ROWTYPE;
  receipt remarkt_mutations%ROWTYPE; changed integer := 0;
  acknowledged jsonb := '{}'::jsonb; response jsonb; marker_collection text;
BEGIN
  SELECT revision INTO next_revision FROM remarkt_workspaces WHERE id = ws FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace requires explicit migration' USING ERRCODE = 'P0004'; END IF;
  SELECT * INTO receipt FROM remarkt_mutations WHERE workspace_id = ws AND id = mutation;
  IF FOUND THEN
    IF receipt.digest <> fingerprint THEN RAISE EXCEPTION 'Mutation identity conflict' USING ERRCODE = 'P0003'; END IF;
    RETURN receipt.result || '{"replayed":true}'::jsonb;
  END IF;
  next_revision := next_revision + 1;
  FOR op IN SELECT value FROM jsonb_array_elements(operations) ORDER BY value->>'collection', value->>'id' LOOP
    SELECT * INTO existing FROM remarkt_records WHERE workspace_id = ws
      AND collection = op->>'collection' AND id = op->>'id';
    IF FOUND AND existing.payload = op->'payload' AND existing.deleted = COALESCE((op->>'deleted')::boolean, false) THEN
      acknowledged := acknowledged || jsonb_build_object(jsonb_build_array(existing.collection, existing.id)::text, existing.revision);
      CONTINUE;
    END IF;
    IF (FOUND AND existing.revision <> (op->>'expectedRevision')::bigint) OR
       (NOT FOUND AND (op->>'expectedRevision')::bigint <> 0) THEN
      RAISE EXCEPTION 'Stale record: % %', op->>'collection', op->>'id' USING ERRCODE = 'P0002';
    END IF;
    IF op->>'collection' IN ('laptops','monitors','batches','monitorBatches') AND
      NOT COALESCE((op->>'deleted')::boolean,false) AND EXISTS (
        SELECT 1 FROM remarkt_records m WHERE m.workspace_id = ws AND NOT m.deleted AND (
          (m.collection = 'deletedBatchIds' AND op->>'collection' IN ('batches','laptops') AND m.id = op->>'batchId') OR
          (m.collection = 'deletedMonitorBatchIds' AND op->>'collection' IN ('monitorBatches','monitors') AND m.id = op->>'batchId') OR
          (m.collection = 'deletedLaptopStickers' AND op->>'collection' = 'laptops' AND m.id = op->>'sticker') OR
          (m.collection = 'deletedMonitorStickers' AND op->>'collection' = 'monitors' AND m.id = op->>'sticker'))
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(operations) restoring
            WHERE restoring->>'collection' = m.collection AND restoring->>'id' = m.id AND (restoring->>'deleted')::boolean)) THEN
      RAISE EXCEPTION 'Deleted entity requires explicit restoration' USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO remarkt_records(workspace_id, collection, id, batch_id, payload, summary, revision, deleted, sticker, serial, user_id, search_text, occurred_ms, started_ms, duration_sec)
    VALUES (ws, op->>'collection', op->>'id', COALESCE(op->>'batchId',''), op->'payload', op->'summary', next_revision,
      COALESCE((op->>'deleted')::boolean,false), COALESCE(op->>'sticker',''), COALESCE(op->>'serial',''), COALESCE(op->>'userId',''),
      concat_ws(' ', op->'payload'->>'sticker', op->'payload'->>'serial', op->'payload'->>'merk', op->'payload'->>'model',
        op->'payload'->>'user_naam', op->'payload'->>'batchNummer', op->'payload'->>'grade', op->'payload'->>'leverancier_class'),
      COALESCE((op->>'occurredMs')::bigint,0), COALESCE((op->>'startedMs')::bigint,0), COALESCE((op->>'durationSec')::double precision,0))
    ON CONFLICT(workspace_id, collection, id) DO UPDATE SET
      payload = EXCLUDED.payload, summary = EXCLUDED.summary, revision = EXCLUDED.revision,
      deleted = EXCLUDED.deleted, batch_id = EXCLUDED.batch_id, sticker = EXCLUDED.sticker,
      serial = EXCLUDED.serial, user_id = EXCLUDED.user_id, search_text = EXCLUDED.search_text,
      occurred_ms = EXCLUDED.occurred_ms, started_ms = EXCLUDED.started_ms, duration_sec = EXCLUDED.duration_sec;
    acknowledged := acknowledged || jsonb_build_object(jsonb_build_array(op->>'collection', op->>'id')::text, next_revision);
    changed := changed + 1;
    -- Deletion markers prevent old browsers resurrecting a removed product.
    IF op->>'collection' IN ('deletedBatchIds','deletedMonitorBatchIds','deletedLaptopStickers','deletedMonitorStickers') THEN
      marker_collection := CASE op->>'collection'
        WHEN 'deletedBatchIds' THEN 'batches' WHEN 'deletedMonitorBatchIds' THEN 'monitorBatches'
        WHEN 'deletedLaptopStickers' THEN 'laptops' ELSE 'monitors' END;
      UPDATE remarkt_records target SET deleted = NOT COALESCE((op->>'deleted')::boolean,false), revision = next_revision
        WHERE workspace_id = ws AND (
          (collection = marker_collection AND (
            (marker_collection IN ('batches','monitorBatches') AND id = op->>'id') OR
            (marker_collection IN ('laptops','monitors') AND sticker = op->>'id')))
          OR (op->>'collection' = 'deletedBatchIds' AND collection = 'laptops' AND batch_id = op->>'id')
          OR (op->>'collection' = 'deletedMonitorBatchIds' AND collection = 'monitors' AND batch_id = op->>'id'))
        AND (NOT COALESCE((op->>'deleted')::boolean,false) OR NOT EXISTS (
          SELECT 1 FROM remarkt_records m WHERE m.workspace_id = ws AND NOT m.deleted AND (
            (m.collection='deletedBatchIds' AND target.collection IN ('batches','laptops') AND m.id=target.batch_id) OR
            (m.collection='deletedMonitorBatchIds' AND target.collection IN ('monitorBatches','monitors') AND m.id=target.batch_id) OR
            (m.collection='deletedLaptopStickers' AND target.collection='laptops' AND m.id=target.sticker) OR
            (m.collection='deletedMonitorStickers' AND target.collection='monitors' AND m.id=target.sticker))));
    END IF;
  END LOOP;
  IF changed > 0 THEN UPDATE remarkt_workspaces SET revision = next_revision, updated_at = clock_timestamp() WHERE id = ws;
  ELSE next_revision := next_revision - 1; END IF;
  SELECT jsonb_build_object('revision', next_revision, 'updatedAt', updated_at, 'recordRevisions', acknowledged, 'changed', changed)
    INTO response FROM remarkt_workspaces WHERE id = ws;
  INSERT INTO remarkt_mutations(workspace_id,id,digest,result) VALUES(ws,mutation,fingerprint,response);
  RETURN response;
END $$;

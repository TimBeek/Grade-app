-- Protect the active v2 source even from previously deployed code. This gate
-- is installed explicitly during migration, never by routine API startup.
CREATE TABLE IF NOT EXISTS remarkt_storage_cutover (
  id text PRIMARY KEY, workspace_id text NOT NULL, frozen boolean NOT NULL,
  source_revision bigint, target_revision bigint, verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION remarkt_guard_legacy_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM remarkt_storage_cutover WHERE id='shared_state_v2' AND frozen) THEN
    IF TG_TABLE_NAME='remarkt_app_shards' THEN
      RAISE EXCEPTION 'Legacy storage is frozen for a verified cutover. Reload the app.' USING ERRCODE='P0005';
    ELSIF (CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END) IN ('shared_state','shared_state_v2') THEN
      RAISE EXCEPTION 'Legacy storage is frozen for a verified cutover. Reload the app.' USING ERRCODE='P0005';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER remarkt_v2_state_gate BEFORE INSERT OR UPDATE OR DELETE
  ON remarkt_app_state FOR EACH ROW EXECUTE FUNCTION remarkt_guard_legacy_write();
CREATE OR REPLACE TRIGGER remarkt_v2_shard_gate BEFORE INSERT OR UPDATE OR DELETE
  ON remarkt_app_shards FOR EACH ROW EXECUTE FUNCTION remarkt_guard_legacy_write();

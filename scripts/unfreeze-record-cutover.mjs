// Rollback is permitted only before any v3 work changed the verified target.
import {neon} from '@neondatabase/serverless';
import {loadEnv} from './_lib/env.mjs';
loadEnv(process.env.REMARKT_ENV_FILE || '.env.local');
if(!process.argv.includes('--confirm-unfreeze'))throw new Error('Explicit --confirm-unfreeze required.');
const sql=neon(process.env.REMARKT_DATABASE_URL_UNPOOLED);
await sql.transaction([
  sql`LOCK TABLE remarkt_workspaces,remarkt_storage_cutover IN SHARE ROW EXCLUSIVE MODE`,
  sql`DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM remarkt_storage_cutover c JOIN remarkt_workspaces w ON w.id=c.workspace_id
      WHERE c.id='shared_state_v2' AND c.verified_at IS NOT NULL AND w.revision<>c.target_revision) THEN
      RAISE EXCEPTION 'New v3 work exists. Export and reconcile it before rollback.';
    END IF;
    UPDATE remarkt_storage_cutover SET frozen=false WHERE id='shared_state_v2';
  END $$`,
]);
console.log('Legacy gate released. Target preserved; a new migration must be explicitly reconciled.');

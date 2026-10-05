// GET /api/stats -> authoritative dashboard statistics computed from the
// database (not from the client's in-memory copy).

import { kvReadStats, kvWriteStats, kvReadState, kvReadBackupInfo, storageKind, computeStats } from "./_lib/state.mjs";
import { sendStorageError } from './_lib/storage-error.mjs';
import { pgRecordStore, recordStorageEnabled, pgRateLimit, pgReadInsights } from './_lib/postgres-state.mjs';
import { requireSession } from './_lib/session-auth.mjs';
import { apiTelemetry } from './_lib/telemetry.mjs';
import { backupStatus } from './_lib/backup-status.mjs';
import { insightFilters } from './_lib/record-insights.mjs';

export default async function handler(request, response) {
  apiTelemetry(response, 'stats');
  response.setHeader("Cache-Control", "no-store");

  try {
    if (recordStorageEnabled()) {
      const user=await requireSession(request, pgRecordStore(), process.env.REMARKT_WORKSPACE_ID);
      await pgRateLimit('api:'+user.id,500);
      const params=new URL(request.url,'http://local').searchParams;
      if(params.get('insights')==='1') {
        if(request.method!=='GET'){response.status(405).json({ok:false});return;}
        response.status(200).json(await pgReadInsights(insightFilters(params,user)));return;
      }
    }
    // Fast path: this is a tiny precomputed document maintained on every
    // write. It prevents a Manager Live refresh from reading the complete
    // multi-megabyte shared state every 45 seconds.
    const [stats, backup] = await Promise.all([kvReadStats(), kvReadBackupInfo()]);
    if (stats) {
      response.status(200).json({ ...stats, storage: storageKind(), backup:recordStorageEnabled()?
        backupStatus(backup,stats.storageRevision):backup });
      return;
    }

    // Backwards-compatible one-time fallback for states written before the
    // statistics document existed. The next normal save writes it.
    const state = await kvReadState();
    const computed = computeStats(state);
    await kvWriteStats(computed);
    response.status(200).json({ ...computed, storage: storageKind(), backup });
  } catch (error) {
    sendStorageError(response, error);
  }
}

// GET /api/health -> service + storage health and high-level counts.

import { kvReadHealthSummary, kvReadBackupInfo, isStorageConfigured, storageKind } from "./_lib/state.mjs";
import { sendStorageError } from './_lib/storage-error.mjs';
import { recordStorageEnabled, pgRecordStore, pgRateLimit } from './_lib/postgres-state.mjs';
import { requireSession } from './_lib/session-auth.mjs';

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (!isStorageConfigured()) {
    response.status(503).json({
      ok: false,
      service: "remarkt-grading",
      storage: "none",
      error: "Storage not configured (connect Neon Postgres or Redis).",
    });
    return;
  }

  try {
    if(recordStorageEnabled()) {
      const user=await requireSession(request,pgRecordStore(),process.env.REMARKT_WORKSPACE_ID);
      await pgRateLimit('api:'+user.id,500);
    }
    const summary = await kvReadHealthSummary();
    const backup = await kvReadBackupInfo();
    response.status(200).json({
      ok: true,
      service: "remarkt-grading",
      storage: storageKind(),
      workspaceId: String(process.env.REMARKT_WORKSPACE_ID || ''),
      updatedAt: summary && summary.updatedAt ? summary.updatedAt : null,
      counts: summary ? summary.counts : {},
      backup,
    });
  } catch (error) {
    sendStorageError(response, error);
  }
}

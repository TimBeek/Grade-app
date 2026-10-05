// GET /api/health -> service + storage health and high-level counts.

import { kvReadHealthSummary, kvReadBackupInfo, isStorageConfigured, storageKind } from "./_lib/state.mjs";
import { sendStorageError } from './_lib/storage-error.mjs';

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

// GET /api/health -> service + storage health and high-level counts.

import { kvReadState, isStorageConfigured, storageKind } from "./_lib/state.mjs";

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
    const state = await kvReadState();
    response.status(200).json({
      ok: true,
      service: "remarkt-grading",
      storage: storageKind(),
      updatedAt: state.updatedAt,
      counts: {
        users: state.users.length,
        batches: state.batches.length,
        monitorBatches: state.monitorBatches.length,
        history: state.history.length,
        labelPrints: state.labelPrints.length,
        monitorLabelPrints: state.monitorLabelPrints.length,
        auditLogs: state.auditLogs.length,
      },
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      service: "remarkt-grading",
      storage: storageKind(),
      error: String(error && error.message || error),
    });
  }
}

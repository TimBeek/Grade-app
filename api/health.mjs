// GET /api/health -> service + storage health and high-level counts.

import { kvReadState, isKvConfigured } from "./_lib/state.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (!isKvConfigured()) {
    response.status(503).json({
      ok: false,
      service: "remarkt-grading",
      storage: "kv",
      error: "KV not configured (missing KV_REST_API_URL / KV_REST_API_TOKEN).",
    });
    return;
  }

  try {
    const state = await kvReadState();
    response.status(200).json({
      ok: true,
      service: "remarkt-grading",
      storage: "kv",
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
      storage: "kv",
      error: String(error && error.message || error),
    });
  }
}

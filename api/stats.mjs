// GET /api/stats -> authoritative dashboard statistics computed from the
// database (not from the client's in-memory copy).

import { kvReadStats, kvWriteStats, kvReadState, computeStats } from "./_lib/state.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  try {
    // Fast path: this is a tiny precomputed document maintained on every
    // write. It prevents a Manager Live refresh from reading the complete
    // multi-megabyte shared state every 45 seconds.
    const stats = await kvReadStats();
    if (stats) {
      response.status(200).json(stats);
      return;
    }

    // Backwards-compatible one-time fallback for states written before the
    // statistics document existed. The next normal save writes it.
    const state = await kvReadState();
    const computed = computeStats(state);
    await kvWriteStats(computed);
    response.status(200).json(computed);
  } catch (error) {
    response.status(500).json({ ok: false, error: String(error && error.message || error) });
  }
}

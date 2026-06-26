// GET /api/stats -> authoritative dashboard statistics computed from the
// database (not from the client's in-memory copy).

import { kvReadState, computeStats } from "./_lib/state.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  try {
    const state = await kvReadState();
    response.status(200).json(computeStats(state));
  } catch (error) {
    response.status(500).json({ ok: false, error: String(error && error.message || error) });
  }
}

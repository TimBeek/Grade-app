// GET  /api/demo-state -> returns the shared state as a gzip envelope.
// POST /api/demo-state -> merges an incoming snapshot into the stored state.

import {
  kvReadState,
  kvWriteState,
  mergeDemoState,
  toEnvelope,
  fromBody,
} from "./_lib/state.mjs";
import { readJsonBody } from "./_lib/http.mjs";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  try {
    if (request.method === "GET") {
      const state = await kvReadState();
      // `?raw=1` returns the plain state for clients without DecompressionStream
      // and for local debugging. The default response is the gzip envelope.
      const raw = /[?&]raw=1\b/.test(request.url || "");
      response.status(200).json(raw ? state : toEnvelope(state));
      return;
    }

    if (request.method === "POST") {
      const incoming = fromBody(await readJsonBody(request));
      const existing = await kvReadState();
      const merged = mergeDemoState(existing, incoming);
      await kvWriteState(merged);
      response.status(200).json({ ok: true, updatedAt: merged.updatedAt });
      return;
    }

    response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    response.status(400).json({ ok: false, error: String(error && error.message || error) });
  }
}

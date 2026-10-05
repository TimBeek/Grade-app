// GET  /api/demo-state -> returns the shared state as a gzip envelope.
// POST /api/demo-state -> merges an incoming snapshot into the stored state.

import {
  kvReadState,
  kvReadMeta,
  kvReadUsers,
  kvMergeState,
  kvReadChanges,
  toEnvelope,
  fromBody,
} from "./_lib/state.mjs";
import { readJsonBody } from "./_lib/http.mjs";
import { sendStorageError } from './_lib/storage-error.mjs';

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  try {
    if (request.method === "GET") {
      // `?meta=1` is a cheap change-check: just the stored updatedAt (1 command).
      if (/[?&]meta=1\b/.test(request.url || "")) {
        const meta = await kvReadMeta();
        response.status(200).json({ updatedAt: meta && meta.updatedAt ? meta.updatedAt : null });
        return;
      }
      // Login only needs account records. Returning just this small payload
      // avoids sending every batch and historical grading record at sign-in.
      if (/[?&]users=1\b/.test(request.url || "")) {
        response.status(200).json(await kvReadUsers());
        return;
      }
      const since = new URL(request.url, 'http://local').searchParams.get('since');
      if (since !== null) {
        const changes = await kvReadChanges(Number(since));
        if (changes) { response.status(200).json(changes); return; }
      }
      const state = await kvReadState();
      // `?raw=1` returns the plain state for clients without DecompressionStream
      // and for local debugging. The default response is the gzip envelope.
      const raw = /[?&]raw=1\b/.test(request.url || "");
      response.status(200).json(raw ? state : toEnvelope(state));
      return;
    }

    if (request.method === "POST") {
      const incoming = fromBody(await readJsonBody(request));
      const result = await kvMergeState(incoming);
      response.status(200).json({ ok: true, ...result });
      return;
    }

    response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    sendStorageError(response, error);
  }
}

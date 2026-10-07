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
import { pgRecordStore, recordStorageEnabled, pgRateLimit } from './_lib/postgres-state.mjs';
import { requireSession, authorizeOperations, publicUser } from './_lib/session-auth.mjs';
import { storageError } from './_lib/storage-safety.mjs';
import { apiTelemetry } from './_lib/telemetry.mjs';

export default async function handler(request, response) {
  apiTelemetry(response, 'demo-state');
  response.setHeader("Cache-Control", "no-store");
  const workspaceId = String(process.env.REMARKT_WORKSPACE_ID || '').trim();
  if (workspaceId) response.setHeader('X-Remarkt-Workspace', workspaceId);

  try {
    if (recordStorageEnabled()) {
      if (request.method === 'GET' && /[?&]users=1\b/.test(request.url || '')) {
        await pgRateLimit('directory-v2:' + String(request.headers?.['x-forwarded-for'] || 'unknown').split(',')[0].trim(), 600);
        response.status(200).json(await kvReadUsers()); return;
      }
      const store = pgRecordStore();
      const user = await requireSession(request, store, workspaceId);
      await pgRateLimit('api:' + user.id, 500);
      if (request.method === 'GET') {
        const params = new URL(request.url, 'http://local').searchParams;
        if (params.get('meta') === '1') { response.status(200).json(await store.meta()); return; }
        if (params.has('trace')) { response.status(200).json(await store.trace(params.get('trace')));return; }
        if (params.has('since')) { response.status(200).json(await store.changes(Number(params.get('since')), params.get('after') || '')); return; }
        const collection = params.get('collection') || 'batches';
        if (params.has('id')) {
          if (collection === 'users') throw storageError('AUTH_FORBIDDEN', 'Private account records are not downloadable.', 403);
          const row = await store.detail(collection, params.get('id'));
          response.status(200).json({ record: row }); return;
        }
        const result = await store.page({ collection, after: params.get('after') || '', limit: params.get('limit'),
          batchId: params.get('batch') || '', search: params.get('search') || '',
          userId: params.get('user') || '', sticker: params.get('sticker') || '', recent: params.get('recent') === '1', withTotal:params.get('total')==='1' });
        if (collection === 'users') result.records = result.records.map(row => ({ ...row, payload: publicUser(row.payload) }));
        response.status(200).json(result); return;
      }
      if (request.method === 'POST') {
        const incoming = fromBody(await readJsonBody(request));
        if (incoming?.workspaceId !== workspaceId) throw storageError('STORAGE_WORKSPACE_CHANGED', 'Reload the working workspace.', 409);
        authorizeOperations(user, incoming);
        if(!/^(manager|admin)$/i.test(user.rol)) for(const op of incoming.operations || []) {
          if(op.collection==='history' && op.expectedRevision>0) {
            const previous=await store.detail(op.collection,op.id);
            if(previous && previous.payload.user_id!==user.id)throw storageError('AUTH_FORBIDDEN','Only a manager can change another employee assessment.',403);
          }
        }
        // The UI never receives password hashes. Preserve them during profile edits.
        for (const op of incoming.operations || []) if (op.collection === 'users' && op.payload.passwordHash === 'server-managed') {
          const existing = await store.detail('users', op.id);
          if (!existing) throw storageError('REQUEST_INVALID', 'Account does not exist.', 400);
          op.payload.passwordHash = existing.payload.passwordHash;
        }
        response.status(200).json({ ok: true, ...await store.merge(incoming) }); return;
      }
      response.status(405).json({ ok: false }); return;
    }
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
      // Reject pre-cutover tabs instead of importing stale operational records.
      if (workspaceId && incoming?.workspaceId !== workspaceId) {
        response.status(409).json({ ok: false, code: 'STORAGE_WORKSPACE_CHANGED',
          error: 'The working database changed. Reload the app before saving.' });
        return;
      }
      const result = await kvMergeState(incoming);
      response.status(200).json({ ok: true, ...result });
      return;
    }

    response.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (error) {
    sendStorageError(response, error);
  }
}

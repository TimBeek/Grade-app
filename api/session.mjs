import { pgRecordStore, recordStorageEnabled, pgRateLimit } from './_lib/postgres-state.mjs';
import { passwordMatches, passwordHash, issueSession, publicUser, requireSession } from './_lib/session-auth.mjs';
import { readJsonBody } from './_lib/http.mjs';
import { storageError } from './_lib/storage-safety.mjs';
import { sendStorageError } from './_lib/storage-error.mjs';
import { randomUUID } from 'node:crypto';
import { apiTelemetry } from './_lib/telemetry.mjs';

export default async function handler(request, response) {
  apiTelemetry(response, 'session');
  response.setHeader('Cache-Control', 'no-store');
  try {
    if (!recordStorageEnabled()) throw storageError('AUTH_NOT_CONFIGURED', 'Secure storage is not active.');
    if (request.method !== 'POST') return response.status(405).json({ ok: false });
    const store = pgRecordStore(), workspace = process.env.REMARKT_WORKSPACE_ID;
    const body = await readJsonBody(request, 4096);
    await pgRateLimit('login:' + (request.headers?.['x-forwarded-for'] || 'unknown'), 20, 15 * 60 * 1000);
    if (body.action === 'password') {
      const user = await requireSession(request, store, workspace);
      if (body.password === 'ReMarkt2026!' || passwordMatches(body.password, user.passwordHash))
        throw storageError('REQUEST_INVALID', 'Choose a different personal password.', 400);
      const existing = await store.detail('users', user.id);
      const updated = { ...user, passwordHash: passwordHash(body.password), mustChangePassword: false,
        passwordUpdatedAt: new Date().toISOString() };
      await store.merge({ mutationId: randomUUID(), operations: [{ collection: 'users', id: user.id,
        expectedRevision: Number(existing.revision), payload: updated }] });
      return response.status(200).json({ user: publicUser(updated), token: issueSession(updated, workspace) });
    }
    const row = await store.detail('users', String(body.id || '').trim().toLowerCase());
    if (!row || !passwordMatches(body.password, row.payload.passwordHash))
      throw storageError('AUTH_REQUIRED', 'Incorrect login.', 401);
    response.status(200).json({ user: publicUser(row.payload), token: issueSession(row.payload, workspace) });
  } catch (error) { sendStorageError(response, error); }
}

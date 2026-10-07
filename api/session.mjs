import { pgRecordStore, recordStorageEnabled, pgRateLimit, pgCheckRateLimits } from './_lib/postgres-state.mjs';
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
    if (!body || typeof body !== 'object') throw storageError('REQUEST_INVALID', 'Invalid request.', 400);
    if (body.action === 'password') {
      const user = await requireSession(request, store, workspace);
      await pgRateLimit('password-v2:' + user.id, 30);
      if (body.password === 'ReMarkt2026!' || passwordMatches(body.password, user.passwordHash))
        throw storageError('REQUEST_PASSWORD_UNCHANGED', 'Choose a different personal password.', 400);
      const existing = await store.detail('users', user.id);
      if(!existing || existing.payload.passwordHash !== user.passwordHash)
        throw storageError('AUTH_REQUIRED', 'Account changed. Log in again.', 401);
      const updated = { ...existing.payload, passwordHash: passwordHash(body.password), mustChangePassword: false,
        passwordUpdatedAt: new Date().toISOString() };
      await store.merge({ mutationId: randomUUID(), operations: [{ collection: 'users', id: user.id,
        expectedRevision: Number(existing.revision), payload: updated }] });
      return response.status(200).json({ user: publicUser(updated), token: issueSession(updated, workspace) });
    }
    if (['create_user', 'reset_user_password'].includes(body.action)) {
      const manager = await requireSession(request, store, workspace);
      if (!/^(manager|admin)$/i.test(manager.rol) || manager.mustChangePassword)
        throw storageError('AUTH_FORBIDDEN', 'Manager access required.', 403);
      await pgRateLimit('account-password-v2:' + manager.id, 60);
      const id = String(body.id || '').trim().toLowerCase();
      if (!/^[a-z0-9_-]{1,80}$/.test(id)) throw storageError('REQUEST_INVALID', 'Invalid login ID.', 400);
      const existing = await store.detail('users', id);
      let updated;
      if (body.action === 'create_user') {
        if (existing) throw storageError('REQUEST_INVALID', 'Login ID already exists.', 400);
        const name = typeof body.naam === 'string' ? body.naam.trim() : '';
        const { rol, laptopAccess, monitorAccess, voorkeur } = body;
        if (!name || name.length > 80 || !['Manager','Grader','Stickeraar'].includes(rol) ||
          !['grade','label','none'].includes(laptopAccess) || !['grade','none'].includes(monitorAccess) ||
          !['beginner','expert'].includes(voorkeur) || (rol !== 'Manager' && laptopAccess === 'none' && monitorAccess === 'none') ||
          (rol !== 'Manager' && rol !== (laptopAccess === 'grade' ? 'Grader' : 'Stickeraar')))
          throw storageError('REQUEST_INVALID', 'Invalid account details.', 400);
        updated = { id, naam: name, rol, laptopAccess, monitorAccess, voorkeur,
          initialen: name.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase() };
      } else {
        if (!existing) throw storageError('REQUEST_INVALID', 'Account does not exist.', 400);
        if (id === manager.id) throw storageError('REQUEST_INVALID', 'Use your personal password screen.', 400);
        updated = { ...existing.payload };
      }
      updated.passwordHash = passwordHash(body.password);
      updated.mustChangePassword = true;
      updated.passwordUpdatedAt = new Date().toISOString();
      const auditId = randomUUID();
      const result = await store.merge({ mutationId: randomUUID(), operations: [
        { collection: 'users', id, expectedRevision: Number(existing?.revision || 0), payload: updated },
        { collection: 'auditLogs', id: auditId, expectedRevision: 0, payload: { id: auditId,
          action: body.action, entityType: 'user', entityId: id, userId: manager.id,
          userName: manager.naam, timestamp: new Date().toISOString() } },
      ] });
      return response.status(200).json({ ok: true, user: publicUser(updated), recordRevisions: result.recordRevisions });
    }
    if (body.action && body.action !== 'login') throw storageError('REQUEST_INVALID', 'Unknown action.', 400);
    const ip = String(request.headers?.['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    await pgRateLimit('login-burst-v2:' + ip, 600);
    const id = String(body.id || '').trim().toLowerCase();
    const row = await store.detail('users', id);
    // A manager reset starts a new credential revision. Failed attempts with
    // the obsolete password must not keep the new temporary password locked.
    const failedScopes = [{ scope: `login-failed-v2:${ip}:${id}:${row?.revision || 0}`, limit: 20 },
      { scope: `login-failed-account-v2:${id}:${row?.revision || 0}`, limit: 50 },
      { scope: 'login-failed-network-v2:' + ip, limit: 100 }];
    const failureWindow = 15 * 60 * 1000;
    await pgCheckRateLimits(failedScopes, failureWindow);
    if (!row || !passwordMatches(body.password, row.payload.passwordHash)) {
      await Promise.all(failedScopes.map(({scope,limit})=>pgRateLimit(scope,limit,failureWindow)));
      throw storageError('AUTH_INVALID_CREDENTIALS', 'Incorrect account or password.', 401);
    }
    response.status(200).json({ user: publicUser(row.payload), token: issueSession(row.payload, workspace) });
  } catch (error) { sendStorageError(response, error); }
}

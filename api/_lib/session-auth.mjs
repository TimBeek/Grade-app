// Server-verified sessions. Tokens stay in sessionStorage, not localStorage.
import { createHash, createHmac, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto';
import { storageError } from './storage-safety.mjs';

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...profile } = user;
  return { ...profile, passwordHash: 'server-managed' };
}
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function passwordMatches(password, hash) {
  if (typeof password !== 'string' || password.length > 256) return false;
  if (String(hash).startsWith('scrypt$')) {
    const [, salt, expected] = hash.split('$');
    return safeEqual(scryptSync(password, salt, 32).toString('hex'), expected);
  }
  return safeEqual(digest('remarkt-demo:' + password), hash);
}
export function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256)
    throw storageError('REQUEST_INVALID', 'Use between 8 and 256 characters.', 400);
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
}
function secret() {
  const value = process.env.REMARKT_SESSION_SECRET || process.env.REMARKT_DATABASE_URL || process.env.DATABASE_URL;
  if (!value || value.length < 32) throw storageError('AUTH_NOT_CONFIGURED', 'A private session secret is required.');
  return createHash('sha256').update('remarkt-session-v1:' + value).digest();
}
const sign = payload => createHmac('sha256', secret()).update(payload).digest('base64url');
export function issueSession(user, workspaceId, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ sub: user.id, ws: workspaceId, exp: now + 12 * 60 * 60 * 1000,
    proof: digest(user.passwordHash), nonce: randomBytes(16).toString('hex') })).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function verifySessionToken(token, workspaceId, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 2048) throw new Error('Invalid token');
    const [body, signature, extra] = token.split('.');
    if (extra || !safeEqual(signature, sign(body))) throw new Error('Invalid signature');
    const session = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (session.ws !== workspaceId || !session.sub || !Number.isSafeInteger(session.exp) || session.exp <= now)
      throw new Error('Expired session');
    return session;
  } catch { throw storageError('AUTH_REQUIRED', 'Log in again.', 401); }
}
export async function requireSession(request, store, workspaceId) {
  const header = request.headers?.authorization || request.headers?.get?.('authorization') || '';
  const session = verifySessionToken(String(header).replace(/^Bearer /, ''), workspaceId);
  const row = await store.detail('users', session.sub);
  const user = row?.payload;
  if (!user || !safeEqual(digest(user.passwordHash), session.proof)) throw storageError('AUTH_REQUIRED', 'Account changed or removed.', 401);
  return user;
}
export function authorizeOperations(user, input) {
  const manager = /^(manager|admin)$/i.test(user.rol);
  const grade = manager || user.laptopAccess === 'grade' || (!user.laptopAccess && !/sticker|label/i.test(user.rol));
  const laptop = manager || user.laptopAccess !== 'none';
  const monitor = manager || user.monitorAccess !== 'none';
  if (user.mustChangePassword) throw storageError('AUTH_PASSWORD_CHANGE_REQUIRED', 'Change the initial password first.', 403);
  for (const op of input.operations || []) {
    if (manager) {
      if (op.collection === 'users' && op.id === user.id && (op.deleted || !/^(manager|admin)$/i.test(op.payload.rol)))
        throw storageError('AUTH_FORBIDDEN', 'Do not remove your own manager access.', 403);
      continue;
    }
    if (['users', ...['deletedBatchIds', 'deletedLaptopStickers', 'deletedMonitorBatchIds', 'deletedMonitorStickers']].includes(op.collection) || op.deleted)
      throw storageError('AUTH_FORBIDDEN', 'Manager access required.', 403);
    if (op.collection === 'history' && !grade) throw storageError('AUTH_FORBIDDEN', 'Grading access required.', 403);
    if (['laptops', 'labelPrints', 'batches'].includes(op.collection) && !laptop)
      throw storageError('AUTH_FORBIDDEN', 'Laptop access required.', 403);
    if (['monitors', 'monitorLabelPrints', 'monitorBatches'].includes(op.collection) && !monitor)
      throw storageError('AUTH_FORBIDDEN', 'Monitor access required.', 403);
    if (op.collection === 'batches' && op.id !== 'returns' && op.id !== 'manual_returns')
      throw storageError('AUTH_FORBIDDEN', 'Batch administration requires a manager.', 403);
    if (op.collection === 'monitorBatches' && op.id !== 'monitor_manual')
      throw storageError('AUTH_FORBIDDEN', 'Batch administration requires a manager.', 403);
    if (['history','labelPrints','monitorLabelPrints'].includes(op.collection) && op.payload.user_id !== user.id)
      throw storageError('AUTH_FORBIDDEN', 'An employee can only record their own work.', 403);
    if (op.collection === 'auditLogs' && op.payload.userId !== user.id)
      throw storageError('AUTH_FORBIDDEN', 'Invalid audit operator.', 403);
  }
}

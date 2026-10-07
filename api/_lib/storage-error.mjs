import { classifyStorageError } from './storage-safety.mjs';

export function sendStorageError(response, error) {
  const { code, status } = classifyStorageError(error);
  const retryAfterSeconds = Math.max(1, Math.ceil(Number(error.retryAfterSeconds) || 300));
  if (status === 503 || status === 429) response.setHeader('Retry-After', String(retryAfterSeconds));
  response.status(status).json({
    ok: false,
    code,
    ...(status === 429 ? { retryAfterSeconds } : {}),
    error: code === 'STORAGE_QUOTA_EXCEEDED'
      ? 'Database access is blocked by the provider usage limit. Existing data is not a successful empty result.'
      : status === 429 ? 'Too many attempts. Wait for the indicated time and try again. No data was deleted.'
      : status === 409 ? 'This record changed on another computer. Your local changes are preserved; review the latest version before saving.'
      : code === 'AUTH_INVALID_CREDENTIALS' ? 'Incorrect account or password.'
      : status === 401 ? 'Log in again to continue.'
      : status === 403 ? 'This account does not have permission for this operation.'
      : code === 'REQUEST_PASSWORD_UNCHANGED' ? 'Choose a personal password different from your temporary or current password.'
      : status === 400 || status === 413 ? 'The request is invalid or too large.'
      : 'Database access failed. Keep your local recovery copy and retry later.',
  });
}

import { classifyStorageError } from './storage-safety.mjs';

export function sendStorageError(response, error) {
  const { code, status } = classifyStorageError(error);
  if (status === 503 || status === 429) response.setHeader('Retry-After', '300');
  response.status(status).json({
    ok: false,
    code,
    error: code === 'STORAGE_QUOTA_EXCEEDED'
      ? 'Database access is blocked by the provider usage limit. Existing data is not a successful empty result.'
      : status === 409 ? 'This record changed on another computer. Your local changes are preserved; review the latest version before saving.'
      : status === 401 ? 'Log in again to continue.'
      : status === 403 ? 'This account does not have permission for this operation.'
      : status === 400 || status === 413 ? 'The request is invalid or too large.'
      : 'Database access failed. Keep your local recovery copy and retry later.',
  });
}

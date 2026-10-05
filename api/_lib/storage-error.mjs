export function sendStorageError(response, error) {
  const message = String(error?.message || error);
  const quota = /quota|HTTP status 402/i.test(message);
  response.setHeader('Retry-After', '300');
  response.status(503).json({
    ok: false,
    code: quota ? 'STORAGE_QUOTA_EXCEEDED' : 'STORAGE_UNAVAILABLE',
    error: quota
      ? 'Database access is blocked by the provider usage limit. Existing data is not a successful empty result.'
      : 'Database access failed. Keep your local recovery copy and retry later.',
  });
}

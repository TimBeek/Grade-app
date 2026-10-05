// Fail closed: a damaged document is never a successful empty administration.
export function storageError(code, message, status = 503) {
  return Object.assign(new Error(message), { code, status });
}

export function validateSnapshot(value) {
  let state = value;
  if (typeof state === 'string') {
    try { state = JSON.parse(state); }
    catch { throw storageError('STORAGE_CORRUPT', 'The recovery document is not valid JSON.'); }
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !['users', 'batches', 'monitorBatches', 'history', 'labelPrints', 'monitorLabelPrints', 'auditLogs']
        .every(key => Array.isArray(state[key]))) {
    throw storageError('STORAGE_CORRUPT', 'The recovery document has an invalid structure.');
  }
  if (state.users.some(user => !user || !user.id || !user.passwordHash)) {
    throw storageError('STORAGE_CORRUPT', 'The recovery document contains invalid accounts.');
  }
  return state;
}

export function classifyStorageError(error) {
  const message = String(error?.message || '');
  const explicit = String(error?.code || '');
  if (/^STORAGE_|^AUTH_|^REQUEST_|^RATE_/.test(explicit)) return {
    code: explicit, status: Number(error.status) || 503,
  };
  if(explicit==='P0005')return {code:'STORAGE_WORKSPACE_CHANGED',status:409};
  if (/quota|fixed plan limits|bandwidth limit|HTTP status 402/i.test(message) || explicit === '53000')
    return { code: 'STORAGE_QUOTA_EXCEEDED', status: 503 };
  if (explicit === '28P01' || /^28/.test(explicit) || /password authentication failed|invalid credentials/i.test(message))
    return { code: 'STORAGE_AUTH_FAILED', status: 503 };
  if (error?.name === 'AbortError' || explicit === '57014' || /timeout|timed out/i.test(message))
    return { code: 'STORAGE_TIMEOUT', status: 503 };
  if (/^[0-9A-Z]{5}$/.test(explicit) && !/^08/.test(explicit))
    return { code: 'STORAGE_QUERY_FAILED', status: 503 };
  return { code: 'STORAGE_UNAVAILABLE', status: 503 };
}

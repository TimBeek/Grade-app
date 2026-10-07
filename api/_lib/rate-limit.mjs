import { createHash } from 'node:crypto';
import { storageError } from './storage-safety.mjs';

// Small, workspace-scoped counters; never read operational records for a limit.
export function createRateLimiter(sql, workspace, now = Date.now) {
  const key = scope => createHash('sha256').update(`${workspace}:${scope}`).digest('hex');
  const window = ms => Math.floor(now() / ms) * ms;
  const blocked = (start, ms) => {
    const error = storageError('RATE_LIMITED', 'Too many requests. Please wait.', 429);
    error.retryAfterSeconds = Math.max(1, Math.ceil((start + ms - now()) / 1000));
    throw error;
  };
  return {
    async consume(scope, limit = 500, ms = 60000) {
      const start = window(ms);
      const rows = await sql`INSERT INTO remarkt_rate_limits(scope, window_start, hits) VALUES (${key(scope)}, ${start}, 1)
        ON CONFLICT(scope,window_start) DO UPDATE SET hits = remarkt_rate_limits.hits + 1 RETURNING hits`;
      if (Number(rows[0].hits) > limit) blocked(start, ms);
    },
    async check(scopes, ms) {
      const start = window(ms), keys = scopes.map(row => key(row.scope));
      const rows = await sql`SELECT scope,hits FROM remarkt_rate_limits
        WHERE window_start=${start} AND scope=ANY(${keys}::text[])`;
      if (rows.some(row => Number(row.hits) >= scopes[keys.indexOf(row.scope)].limit)) blocked(start, ms);
    },
  };
}

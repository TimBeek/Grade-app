// Neon Postgres persistence for the shared ReMarkt state.
//
// The operational app still uses one merged state document for now, but this
// removes the dependency on the Redis bandwidth quota. Statistics live in a
// separate small row, so the dashboard does not transfer the full dataset.

import { neon } from "@neondatabase/serverless";
import { emptyState, normalizeDemoState, computeStats } from "./state-core.mjs";

const STATE_ROW = "shared_state";
const STATS_ROW = "dashboard_stats";

let sqlSingleton = null;
let schemaReady = null;

function databaseUrl() {
  return String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
}

export function isPostgresConfigured() {
  return Boolean(databaseUrl());
}

function getSql() {
  if (sqlSingleton) return sqlSingleton;
  const url = databaseUrl();
  if (!url) throw new Error("Postgres is not configured. Set DATABASE_URL.");
  sqlSingleton = neon(url);
  return sqlSingleton;
}

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  const sql = getSql();
  schemaReady = sql`
    CREATE TABLE IF NOT EXISTS remarkt_app_state (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      byte_size INTEGER NOT NULL DEFAULT 0
    )
  `;
  try {
    await schemaReady;
  } catch (error) {
    schemaReady = null;
    throw error;
  }
  return schemaReady;
}

function parsePayload(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value && typeof value === "object" ? value : fallback;
}

async function readRow(id) {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT payload, updated_at, byte_size FROM remarkt_app_state WHERE id = ${id}`;
  return rows[0] || null;
}

async function writeRow(id, payload) {
  await ensureSchema();
  const sql = getSql();
  const json = JSON.stringify(payload);
  await sql`
    INSERT INTO remarkt_app_state (id, payload, updated_at, byte_size)
    VALUES (${id}, ${json}::jsonb, ${new Date().toISOString()}, ${Buffer.byteLength(json, "utf8")})
    ON CONFLICT (id) DO UPDATE SET
      payload = EXCLUDED.payload,
      updated_at = EXCLUDED.updated_at,
      byte_size = EXCLUDED.byte_size
  `;
}

export async function pgReadMeta() {
  await ensureSchema();
  const sql = getSql();
  // Extract only the timestamp in SQL. A background change-check must never
  // pull the multi-megabyte operational document out of Postgres.
  const rows = await sql`
    SELECT payload ->> 'updatedAt' AS state_updated_at, updated_at, byte_size
    FROM remarkt_app_state
    WHERE id = ${STATE_ROW}
  `;
  const row = rows[0] || null;
  if (!row) return null;
  return {
    updatedAt: row.state_updated_at ? String(row.state_updated_at) : new Date(row.updated_at).toISOString(),
    bytes: Number(row.byte_size || 0),
  };
}

export async function pgReadUsers() {
  await ensureSchema();
  const sql = getSql();
  // Sign-in only needs these four small values; avoid reading batches and
  // history simply to validate a user account.
  const rows = await sql`
    SELECT
      payload -> 'users' AS users,
      payload ->> 'userSync' AS user_sync,
      payload ->> 'userSyncAt' AS user_sync_at,
      payload ->> 'updatedAt' AS state_updated_at,
      updated_at
    FROM remarkt_app_state
    WHERE id = ${STATE_ROW}
  `;
  const row = rows[0] || null;
  if (!row) return { users: [], userSync: '', userSyncAt: null, updatedAt: null };
  return {
    users: Array.isArray(row.users) ? row.users : parsePayload(row.users, []),
    userSync: String(row.user_sync || ''),
    userSyncAt: row.user_sync_at ? String(row.user_sync_at) : null,
    updatedAt: row.state_updated_at ? String(row.state_updated_at) : new Date(row.updated_at).toISOString(),
  };
}

export async function pgReadState() {
  const row = await readRow(STATE_ROW);
  if (!row) return emptyState();
  return normalizeDemoState(parsePayload(row.payload, emptyState()));
}

export async function pgReadStats() {
  const row = await readRow(STATS_ROW);
  return row ? parsePayload(row.payload, null) : null;
}

export async function pgWriteStats(stats) {
  await writeRow(STATS_ROW, stats);
  return stats;
}

export async function pgWriteState(state) {
  const normalized = normalizeDemoState(state);
  await writeRow(STATE_ROW, normalized);
  await pgWriteStats(computeStats(normalized));
  return normalized;
}

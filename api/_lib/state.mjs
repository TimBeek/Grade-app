// KV (Vercel KV / Upstash Redis) storage layer for the shared demo-state.
//
// Pure state logic lives in ./state-core.mjs (no external deps). This module
// adds the Redis client plus chunked + gzipped read/write so we never hit the
// ~1MB-per-command Upstash REST limit, even as the history grows.

import { Redis } from "@upstash/redis";
import {
  emptyState,
  normalizeDemoState,
  encodeState,
  decodeState,
} from "./state-core.mjs";

export {
  emptyState,
  normalizeDemoState,
  mergeDemoState,
  computeStats,
  toEnvelope,
  fromBody,
} from "./state-core.mjs";

export const STATE_KEY = "remarkt:state";
const CHUNK_CHARS = 700_000; // base64 chars per KV value; keeps each command < ~700KB

// ---------------------------------------------------------------------------
// KV client
// ---------------------------------------------------------------------------

let redisSingleton = null;

function resolveRedisCredentials() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_API_URL ||
    "";
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_API_TOKEN ||
    "";
  return { url, token };
}

export function isKvConfigured() {
  const { url, token } = resolveRedisCredentials();
  return Boolean(url && token);
}

export function getRedis() {
  if (redisSingleton) return redisSingleton;
  const { url, token } = resolveRedisCredentials();
  if (!url || !token) {
    throw new Error(
      "KV is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_* equivalents)."
    );
  }
  redisSingleton = new Redis({ url, token });
  return redisSingleton;
}

// ---------------------------------------------------------------------------
// Chunked + gzipped storage
// ---------------------------------------------------------------------------

function splitChunks(value) {
  const chunks = [];
  for (let i = 0; i < value.length; i += CHUNK_CHARS) {
    chunks.push(value.slice(i, i + CHUNK_CHARS));
  }
  return chunks.length ? chunks : [""];
}

export async function kvReadState() {
  const redis = getRedis();
  const meta = await redis.get(`${STATE_KEY}:meta`);
  if (!meta || typeof meta.chunks !== "number" || meta.chunks < 1) {
    return emptyState();
  }
  const keys = [];
  for (let i = 0; i < meta.chunks; i++) keys.push(`${STATE_KEY}:${i}`);
  const parts = await redis.mget(...keys);
  const base64 = parts.map(part => (typeof part === "string" ? part : "")).join("");
  if (!base64) return emptyState();
  try {
    return normalizeDemoState(decodeState(base64));
  } catch {
    return emptyState();
  }
}

export async function kvWriteState(normalizedState) {
  const redis = getRedis();
  const base64 = encodeState(normalizedState);
  const chunks = splitChunks(base64);

  const previousMeta = await redis.get(`${STATE_KEY}:meta`);
  const previousChunkCount =
    previousMeta && typeof previousMeta.chunks === "number" ? previousMeta.chunks : 0;

  const pipeline = redis.pipeline();
  chunks.forEach((chunk, index) => pipeline.set(`${STATE_KEY}:${index}`, chunk));
  pipeline.set(`${STATE_KEY}:meta`, {
    chunks: chunks.length,
    updatedAt: normalizedState.updatedAt,
    bytes: Buffer.byteLength(base64),
  });
  // Drop chunk keys that are no longer used when the document shrinks.
  for (let i = chunks.length; i < previousChunkCount; i++) {
    pipeline.del(`${STATE_KEY}:${i}`);
  }
  await pipeline.exec();
  return normalizedState;
}

// Exactly one small read. Never exports, replaces or seeds historical data.
import {Redis} from '@upstash/redis';
import {loadEnv} from '../scripts/_lib/env.mjs';
import {classifyStorageError} from '../api/_lib/storage-safety.mjs';
loadEnv('.env.local');
const redis=new Redis({url:process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token:process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,retry:false});
try {
  const meta=await redis.get('remarkt:state:meta');
  console.log(JSON.stringify({historicalRedisReadable:true,metadataPresent:Boolean(meta),chunks:meta?.chunks,updatedAt:meta?.updatedAt}));
}catch(error){console.log(JSON.stringify({historicalRedisReadable:false,...classifyStorageError(error)}));}

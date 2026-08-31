import Redis from 'ioredis';
import { log } from './log';

const globalForRedis = globalThis as unknown as {
  _nacosRedis?: Redis;
  _nacosFallback?: Map<string, { count: number; resetAt: number }>;
};

export const redis =
  globalForRedis._nacosRedis ??
  new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 2_000),
  });

if (!globalForRedis._nacosRedis) {
  globalForRedis._nacosRedis = redis;
  redis.on('error', (err) => log.warn('redis_error', { message: String(err).slice(0, 160) }));
}

// Per-instance fallback used only when Redis is unreachable. It is best-effort
// (Vercel runs many instances) but still blunts a burst against one instance and,
// crucially, CANNOT affect vote correctness - that lives entirely in Postgres.
function fallbackLimiter(): Map<string, { count: number; resetAt: number }> {
  if (!globalForRedis._nacosFallback) globalForRedis._nacosFallback = new Map();
  return globalForRedis._nacosFallback;
}

function fallbackAllow(key: string, limit: number, windowSec: number): boolean {
  const map = fallbackLimiter();
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || entry.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowSec * 1_000 });
    if (map.size > 5_000) for (const [k, v] of map) if (v.resetAt < now) map.delete(k);
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

/**
 * Fixed-window rate limit via atomic INCR + EXPIRE. Returns true when the
 * request is within the limit. On any Redis failure it degrades to the
 * per-instance fallback and logs - it never throws and never blocks voting.
 */
export async function rateLimit(key: string, limit = 10, windowSec = 60): Promise<boolean> {
  const redisKey = `nacosvote:rl:${key}`;
  try {
    const n = await redis.incr(redisKey);
    if (n === 1) await redis.expire(redisKey, windowSec);
    return n <= limit;
  } catch (err) {
    log.warn('rate_limit_degraded', { key, message: String(err).slice(0, 120) });
    return fallbackAllow(key, limit, windowSec);
  }
}

export async function pingRedis(timeoutMs = 1_000): Promise<boolean> {
  try {
    const res = await Promise.race([
      redis.ping(),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs)),
    ]);
    return res === 'PONG';
  } catch {
    return false;
  }
}

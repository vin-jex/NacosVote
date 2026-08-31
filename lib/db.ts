import { Pool, neonConfig, DatabaseError, types } from '@neondatabase/serverless';
import type { PoolClient } from 'pg';
import ws from 'ws';
import { log, safeError } from './log';

// The @neondatabase/serverless Pool speaks the Postgres protocol over a
// WebSocket on port 443. That is API-compatible with pg.Pool (so every query and
// interactive BEGIN/COMMIT transaction below is unchanged) and, unlike the raw
// 5432 wire protocol, survives networks / middleboxes that reset non-HTTP TLS.
// A WebSocket constructor must be supplied outside modern browsers.
neonConfig.webSocketConstructor = ws;

// Parse int8 (bigint, OID 20) as a JS number. All ids and counts in this schema
// are far below 2^53, and the rest of the code compares them as numbers.
types.setTypeParser(20, (v: string | null) => (v === null ? null : Number(v)));

// The serverless driver's SCRAM auth does not use channel binding; strip the
// param some Neon dashboards add so it doesn't reject the handshake.
function connectionString(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    u.searchParams.delete('channel_binding');
    return u.toString();
  } catch {
    return raw;
  }
}

const globalForPool = globalThis as unknown as { _nacosPool?: Pool };

export const pool =
  globalForPool._nacosPool ??
  new Pool({
    connectionString: connectionString(),
    max: Number(process.env.PG_POOL_MAX ?? 8),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

if (!globalForPool._nacosPool) {
  globalForPool._nacosPool = pool;
  pool.on('error', (err) => log.error('pg_pool_error', { err: safeError(err) }));
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type PgErrorCategory =
  | 'serialization'
  | 'deadlock'
  | 'connection'
  | 'timeout'
  | 'constraint'
  | 'unknown';

export function categorizePgError(err: unknown): PgErrorCategory {
  if (err instanceof DatabaseError && err.code) {
    if (err.code === '40001') return 'serialization';
    if (err.code === '40P01') return 'deadlock';
    if (err.code.startsWith('08') || err.code === '57P01' || err.code === '57P03') {
      return 'connection';
    }
    if (err.code === '53300' || err.code === '55P03') return 'connection';
    if (err.code === '57014') return 'timeout';
    if (err.code.startsWith('23')) return 'constraint';
    return 'unknown';
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout/i.test(msg)) return 'timeout';
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|terminat|connection|socket hang up|fetch failed/i.test(msg)) {
    return 'connection';
  }
  return 'unknown';
}

function isRetryable(err: unknown): boolean {
  const c = categorizePgError(err);
  return c === 'serialization' || c === 'deadlock';
}

/** Thrown inside a withTx callback to force ROLLBACK and carry a business reason out. */
export class RollbackSignal<R extends string = string> extends Error {
  constructor(public readonly reason: R) {
    super(`rollback:${reason}`);
    this.name = 'RollbackSignal';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Isolation = 'read committed' | 'repeatable read' | 'serializable';

/**
 * Runs `fn` inside one transaction on a single pooled connection.
 *
 * Isolation defaults to READ COMMITTED, which is sufficient for the voting path:
 * the one-vote invariant is enforced by a conditional `UPDATE ... WHERE
 * has_voted = false`, which takes a row lock, so concurrent claims serialize on
 * that row regardless of isolation. Pass `serializable` only for admin
 * operations that genuinely need it, together with `retries`.
 *
 * Retries apply ONLY to serialization failures (40001) and deadlocks (40P01),
 * with bounded exponential backoff + jitter. Every other error (including
 * RollbackSignal) rolls back once and propagates.
 */
export async function withTx<T>(
  fn: (client: PoolClient) => Promise<T>,
  opts: { isolation?: Isolation; retries?: number } = {},
): Promise<T> {
  const maxRetries = opts.retries ?? 0;
  const beginStmt = opts.isolation
    ? `BEGIN ISOLATION LEVEL ${opts.isolation.toUpperCase()}`
    : 'BEGIN';

  for (let attempt = 0; ; attempt++) {
    const client = (await pool.connect()) as unknown as PoolClient;
    try {
      await client.query(beginStmt);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection already gone */
      }
      if (attempt < maxRetries && isRetryable(err)) {
        const backoff = Math.min(1_000, 40 * 2 ** attempt) * (0.5 + Math.random());
        log.warn('tx_retry', { attempt: attempt + 1, err: safeError(err) });
        await sleep(backoff);
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Lightweight liveness check used by the readiness endpoint. */
export async function pingDb(timeoutMs = 3_000): Promise<boolean> {
  const timer = new Promise<false>((r) => setTimeout(() => r(false), timeoutMs));
  const probe = (async () => {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  })();
  return Promise.race([probe, timer]);
}

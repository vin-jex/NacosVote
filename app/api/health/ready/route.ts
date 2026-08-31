import { NextResponse } from 'next/server';
import { pingDb } from '@/lib/db';
import { pingRedis } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Readiness: can the app reach the things it needs? The database being down
 * makes the app "not ready" (503). Redis being down does NOT — voting stays
 * correct without it — so it is reported but never fails the check.
 */
export async function GET() {
  const [db, redis] = await Promise.all([pingDb(2_000), pingRedis(1_000)]);
  const body = {
    db: db ? 'up' : 'down',
    redis: redis ? 'up' : 'down',
  };
  return NextResponse.json(body, { status: db ? 200 : 503 });
}

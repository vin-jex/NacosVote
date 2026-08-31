import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { closeExpiredElections } from '@/lib/queries';
import { flushOutbox } from '@/lib/email';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Closes any election whose voting window has ended and sends its results.
 * Run on a schedule (Vercel Cron hits this with `Authorization: Bearer
 * $CRON_SECRET`); also accepts `x-cron-key: $CRON_SECRET` or an admin session.
 * Idempotent, so a missed run just catches up on the next one.
 */
async function authorized(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const bearer = req.headers.get('authorization');
    if (bearer === `Bearer ${secret}` || req.headers.get('x-cron-key') === secret) return true;
  }
  return !!(await requireAdmin());
}

async function run(req: Request) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Not authorized.' } }, { status: 401 });
  }
  const closed = await closeExpiredElections();
  const drain = await flushOutbox();
  if (closed.length) log.info('elections_auto_closed', { closed, ...drain });
  return NextResponse.json({ closed, emails: drain });
}

export const GET = run;
export const POST = run;

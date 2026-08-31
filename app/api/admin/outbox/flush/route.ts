import { handle, ok, fail } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { flushOutbox } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Drains pending notification emails. Callable two ways:
 *  - authenticated admin (from the dashboard)
 *  - a scheduler passing `x-cron-key: $CRON_SECRET` (e.g. a Vercel Cron job)
 */
export async function POST(req: Request) {
  return handle('outbox_flush', async ({ requestId }) => {
    const cronKey = req.headers.get('x-cron-key');
    const cronOk = !!process.env.CRON_SECRET && cronKey === process.env.CRON_SECRET;
    if (!cronOk && !(await requireAdmin())) {
      return fail('UNAUTHENTICATED', 401, 'Sign in required.', requestId);
    }
    const result = await flushOutbox();
    return ok(result, { requestId });
  });
}

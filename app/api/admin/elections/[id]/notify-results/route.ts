import { handle, ok, adminEmail, parseId, ApiError } from '@/lib/api';
import { enqueueFinalResults, getElection } from '@/lib/queries';
import { flushOutbox } from '@/lib/email';
import { logAdminAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return handle('admin_notify_results', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Election not found.');
    if (!(await getElection(id))) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    // Manual "send now": always queues a fresh copy, even if already sent.
    await enqueueFinalResults(id, { force: true });
    await logAdminAction(admin, 'results.email.queued', { electionId: id });

    const drain = await flushOutbox();
    const deferred = drain.failed > 0 && drain.sent === 0;
    return ok(
      {
        queued: true,
        sent: drain.sent,
        deferred,
        message: deferred
          ? 'Results were queued but delivery is delayed. They will be retried automatically.'
          : 'Results email sent.',
      },
      { status: deferred ? 202 : 200, requestId },
    );
  });
}

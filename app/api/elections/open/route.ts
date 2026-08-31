import { handle, ok } from '@/lib/api';
import { closeExpiredElections, getOpenElections } from '@/lib/queries';
import { flushOutbox } from '@/lib/email';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public. Minimal fields only: id, title, close time. No counts, no config.
export async function GET() {
  return handle('elections_open', async ({ requestId }) => {
    // Opportunistic auto-close so ended elections finalise + email even without
    // the cron running. Fire-and-forget; never blocks or fails this response.
    void closeExpiredElections()
      .then((closed) => {
        if (closed.length) {
          log.info('elections_auto_closed', { via: 'elections_open', closed });
          return flushOutbox();
        }
      })
      .catch((err) => log.error('auto_close_failed', { requestId, err: String(err).slice(0, 200) }));

    const elections = await getOpenElections();
    return ok(
      {
        elections: elections.map((e) => ({
          id: e.id,
          title: e.title,
          votingEnd: e.voting_end ? new Date(e.voting_end).toISOString() : null,
        })),
      },
      { requestId },
    );
  });
}

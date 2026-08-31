import { handle, ok } from '@/lib/api';
import {
  closeExpiredElections,
  getOpenElections,
  getUpcomingElections,
  listPublishedResultsElections,
} from '@/lib/queries';
import { flushOutbox } from '@/lib/email';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public. Minimal fields only: id, title, times. No counts, no config.
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

    const [open, upcoming, results] = await Promise.all([
      getOpenElections(),
      getUpcomingElections(),
      listPublishedResultsElections(),
    ]);

    return ok(
      {
        elections: open.map((e) => ({
          id: e.id,
          title: e.title,
          votingEnd: e.voting_end ? new Date(e.voting_end).toISOString() : null,
        })),
        upcoming: upcoming.map((e) => ({
          id: e.id,
          title: e.title,
          votingStart: e.voting_start ? new Date(e.voting_start).toISOString() : null,
          votingEnd: e.voting_end ? new Date(e.voting_end).toISOString() : null,
        })),
        results: results.map((e) => ({
          id: e.id,
          title: e.title,
          status: e.status,
          votingEnd: e.voting_end ? new Date(e.voting_end).toISOString() : null,
        })),
      },
      { requestId },
    );
  });
}

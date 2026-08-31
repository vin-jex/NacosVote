import { handle, ok } from '@/lib/api';
import { getOpenElections } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public. Minimal fields only — id, title, close time. No counts, no config.
export async function GET() {
  return handle('elections_open', async ({ requestId }) => {
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

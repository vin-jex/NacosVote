import { handle, ok, adminEmail, parseId, ApiError } from '@/lib/api';
import { parseQuery, listQuerySchema } from '@/lib/validation';
import { getElection, getResults } from '@/lib/queries';
import { effectiveStatus } from '@/lib/election';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle('admin_election_results', async ({ requestId }) => {
    await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    const election = await getElection(id);
    if (!election) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    const { q, limit, offset } = parseQuery(req, listQuerySchema);
    const { positions, turnout, voters, participationTotal } = await getResults(id, {
      search: q,
      limit: limit ?? 50,
      offset: offset ?? 0,
    });
    const percent = turnout.total === 0 ? 0 : (turnout.voted / turnout.total) * 100;

    return ok(
      {
        election: {
          id: election.id,
          title: election.title,
          status: election.status,
          effectiveStatus: effectiveStatus(election),
          votingStart: election.voting_start ? new Date(election.voting_start).toISOString() : null,
          votingEnd: election.voting_end ? new Date(election.voting_end).toISOString() : null,
        },
        positions,
        turnout: { ...turnout, notVoted: turnout.total - turnout.voted, percent },
        participation: {
          total: participationTotal,
          limit: limit ?? 50,
          offset: offset ?? 0,
          voters,
        },
        generatedAt: new Date().toISOString(),
      },
      { requestId },
    );
  });
}

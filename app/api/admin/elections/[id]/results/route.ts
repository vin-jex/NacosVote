import { handle, ok, adminEmail, parseId, ApiError } from '@/lib/api';
import { parseQuery, listQuerySchema } from '@/lib/validation';
import { closeExpiredElections, getElection, getResults } from '@/lib/queries';
import { flushOutbox } from '@/lib/email';
import { effectiveStatus } from '@/lib/election';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle('admin_election_results', async ({ requestId }) => {
    await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    // The admin polls this while an election ends; use it to auto-close + email
    // promptly on the Hobby plan (daily cron only). Fire-and-forget.
    void closeExpiredElections()
      .then((closed) => (closed.length ? flushOutbox() : undefined))
      .catch((err) => log.error('auto_close_failed', { requestId, err: String(err).slice(0, 200) }));

    const election = await getElection(id);
    if (!election) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    const { q, limit, offset } = parseQuery(req, listQuerySchema);
    const raw = await getResults(id, {
      search: q,
      limit: limit ?? 50,
      offset: offset ?? 0,
    });
    const { positions, voters, participationTotal } = raw;

    // In open mode there is no fixed electorate: the denominator is the cap if
    // one is set, otherwise just the ballots cast.
    const denominator =
      election.eligibility_mode === 'open'
        ? (election.max_voters ?? raw.turnout.voted)
        : raw.turnout.total;
    const turnout = { voted: raw.turnout.voted, total: denominator };
    const percent = turnout.total === 0 ? 0 : (turnout.voted / turnout.total) * 100;

    return ok(
      {
        election: {
          id: election.id,
          title: election.title,
          status: election.status,
          effectiveStatus: effectiveStatus(election),
          eligibilityMode: election.eligibility_mode,
          maxVoters: election.max_voters,
          votingStart: election.voting_start ? new Date(election.voting_start).toISOString() : null,
          votingEnd: election.voting_end ? new Date(election.voting_end).toISOString() : null,
        },
        positions,
        turnout: { ...turnout, notVoted: turnout.total - turnout.voted, percent },
        review: raw.review,
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

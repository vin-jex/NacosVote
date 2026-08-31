import { handle, fail, ok } from '@/lib/api';
import { rateLimit } from '@/lib/redis';
import { parseJson, verifySchema } from '@/lib/validation';
import {
  getElectionForVoting,
  getElectionBallot,
  getParticipationByMatric,
} from '@/lib/queries';
import { namesMatch, normalizeMatric } from '@/lib/normalize';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export async function POST(req: Request) {
  return handle('vote_verify', async ({ requestId }) => {
    const ip = clientIp(req);
    if (!(await rateLimit(`verify:${ip}`, 10, 60))) {
      log.warn('rate_limit_triggered', { event: 'vote_verify', requestId });
      return fail('RATE_LIMITED', 429, 'Too many attempts. Please wait a minute.', requestId);
    }

    const body = await parseJson(req, verifySchema);

    const election = await getElectionForVoting(body.electionId);
    if (!election || !election.is_open) {
      return ok({ status: 'not-open' }, { requestId });
    }

    // Responses are deliberately uniform to limit voter enumeration.
    const seen = await getParticipationByMatric(body.electionId, body.matricNumber);

    if (election.eligibility_mode === 'restricted') {
      // Must be a known voter, on this election's list, name matching, not voted.
      if (!seen || !namesMatch(seen.registered_name, body.name)) {
        return ok({ status: 'not-eligible' }, { requestId });
      }
      if (seen.has_voted) return ok({ status: 'already-voted' }, { requestId });
    } else {
      // open: anyone with a matric + name. If the matric is already registered,
      // the name must match the one it was first registered with.
      if (seen && !namesMatch(seen.registered_name, body.name)) {
        return ok({ status: 'not-eligible' }, { requestId });
      }
      if (seen?.has_voted) return ok({ status: 'already-voted' }, { requestId });
      const alreadyIn = !!seen; // registered for this election but not yet voted
      if (
        !alreadyIn &&
        election.max_voters != null &&
        election.ballots_cast >= election.max_voters
      ) {
        return ok({ status: 'capacity-full' }, { requestId });
      }
    }

    const displayName = seen?.registered_name ?? body.name.trim();
    const ballot = await getElectionBallot(body.electionId);
    return ok(
      {
        status: 'ok',
        voter: { name: displayName, matricNumber: normalizeMatric(body.matricNumber) },
        election: {
          id: body.electionId,
          title: election.title,
          votingEnd: election.voting_end ? new Date(election.voting_end).toISOString() : null,
        },
        ballot,
      },
      { requestId },
    );
  });
}

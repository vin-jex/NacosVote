import { handle, fail, ok } from '@/lib/api';
import { rateLimit } from '@/lib/redis';
import { parseJson, verifySchema } from '@/lib/validation';
import {
  findVoterByMatric,
  getElectionForVoting,
  getElectionBallot,
  getParticipation,
} from '@/lib/queries';
import { namesMatch } from '@/lib/normalize';
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

    // Uniform responses from here on to limit voter enumeration.
    const voter = await findVoterByMatric(body.matricNumber);
    if (!voter || !namesMatch(voter.name, body.name)) {
      return ok({ status: 'not-eligible' }, { requestId });
    }

    const participation = await getParticipation(body.electionId, voter.id);
    if (!participation) return ok({ status: 'not-eligible' }, { requestId });
    if (participation.has_voted) return ok({ status: 'already-voted' }, { requestId });

    const ballot = await getElectionBallot(body.electionId);
    return ok(
      {
        status: 'ok',
        voter: { name: voter.name, matricNumber: voter.matric_number },
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

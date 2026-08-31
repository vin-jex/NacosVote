import { handle, fail, ok } from '@/lib/api';
import { rateLimit } from '@/lib/redis';
import { parseJson, submitSchema } from '@/lib/validation';
import { castBallot, findVoterByMatric, getParticipation } from '@/lib/queries';
import { namesMatch } from '@/lib/normalize';
import { flushOutbox } from '@/lib/email';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export async function POST(req: Request) {
  return handle('vote_submit', async ({ requestId }) => {
    const ip = clientIp(req);
    if (!(await rateLimit(`submit:${ip}`, 20, 60))) {
      return fail('RATE_LIMITED', 429, 'Too many attempts. Please wait a minute.', requestId);
    }

    const body = await parseJson(req, submitSchema);
    log.info('vote_submission_started', { requestId, electionId: body.electionId });

    // Identity resolution (no eligibility decision leaks here beyond generic failure).
    const voter = await findVoterByMatric(body.matricNumber);
    if (!voter || !namesMatch(voter.name, body.name)) {
      return fail('NOT_ELIGIBLE', 403, 'We could not verify your details.', requestId);
    }
    const participation = await getParticipation(body.electionId, voter.id);
    if (!participation) {
      return fail('NOT_ELIGIBLE', 403, 'You are not eligible for this election.', requestId);
    }

    const result = await castBallot({
      electionId: body.electionId,
      voterId: voter.id,
      idempotencyKey: body.idempotencyKey,
      selections: body.selections,
    });

    switch (result.outcome) {
      case 'recorded':
        log.info('vote_submission_committed', { requestId, electionId: body.electionId });
        // Best-effort: try to drain the outbox now. Never blocks the response,
        // never affects the recorded vote.
        void flushOutbox().catch((err) =>
          log.error('results_email_failed', { requestId, err: String(err).slice(0, 200) }),
        );
        return ok({ status: 'recorded' }, { requestId });

      case 'duplicate':
        // A replay of this exact submission. The first one is authoritative.
        log.info('vote_submission_duplicate', { requestId, electionId: body.electionId });
        return ok({ status: 'recorded', duplicate: true }, { requestId });

      case 'already-voted':
        return fail('ALREADY_VOTED', 409, 'A vote has already been recorded for you.', requestId);

      case 'not-open':
        return fail('ELECTION_CLOSED', 403, 'Voting is not open for this election.', requestId);

      case 'invalid-ballot':
        log.warn('vote_submission_rejected', { requestId, reason: 'invalid-ballot' });
        return fail(
          'INVALID_BALLOT',
          400,
          'Your ballot was not valid. Please reload and try again.',
          requestId,
        );
    }
  });
}

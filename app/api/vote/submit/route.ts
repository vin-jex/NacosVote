import { handle, fail, ok } from '@/lib/api';
import { rateLimit } from '@/lib/redis';
import { parseJson, submitSchema } from '@/lib/validation';
import { castBallot } from '@/lib/queries';
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

    // Eligibility (restricted vs open), the ballot cap, identity resolution and
    // the one-vote claim all happen inside castBallot's single transaction.
    const result = await castBallot({
      electionId: body.electionId,
      matricNumber: body.matricNumber,
      name: body.name,
      idempotencyKey: body.idempotencyKey,
      selections: body.selections,
    });

    switch (result.outcome) {
      case 'recorded':
        log.info('vote_submission_committed', { requestId, electionId: body.electionId });
        void flushOutbox().catch((err) =>
          log.error('results_email_failed', { requestId, err: String(err).slice(0, 200) }),
        );
        return ok({ status: 'recorded' }, { requestId });

      case 'duplicate':
        log.info('vote_submission_duplicate', { requestId, electionId: body.electionId });
        return ok({ status: 'recorded', duplicate: true }, { requestId });

      case 'already-voted':
        return fail('ALREADY_VOTED', 409, 'A vote has already been recorded for you.', requestId);

      case 'not-eligible':
        return fail('NOT_ELIGIBLE', 403, 'We could not verify your details for this election.', requestId);

      case 'capacity-full':
        return fail('CAPACITY_FULL', 409, 'Voting for this election is full.', requestId);

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

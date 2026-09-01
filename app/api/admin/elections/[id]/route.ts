import { handle, ok, fail, adminEmail, parseId, ApiError } from '@/lib/api';
import { parseJson, patchElectionSchema } from '@/lib/validation';
import {
  deleteElection,
  electionHasVotes,
  enqueueFinalResults,
  getElection,
  getElectionBallot,
  getTurnout,
  updateElection,
} from '@/lib/queries';
import { canTransition, effectiveStatus, transitionError } from '@/lib/election';
import { flushOutbox } from '@/lib/email';
import { logAdminAction } from '@/lib/audit';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handle('admin_election_get', async ({ requestId }) => {
    await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    const election = await getElection(id);
    if (!election) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    const [ballot, turnout, hasVotes] = await Promise.all([
      getElectionBallot(id),
      getTurnout(id),
      electionHasVotes(id),
    ]);

    return ok(
      {
        id: election.id,
        title: election.title,
        description: election.description,
        status: election.status,
        effectiveStatus: effectiveStatus(election),
        version: election.version,
        votingStart: election.voting_start ? new Date(election.voting_start).toISOString() : null,
        votingEnd: election.voting_end ? new Date(election.voting_end).toISOString() : null,
        createdAt: new Date(election.created_at).toISOString(),
        updatedAt: new Date(election.updated_at).toISOString(),
        ballotEditable: (election.status === 'draft' || election.status === 'scheduled') && !hasVotes,
        hasVotes,
        eligibilityMode: election.eligibility_mode,
        maxVoters: election.max_voters,
        resultsVisibility: election.results_visibility,
        ballotMode: election.ballot_mode,
        ballotsCast: turnout.voted,
        ballot,
        turnout,
      },
      { requestId },
    );
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle('admin_election_update', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    const body = await parseJson(req, patchElectionSchema);
    const current = await getElection(id);
    if (!current) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    const patch: Parameters<typeof updateElection>[2] = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.votingStart !== undefined) patch.voting_start = body.votingStart ?? null;
    if (body.votingEnd !== undefined) patch.voting_end = body.votingEnd ?? null;
    if (body.eligibilityMode !== undefined) patch.eligibility_mode = body.eligibilityMode;
    if (body.maxVoters !== undefined) patch.max_voters = body.maxVoters ?? null;
    if (body.resultsVisibility !== undefined) patch.results_visibility = body.resultsVisibility;
    if (body.ballotMode !== undefined && body.ballotMode !== current.ballot_mode) {
      if (await electionHasVotes(id)) {
        throw new ApiError(
          'ELECTION_LOCKED',
          409,
          'The ballot type cannot change once votes have been cast.',
        );
      }
      patch.ballot_mode = body.ballotMode;
    }

    if (body.status !== undefined && body.status !== current.status) {
      if (!canTransition(current.status, body.status)) {
        throw new ApiError('INVALID_TRANSITION', 409, transitionError(current.status, body.status));
      }
      if (current.status === 'closed') {
        throw new ApiError('INVALID_TRANSITION', 409, 'A closed election cannot be reopened.');
      }
      patch.status = body.status;
    }

    // A scheduled/open election needs a full, valid window.
    const nextStatus = patch.status ?? current.status;
    if (nextStatus === 'scheduled' || nextStatus === 'open') {
      const start = patch.voting_start ?? current.voting_start;
      const end = patch.voting_end ?? current.voting_end;
      if (!start || !end) {
        throw new ApiError('WINDOW_REQUIRED', 400, 'Set a start and end time before scheduling or opening.');
      }
      if (new Date(end) <= new Date(start)) {
        throw new ApiError('WINDOW_INVALID', 400, 'Voting end must be after voting start.');
      }
    }

    const result = await updateElection(id, body.version, patch);
    if (result.outcome === 'not-found') throw new ApiError('NOT_FOUND', 404, 'Election not found.');
    if (result.outcome === 'stale') {
      return fail(
        'STALE_VERSION',
        409,
        'This election was changed by someone else. Reload and try again.',
        requestId,
      );
    }

    await logAdminAction(admin, 'election.updated', {
      electionId: id,
      fields: Object.keys(patch),
    });

    // Auto-send results when an admin closes the election (once).
    if (patch.status === 'closed') {
      try {
        await enqueueFinalResults(id);
        void flushOutbox().catch((err) =>
          log.error('auto_results_flush_failed', { requestId, err: String(err).slice(0, 200) }),
        );
      } catch (err) {
        log.error('auto_results_enqueue_failed', { requestId, err: String(err).slice(0, 200) });
      }
    }

    return ok({ ok: true, version: result.election.version }, { requestId });
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return handle('admin_election_delete', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    const result = await deleteElection(id);
    if (result === 'not-found') throw new ApiError('NOT_FOUND', 404, 'Election not found.');
    if (result === 'not-draft') {
      throw new ApiError('ELECTION_LOCKED', 409, 'Only a draft election can be deleted.');
    }
    await logAdminAction(admin, 'election.deleted', { electionId: id });
    return ok({ ok: true }, { requestId });
  });
}

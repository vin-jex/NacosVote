import { handle, ok, adminEmail, parseId, ApiError } from '@/lib/api';
import { parseJson, patchCandidateSchema } from '@/lib/validation';
import { ballotEditable, candidatePositionInElection, deleteCandidate, updateCandidate } from '@/lib/queries';
import { logAdminAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function guard(id: number | null, candidateId: number | null) {
  if (!id || !candidateId) throw new ApiError('NOT_FOUND', 404, 'Not found.');
  if (!(await candidatePositionInElection(id, candidateId))) {
    throw new ApiError('NOT_FOUND', 404, 'Candidate not found on this election.');
  }
  const editable = await ballotEditable(id);
  if (!editable.editable) {
    throw new ApiError(
      'ELECTION_LOCKED',
      409,
      editable.reason === 'has-votes'
        ? 'Votes have been cast; the ballot is frozen.'
        : 'The ballot can only be edited while the election is a draft or scheduled.',
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; candidateId: string } },
) {
  return handle('admin_candidate_update', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    const candidateId = parseId(params.candidateId);
    await guard(id, candidateId);
    const body = await parseJson(req, patchCandidateSchema);
    await updateCandidate(candidateId!, { name: body.name, displayOrder: body.displayOrder });
    await logAdminAction(admin, 'candidate.updated', { electionId: id, candidateId });
    return ok({ ok: true }, { requestId });
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; candidateId: string } },
) {
  return handle('admin_candidate_remove', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    const candidateId = parseId(params.candidateId);
    await guard(id, candidateId);
    const result = await deleteCandidate(candidateId!);
    if (result === 'has-votes') {
      throw new ApiError('ELECTION_LOCKED', 409, 'This candidate already has votes.');
    }
    await logAdminAction(admin, 'candidate.removed', { electionId: id, candidateId });
    return ok({ ok: true }, { requestId });
  });
}

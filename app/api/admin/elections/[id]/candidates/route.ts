import { handle, ok, adminEmail, parseId, ApiError } from '@/lib/api';
import { parseJson, addCandidateSchema } from '@/lib/validation';
import { addCandidate, ballotEditable, positionInElection } from '@/lib/queries';
import { logAdminAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle('admin_candidate_add', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

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

    const body = await parseJson(req, addCandidateSchema);
    if (!(await positionInElection(id, body.positionId))) {
      throw new ApiError('INVALID_REQUEST', 400, 'That position is not on this election.');
    }
    const candidate = await addCandidate(body.positionId, body.name);
    await logAdminAction(admin, 'candidate.added', {
      electionId: id,
      positionId: body.positionId,
      candidateId: candidate.id,
    });
    return ok({ id: candidate.id, name: candidate.name }, { status: 201, requestId });
  });
}

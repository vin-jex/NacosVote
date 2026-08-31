import { handle, ok, adminEmail, parseId, ApiError } from '@/lib/api';
import { parseJson, addPositionSchema } from '@/lib/validation';
import { addPositionToElection, ballotEditable } from '@/lib/queries';
import { logAdminAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle('admin_position_add', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    const editable = await ballotEditable(id);
    if (!editable.editable) {
      throw new ApiError(
        'ELECTION_LOCKED',
        409,
        editable.reason === 'has-votes'
          ? 'Votes have been cast; the ballot is frozen. Clone the election to change it.'
          : 'The ballot can only be edited while the election is a draft or scheduled.',
      );
    }

    const body = await parseJson(req, addPositionSchema);
    try {
      const pos = await addPositionToElection(id, { positionId: body.positionId, name: body.name });
      await logAdminAction(admin, 'position.added', { electionId: id, positionId: pos.id });
      return ok({ id: pos.id, name: pos.name }, { status: 201, requestId });
    } catch (err) {
      if (err instanceof Error && err.message === 'position-not-found') {
        throw new ApiError('NOT_FOUND', 404, 'Position not found.');
      }
      throw err;
    }
  });
}

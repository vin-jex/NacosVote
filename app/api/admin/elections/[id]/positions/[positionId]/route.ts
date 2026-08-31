import { handle, ok, adminEmail, parseId, ApiError } from '@/lib/api';
import { parseJson, patchPositionSchema } from '@/lib/validation';
import { ballotEditable, positionInElection, removePositionFromElection, updatePosition } from '@/lib/queries';
import { logAdminAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function guard(id: number | null, positionId: number | null) {
  if (!id || !positionId) throw new ApiError('NOT_FOUND', 404, 'Not found.');
  if (!(await positionInElection(id, positionId))) {
    throw new ApiError('NOT_FOUND', 404, 'Position not found on this election.');
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

export async function PATCH(req: Request, { params }: { params: { id: string; positionId: string } }) {
  return handle('admin_position_update', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    const positionId = parseId(params.positionId);
    await guard(id, positionId);
    const body = await parseJson(req, patchPositionSchema);
    await updatePosition(id!, positionId!, { name: body.name, displayOrder: body.displayOrder });
    await logAdminAction(admin, 'position.updated', { electionId: id, positionId });
    return ok({ ok: true }, { requestId });
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; positionId: string } },
) {
  return handle('admin_position_remove', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    const positionId = parseId(params.positionId);
    await guard(id, positionId);
    const result = await removePositionFromElection(id!, positionId!);
    if (result === 'has-votes') {
      throw new ApiError('ELECTION_LOCKED', 409, 'This position already has votes.');
    }
    await logAdminAction(admin, 'position.removed', { electionId: id, positionId });
    return ok({ ok: true }, { requestId });
  });
}

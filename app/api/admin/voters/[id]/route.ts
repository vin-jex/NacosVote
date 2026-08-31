import { handle, ok, adminEmail, parseId, ApiError } from '@/lib/api';
import { parseJson, patchVoterSchema } from '@/lib/validation';
import { deleteVoter, updateVoter } from '@/lib/queries';
import { logAdminAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle('admin_voter_update', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Voter not found.');
    const body = await parseJson(req, patchVoterSchema);
    try {
      await updateVoter(id, { matricNumber: body.matricNumber, name: body.name });
      await logAdminAction(admin, 'voter.updated', { voterId: id });
      return ok({ ok: true }, { requestId });
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === '23505') {
        throw new ApiError('CONFLICT', 409, 'A voter with that matric number already exists.');
      }
      throw err;
    }
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return handle('admin_voter_delete', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Voter not found.');
    const result = await deleteVoter(id);
    if (result === 'has-voted') {
      throw new ApiError(
        'CONFLICT',
        409,
        'This voter has voted in an election and cannot be deleted from the registry.',
      );
    }
    await logAdminAction(admin, 'voter.deleted', { voterId: id });
    return ok({ ok: true }, { requestId });
  });
}

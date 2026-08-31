import { handle, ok, adminEmail, parseId, ApiError } from '@/lib/api';
import { removeElectionVoter } from '@/lib/queries';
import { logAdminAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; voterId: string } },
) {
  return handle('admin_election_voter_remove', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    const voterId = parseId(params.voterId);
    if (!id || !voterId) throw new ApiError('NOT_FOUND', 404, 'Not found.');

    const result = await removeElectionVoter(id, voterId);
    if (result === 'has-voted') {
      throw new ApiError('ELECTION_LOCKED', 409, 'This voter has already voted and cannot be removed.');
    }
    await logAdminAction(admin, 'election.voters.removed', { electionId: id, voterId });
    return ok({ ok: true }, { requestId });
  });
}

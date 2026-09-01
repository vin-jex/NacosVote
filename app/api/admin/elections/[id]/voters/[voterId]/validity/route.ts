import { handle, ok, adminEmail, parseId, ApiError } from '@/lib/api';
import { parseJson, ballotValiditySchema } from '@/lib/validation';
import { getElection, setBallotValidity } from '@/lib/queries';
import { logAdminAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mark one voter's attributable ballot invalid (or restore it). */
export async function POST(
  req: Request,
  { params }: { params: { id: string; voterId: string } },
) {
  return handle('admin_ballot_validity', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    const voterId = parseId(params.voterId);
    if (!id || !voterId) throw new ApiError('NOT_FOUND', 404, 'Not found.');

    const election = await getElection(id);
    if (!election) throw new ApiError('NOT_FOUND', 404, 'Election not found.');
    if (election.ballot_mode !== 'attributable') {
      throw new ApiError(
        'NOT_ATTRIBUTABLE',
        409,
        'This is a secret ballot; individual ballots cannot be invalidated.',
      );
    }

    const body = await parseJson(req, ballotValiditySchema);
    await setBallotValidity(id, voterId, body.invalid, body.reason);
    await logAdminAction(admin, body.invalid ? 'ballot.invalidated' : 'ballot.restored', {
      electionId: id,
      voterId,
    });
    return ok({ ok: true }, { requestId });
  });
}

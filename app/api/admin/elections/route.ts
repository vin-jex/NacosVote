import { handle, ok, adminEmail } from '@/lib/api';
import { parseJson, createElectionSchema } from '@/lib/validation';
import { createElection, listElections } from '@/lib/queries';
import { effectiveStatus } from '@/lib/election';
import { logAdminAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle('admin_elections_list', async ({ requestId }) => {
    await adminEmail();
    const elections = await listElections();
    return ok(
      {
        elections: elections.map((e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          status: e.status,
          effectiveStatus: effectiveStatus(e),
          version: e.version,
          votingStart: e.voting_start ? new Date(e.voting_start).toISOString() : null,
          votingEnd: e.voting_end ? new Date(e.voting_end).toISOString() : null,
          eligibleCount: e.eligible_count,
          votedCount: e.voted_count,
          createdAt: new Date(e.created_at).toISOString(),
        })),
      },
      { requestId },
    );
  });
}

export async function POST(req: Request) {
  return handle('admin_election_create', async ({ requestId }) => {
    const admin = await adminEmail();
    const body = await parseJson(req, createElectionSchema);
    const election = await createElection({
      title: body.title,
      description: body.description ?? null,
      voting_start: body.votingStart ?? null,
      voting_end: body.votingEnd ?? null,
    });
    await logAdminAction(admin, 'election.created', { electionId: election.id });
    return ok({ id: election.id }, { status: 201, requestId });
  });
}

import { handle, ok, adminEmail, parseId, ApiError } from '@/lib/api';
import { parseJson, parseQuery, addVotersSchema, listQuerySchema } from '@/lib/validation';
import { addElectionVoters, getElection, listElectionVoters } from '@/lib/queries';
import { logAdminAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  return handle('admin_election_voters_list', async ({ requestId }) => {
    await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Election not found.');
    const { q, limit, offset } = parseQuery(req, listQuerySchema);

    const { rows, matched, eligible, voted } = await listElectionVoters(id, {
      search: q,
      limit: limit ?? 50,
      offset: offset ?? 0,
    });

    return ok(
      {
        eligible,
        voted,
        notVoted: eligible - voted,
        matched,
        limit: limit ?? 50,
        offset: offset ?? 0,
        voters: rows.map((r) => ({
          id: r.voter_id,
          matricNumber: r.matric_number,
          name: r.name,
          voted: r.has_voted,
          votedAt: r.voted_at ? new Date(r.voted_at).toISOString() : null,
        })),
      },
      { requestId },
    );
  });
}

/** Parses and fully validates "matric,name" CSV. Rejects the whole file on any bad row. */
function parseCsv(text: string): { matricNumber: string; name?: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 20_000) {
    throw new ApiError('PAYLOAD_TOO_LARGE', 413, 'CSV has too many rows (max 20,000).');
  }
  const seen = new Set<string>();
  return lines.map((line, idx) => {
    const [rawMatric, ...rest] = line.split(',');
    const matricNumber = (rawMatric ?? '').trim();
    if (!matricNumber) {
      throw new ApiError('VALIDATION_FAILED', 400, `Row ${idx + 1}: missing matric number.`);
    }
    const key = matricNumber.toUpperCase().replace(/\s+/g, '');
    if (seen.has(key)) {
      throw new ApiError('VALIDATION_FAILED', 400, `Row ${idx + 1}: duplicate matric number.`);
    }
    seen.add(key);
    return { matricNumber, name: rest.join(',').trim() || undefined };
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handle('admin_election_voters_add', async ({ requestId }) => {
    const admin = await adminEmail();
    const id = parseId(params.id);
    if (!id) throw new ApiError('NOT_FOUND', 404, 'Election not found.');

    const election = await getElection(id);
    if (!election) throw new ApiError('NOT_FOUND', 404, 'Election not found.');
    if (election.status === 'closed') {
      throw new ApiError('ELECTION_LOCKED', 409, 'A closed election cannot take new voters.');
    }

    const body = await parseJson(req, addVotersSchema);
    const csvRows = body.csv ? parseCsv(body.csv) : [];

    // Adds only; never deletes existing eligibility. Idempotent per (election, voter).
    const { added, createdVoters } = await addElectionVoters(id, {
      voterIds: body.voterIds ?? [],
      csvRows,
    });
    await logAdminAction(admin, 'election.voters.added', { electionId: id, added, createdVoters });
    return ok({ added, createdVoters }, { requestId });
  });
}

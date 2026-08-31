import { handle, ok, adminEmail, ApiError } from '@/lib/api';
import { parseJson, parseQuery, createVoterSchema, listQuerySchema } from '@/lib/validation';
import { createVoter, listVoters } from '@/lib/queries';
import { logAdminAction } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle('admin_voters_list', async ({ requestId }) => {
    await adminEmail();
    const { q, limit, offset } = parseQuery(req, listQuerySchema);
    const { items, total } = await listVoters({ search: q, limit: limit ?? 50, offset: offset ?? 0 });
    return ok(
      {
        total,
        limit: limit ?? 50,
        offset: offset ?? 0,
        voters: items.map((v) => ({
          id: v.id,
          matricNumber: v.matric_number,
          name: v.name,
          createdAt: new Date(v.created_at).toISOString(),
        })),
      },
      { requestId },
    );
  });
}

export async function POST(req: Request) {
  return handle('admin_voter_create', async ({ requestId }) => {
    const admin = await adminEmail();
    const body = await parseJson(req, createVoterSchema);
    try {
      const voter = await createVoter(body.matricNumber, body.name);
      await logAdminAction(admin, 'voter.created', { voterId: voter.id });
      return ok({ id: voter.id }, { status: 201, requestId });
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === '23505') {
        throw new ApiError('CONFLICT', 409, 'A voter with that matric number already exists.');
      }
      throw err;
    }
  });
}

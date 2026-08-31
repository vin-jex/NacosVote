import { handle, ok, adminEmail } from '@/lib/api';
import { listAllPositions } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle('admin_positions_list', async ({ requestId }) => {
    await adminEmail();
    return ok({ positions: await listAllPositions() }, { requestId });
  });
}

import { handle, ok, fail, adminEmail } from '@/lib/api';
import { rateLimit } from '@/lib/redis';
import { parseJson, changePasswordSchema } from '@/lib/validation';
import { changeAdminPassword } from '@/lib/admins';
import { sendPasswordChangedEmail } from '@/lib/email';
import { logAdminAction } from '@/lib/audit';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle('admin_password_change', async ({ requestId }) => {
    const email = await adminEmail();

    if (!(await rateLimit(`pwchange:${email}`, 5, 900))) {
      return fail('RATE_LIMITED', 429, 'Too many attempts. Try again later.', requestId);
    }

    const body = await parseJson(req, changePasswordSchema);
    if (body.currentPassword === body.newPassword) {
      return fail('INVALID_REQUEST', 400, 'The new password must be different.', requestId);
    }

    const result = await changeAdminPassword(email, body.currentPassword, body.newPassword);
    if (result === 'wrong-current') {
      return fail('WRONG_PASSWORD', 403, 'Your current password is not correct.', requestId);
    }
    if (result === 'unknown-admin') {
      return fail('NOT_FOUND', 404, 'Admin account not found.', requestId);
    }

    // Never log the password itself.
    await logAdminAction(email, 'admin.password_changed', {});

    // Best-effort security alert. Must not affect the response.
    void sendPasswordChangedEmail(email).catch((err) =>
      log.error('password_changed_email_failed', { requestId, err: String(err).slice(0, 200) }),
    );

    return ok({ ok: true }, { requestId });
  });
}

import { pool } from './db';

/**
 * Records an administrative action. Best-effort: a logging failure must never
 * block the action itself. Never pass a vote choice or a voter->candidate link
 * in `detail`.
 */
export async function logAdminAction(
  adminEmail: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await pool.query(
      'INSERT INTO admin_audit_log (admin_email, action, detail) VALUES ($1, $2, $3)',
      [adminEmail, action, detail ? JSON.stringify(detail) : null],
    );
  } catch (err) {
    console.error('audit log write failed', err);
  }
}

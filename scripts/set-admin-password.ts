import { config } from 'dotenv';

config({ path: '.env.local' });

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';

/**
 * Out-of-band admin password reset (for a locked-out admin). Bypasses the
 * "current password" check, so it is deliberately interactive and requires DB
 * access via DATABASE_URL.
 *
 *   pnpm tsx scripts/set-admin-password.ts "admin@example.com" "the-new-password"
 */
async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  const password = process.argv[3] ?? '';
  if (!email || password.length < 10) {
    console.error('Usage: pnpm tsx scripts/set-admin-password.ts "email" "new-password (min 10 chars)"');
    process.exit(1);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const confirm = await rl.question(`Reset the password for "${email}"? Re-type the email to confirm: `);
  rl.close();
  if (confirm.trim().toLowerCase() !== email) {
    console.error('Confirmation did not match. Aborted.');
    process.exit(1);
  }

  const { pool } = await import('../lib/db');
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rowCount } = await pool.query(
      `INSERT INTO admins (email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [email, hash],
    );
    console.log(rowCount ? `Password set for ${email}.` : 'No change.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

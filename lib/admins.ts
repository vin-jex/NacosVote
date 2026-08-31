import bcrypt from 'bcryptjs';
import { pool } from './db';
import { log, safeError } from './log';

/*
 * Admin credentials live in the `admins` table. They are bootstrapped once from
 * the ADMIN_1_* / ADMIN_2_* env vars (email + bcrypt hash); after that the
 * database is authoritative so an admin can change their own password.
 *
 * The env hash is a SEED only: `ON CONFLICT DO NOTHING` means a later
 * password change in the DB is never overwritten on redeploy. To force-reset a
 * locked-out admin, run scripts/set-admin-password.ts.
 */

const BCRYPT_COST = 10;
// Valid-format bcrypt hash of a random string; compared against when the email
// is unknown so response timing does not distinguish "no such admin" from
// "wrong password".
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

let bootstrapped = false;

function envAdmins(): { email: string; hash: string }[] {
  return [
    { email: process.env.ADMIN_1_EMAIL, hash: process.env.ADMIN_1_PASSWORD_HASH },
    { email: process.env.ADMIN_2_EMAIL, hash: process.env.ADMIN_2_PASSWORD_HASH },
  ]
    .filter((a): a is { email: string; hash: string } => Boolean(a.email && a.hash))
    .map((a) => ({ email: a.email.trim().toLowerCase(), hash: a.hash }));
}

/** Idempotent: inserts any configured env admins that aren't already present. */
export async function bootstrapAdmins(): Promise<void> {
  if (bootstrapped) return;
  try {
    for (const a of envAdmins()) {
      await pool.query(
        `INSERT INTO admins (email, password_hash) VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING`,
        [a.email, a.hash],
      );
    }
    bootstrapped = true;
  } catch (err) {
    // Table missing / DB down: let the caller fall back or fail the login.
    log.error('admin_bootstrap_failed', { err: safeError(err) });
  }
}

export async function findAdminHash(email: string): Promise<string | null> {
  const { rows } = await pool.query<{ password_hash: string }>(
    'SELECT password_hash FROM admins WHERE email = $1',
    [email.trim().toLowerCase()],
  );
  return rows[0]?.password_hash ?? null;
}

/**
 * Verifies an email + password against the admins table, seeding from env first.
 * Always runs one bcrypt.compare so timing does not leak whether the email
 * exists. Returns the canonical (lowercased) email on success, else null.
 */
export async function verifyAdminCredentials(
  emailInput: string,
  password: string,
): Promise<string | null> {
  const email = emailInput.trim().toLowerCase();
  await bootstrapAdmins();

  let hash = await findAdminHash(email);
  // If the DB has no row yet (bootstrap failed / not run) fall back to the env
  // hash so the very first login can still get in.
  if (!hash) hash = envAdmins().find((a) => a.email === email)?.hash ?? null;

  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return hash && ok ? email : null;
}

export async function changeAdminPassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<'ok' | 'wrong-current' | 'unknown-admin'> {
  const canonical = email.trim().toLowerCase();
  await bootstrapAdmins();

  const hash = (await findAdminHash(canonical)) ?? envAdmins().find((a) => a.email === canonical)?.hash;
  if (!hash) return 'unknown-admin';
  if (!(await bcrypt.compare(currentPassword, hash))) return 'wrong-current';

  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await pool.query(
    `INSERT INTO admins (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
    [canonical, newHash],
  );
  return 'ok';
}

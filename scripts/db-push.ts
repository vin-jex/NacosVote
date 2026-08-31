import { config } from 'dotenv';

config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * Runs a .sql file against DATABASE_URL. Use this if `psql` is unavailable or
 * cannot reach Neon from your network.
 *
 *   pnpm tsx scripts/db-push.ts                              # db/schema.sql (fresh install)
 *   pnpm tsx scripts/db-push.ts db/migrations/001_add_admins.sql
 */
async function main() {
  const arg = process.argv[2] ?? 'db/schema.sql';
  const path = isAbsolute(arg) ? arg : join(process.cwd(), arg);
  const sql = readFileSync(path, 'utf8');

  const { pool } = await import('../lib/db');
  try {
    await pool.query(sql);
    console.log(`Applied ${arg}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

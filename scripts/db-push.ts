import { config } from 'dotenv';

config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Runs db/schema.sql against DATABASE_URL. Use this if `psql` is unavailable or
 * cannot reach Neon from your network:  pnpm tsx scripts/db-push.ts
 */
async function main() {
  const { pool } = await import('../lib/db');
  const sql = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Schema applied.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { config } from 'dotenv';

config({ path: '.env.local' });

/**
 * Opens an election for voting right now, closing after N minutes (default 20).
 * Operator action, run against DATABASE_URL:
 *
 *   pnpm tsx scripts/open-election.ts                 # the only election, 20 min
 *   pnpm tsx scripts/open-election.ts 1 45            # election 1, 45 min
 */
async function main() {
  const idArg = process.argv[2] ? Number(process.argv[2]) : null;
  const minutes = Number(process.argv[3] ?? 20);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.error('minutes must be a positive number');
    process.exit(1);
  }

  const { pool } = await import('../lib/db');
  try {
    let id = idArg;
    if (id == null) {
      const { rows } = await pool.query<{ id: number }>('SELECT id FROM elections ORDER BY id');
      if (rows.length !== 1) {
        console.error(
          `Found ${rows.length} elections. Pass an id: pnpm tsx scripts/open-election.ts <id> [minutes]`,
        );
        process.exit(1);
      }
      id = rows[0].id;
    }

    const { rows, rowCount } = await pool.query(
      `UPDATE elections
       SET status = 'open',
           voting_start = now(),
           voting_end = now() + ($2 || ' minutes')::interval,
           version = version + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING id, title, status, voting_start, voting_end, version`,
      [id, String(minutes)],
    );
    if (!rowCount) {
      console.error(`No election with id ${id}`);
      process.exit(1);
    }

    const counts = await pool.query<{ positions: string; candidates: string; voters: string }>(
      `SELECT
         (SELECT count(*) FROM election_positions WHERE election_id = $1) AS positions,
         (SELECT count(*) FROM candidates c JOIN election_positions ep
            ON ep.position_id = c.position_id AND ep.election_id = $1) AS candidates,
         (SELECT count(*) FROM election_voters WHERE election_id = $1) AS voters`,
      [id],
    );

    console.log('Opened:', rows[0]);
    console.log('Ballot:', counts.rows[0]);
    if (Number(counts.rows[0].positions) === 0 || Number(counts.rows[0].voters) === 0) {
      console.warn('WARNING: this election has no positions and/or no eligible voters yet.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

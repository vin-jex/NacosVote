import { config } from 'dotenv';

config({ path: '.env.local' });

import { normalizeMatric } from '../lib/normalize';

// ---------------------------------------------------------------------------
// Edit these arrays with real NACOS data, then run against an EMPTY database:
//   pnpm tsx scripts/seed.ts
//
// Voters are upserted by matric number. Elections/positions/candidates are
// always inserted fresh, so re-running creates duplicate elections - only run
// this once, or clear the elections table first.
// ---------------------------------------------------------------------------

const voters: { matricNumber: string; name: string }[] = [
  { matricNumber: 'CSC/2023/001', name: 'John Doe' },
  { matricNumber: 'CSC/2023/002', name: 'Jane Doe' },
  { matricNumber: 'CSC/2023/003', name: 'Michael Doe' },
];

type SeedElection = {
  title: string;
  description: string | null;
  status?: 'draft' | 'scheduled' | 'open' | 'closed';
  votingStart: string | null;
  votingEnd: string | null;
  eligibleVoterMatricNumbers: string[];
  positions: { name: string; candidates: string[] }[];
};

const elections: SeedElection[] = [
  {
    title: 'NACOS Chapter Primary Election 2026',
    description: 'Placeholder election created by the seed script.',
    status: 'scheduled',
    votingStart: '2026-09-05T10:00:00+01:00',
    votingEnd: '2026-09-05T16:00:00+01:00',
    eligibleVoterMatricNumbers: ['CSC/2023/001', 'CSC/2023/002', 'CSC/2023/003'],
    positions: [
      { name: 'President', candidates: ['Candidate A', 'Candidate B'] },
      { name: 'General Secretary', candidates: ['Candidate C', 'Candidate D'] },
    ],
  },
];

async function main() {
  const { pool } = await import('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const v of voters) {
      await client.query(
        `INSERT INTO voters (matric_number, name) VALUES ($1, $2)
         ON CONFLICT (matric_number) DO UPDATE SET name = EXCLUDED.name`,
        [normalizeMatric(v.matricNumber), v.name.trim()],
      );
    }

    for (const e of elections) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO elections (title, description, status, voting_start, voting_end)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [e.title, e.description, e.status ?? 'draft', e.votingStart, e.votingEnd],
      );
      const electionId = rows[0].id;

      for (let i = 0; i < e.positions.length; i++) {
        const p = e.positions[i];
        const pos = await client.query<{ id: number }>(
          'INSERT INTO positions (name) VALUES ($1) RETURNING id',
          [p.name],
        );
        const positionId = pos.rows[0].id;
        await client.query(
          `INSERT INTO election_positions (election_id, position_id, display_order)
           VALUES ($1, $2, $3)`,
          [electionId, positionId, i],
        );
        for (let j = 0; j < p.candidates.length; j++) {
          await client.query(
            'INSERT INTO candidates (position_id, name, display_order) VALUES ($1, $2, $3)',
            [positionId, p.candidates[j], j],
          );
        }
      }

      for (const matric of e.eligibleVoterMatricNumbers) {
        await client.query(
          `INSERT INTO election_voters (election_id, voter_id)
           SELECT $1, id FROM voters WHERE matric_number = $2
           ON CONFLICT (election_id, voter_id) DO NOTHING`,
          [electionId, normalizeMatric(matric)],
        );
      }
    }

    await client.query('COMMIT');
    console.log(
      `Seeded ${voters.length} voters and ${elections.length} election(s): ` +
        elections.map((e) => `"${e.title}"`).join(', '),
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

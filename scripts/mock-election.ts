import { config } from 'dotenv';

config({ path: '.env.local' });

/*
 * Builds a throwaway ATTRIBUTABLE election, casts mock ballots, invalidates a
 * few, and prints the result before/after so you can see the format. Deletes
 * the mock afterwards (pass --keep to leave it in the DB).
 *
 *   pnpm tsx scripts/mock-election.ts
 */
async function main() {
  const keep = process.argv.includes('--keep');
  const { pool } = await import('../lib/db');
  const { getResults, setBallotValidity } = await import('../lib/queries');

  const e = await pool.query<{ id: number }>(
    `INSERT INTO elections (title, status, voting_start, voting_end, eligibility_mode, ballot_mode, results_visibility)
     VALUES ('MOCK attributable ballot', 'closed', now() - interval '2h', now() - interval '1h', 'open', 'attributable', 'on_close')
     RETURNING id`,
  );
  const eid = e.rows[0].id;
  const p = await pool.query<{ id: number }>(`INSERT INTO positions (name) VALUES ('President') RETURNING id`);
  const pid = p.rows[0].id;
  await pool.query(`INSERT INTO election_positions (election_id, position_id, display_order) VALUES ($1,$2,0)`, [eid, pid]);

  const cand: Record<string, number> = {};
  let ord = 0;
  for (const n of ['Alice', 'Bob', 'Chidi']) {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO candidates (position_id, name, display_order) VALUES ($1,$2,$3) RETURNING id`,
      [pid, n, ord++],
    );
    cand[n] = r.rows[0].id;
  }

  // 24 mock voters: 12 Alice, 8 Bob, 4 Chidi
  const plan = [
    ...Array(12).fill('Alice'),
    ...Array(8).fill('Bob'),
    ...Array(4).fill('Chidi'),
  ];
  const voterIds: number[] = [];
  for (let i = 0; i < plan.length; i++) {
    const v = await pool.query<{ id: number }>(
      `INSERT INTO voters (matric_number, name) VALUES ($1,$2) RETURNING id`,
      [`MOCK${1000 + i}`, `Mock Voter ${i + 1}`],
    );
    const vid = v.rows[0].id;
    voterIds.push(vid);
    await pool.query(
      `INSERT INTO election_voters (election_id, voter_id, has_voted, voted_at) VALUES ($1,$2,true,now())`,
      [eid, vid],
    );
    await pool.query(
      `INSERT INTO attributed_votes (election_id, voter_id, position_id, candidate_id) VALUES ($1,$2,$3,$4)`,
      [eid, vid, pid, cand[plan[i]]],
    );
  }

  const show = async (label: string) => {
    const r = await getResults(eid, { limit: 200 });
    console.log(`\n=== ${label} ===`);
    for (const pos of r.positions) {
      const cast = pos.candidates.reduce((s, c) => s + c.votes, 0);
      console.log(`${pos.name}   (${cast} valid votes)`);
      for (const c of pos.candidates) {
        const pct = cast ? ((c.votes / cast) * 100).toFixed(1) : '0.0';
        console.log(`   ${c.name.padEnd(10)} ${String(c.votes).padStart(3)}   ${pct}%`);
      }
    }
    console.log(`turnout: ${r.turnout.voted} ballots | review: ${r.review.confirmedValid} valid, ${r.review.invalidated} invalid, ${r.review.unreviewed} unreviewed`);
  };

  await show('BEFORE any invalidation (all 24 ballots count)');

  // Simulate "not on the confirmation list": invalidate 3 Alice voters + 1 Bob voter
  const toKill = [voterIds[0], voterIds[1], voterIds[2], voterIds[12]];
  for (const vid of toKill) await setBallotValidity(eid, vid, true, 'not on confirmation list');

  await show('AFTER invalidating 4 ballots (3 Alice, 1 Bob)');

  console.log('\n=== Admin dashboard per-voter view (first 8 rows) ===');
  const r = await getResults(eid, { limit: 8 });
  console.log('attributable:', r.attributable);
  for (const v of r.voters) {
    console.log(`   ${v.name.padEnd(16)} voted: ${v.choice ?? '-'}    ${v.review ?? 'not reviewed'}`);
  }

  if (keep) {
    console.log(`\nKept mock election id ${eid}. Delete with: DELETE FROM elections WHERE id = ${eid};`);
  } else {
    await pool.query(`DELETE FROM voters WHERE matric_number LIKE 'MOCK%'`);
    await pool.query(`DELETE FROM elections WHERE id = $1`, [eid]);
    console.log('\n(mock election deleted)');
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

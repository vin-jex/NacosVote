import { config } from 'dotenv';

config({ path: '.env.local' });

import { normalizeMatric } from '../lib/normalize';

/*
 * Manage a post-vote confirmation list for an open-mode election and reconcile
 * it against who actually voted. A participant is a VALID stakeholder if their
 * reg number OR their name matches a confirmation entry.
 *
 * This flags PARTICIPANTS, never a ballot. The ballot is secret, so flagging a
 * participant invalid changes turnout / valid-count reporting but cannot
 * subtract that ballot from an individual candidate's total.
 *
 *   pnpm tsx scripts/confirm.ts import <electionId>        # stdin, one per line:
 *                                                          #   Full Name | 2024514226
 *                                                          #   Full Name 2024514226
 *                                                          #   Full Name                (no reg no)
 *   pnpm tsx scripts/confirm.ts add <electionId> "Full Name" [regNo]
 *   pnpm tsx scripts/confirm.ts list <electionId>
 *   pnpm tsx scripts/confirm.ts reconcile <electionId>
 *   pnpm tsx scripts/confirm.ts apply <electionId> [--yes] [--reason "..."]   # flag unmatched voters invalid
 *   pnpm tsx scripts/confirm.ts validate <electionId> <regNo|"Full Name">     # clear the invalid flag
 */

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length > 1)
    .sort();

const nameMatch = (a: string, b: string) => {
  const A = tokens(a);
  const B = tokens(b);
  if (A.length < 2 || B.length < 2) return false;
  const [small, big] = A.length <= B.length ? [A, B] : [B, A];
  const hits = small.filter((t) => big.includes(t)).length;
  // require at least two shared name tokens, and all of the shorter name present
  return hits >= 2 && hits === small.length;
};

function parseLine(line: string): { name: string; matric: string | null } | null {
  const raw = line.trim();
  if (!raw) return null;
  let m = raw.match(/^(.*?)[|,]\s*([A-Za-z0-9/]{5,})\s*$/);
  if (!m) m = raw.match(/^(.*?)\s+([0-9]{6,}[A-Za-z0-9/]*)\s*$/);
  if (m) return { name: m[1].trim().replace(/\s+/g, ' '), matric: normalizeMatric(m[2]) };
  return { name: raw.replace(/\s+/g, ' '), matric: null };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

type Voter = { voter_id: number; matric_number: string; name: string; invalidated: boolean };
type Conf = { matric_number: string | null; name: string };

function classify(voters: Voter[], confs: Conf[]) {
  const byMatric = new Map(confs.filter((c) => c.matric_number).map((c) => [c.matric_number!, c]));
  const used = new Set<Conf>();
  const matched: Voter[] = [];
  const unmatched: Voter[] = [];
  for (const v of voters) {
    let hit: Conf | undefined = byMatric.get(v.matric_number);
    if (!hit) hit = confs.find((c) => !used.has(c) && nameMatch(c.name, v.name));
    if (hit) {
      used.add(hit);
      matched.push(v);
    } else {
      unmatched.push(v);
    }
  }
  const unusedConfs = confs.filter((c) => !used.has(c));
  return { matched, unmatched, unusedConfs };
}

async function main() {
  const argv = process.argv.slice(2);
  const [cmd, idArg] = argv;
  const rest = argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const reasonIdx = argv.indexOf('--reason');
  const reason = reasonIdx >= 0 ? argv[reasonIdx + 1] : 'not on confirmation list';
  const electionId = Number(idArg);
  if (!cmd || !Number.isInteger(electionId)) {
    console.error('Usage: pnpm tsx scripts/confirm.ts <import|add|list|reconcile|apply|validate> <electionId> ...');
    process.exit(1);
  }

  const { pool } = await import('../lib/db');
  try {
    const loadVoters = async (): Promise<Voter[]> =>
      (
        await pool.query<Voter>(
          `SELECT v.id AS voter_id, v.matric_number, v.name, ev.invalidated
           FROM election_voters ev JOIN voters v ON v.id = ev.voter_id
           WHERE ev.election_id = $1 AND ev.has_voted = true
           ORDER BY v.name`,
          [electionId],
        )
      ).rows;
    const loadConfs = async (): Promise<Conf[]> =>
      (
        await pool.query<Conf>(
          `SELECT matric_number, name FROM vote_confirmations WHERE election_id = $1`,
          [electionId],
        )
      ).rows;

    if (cmd === 'add') {
      const name = (rest[0] ?? '').trim().replace(/\s+/g, ' ');
      const matric = rest[1] ? normalizeMatric(rest[1]) : null;
      if (!name) throw new Error('name required');
      await pool.query(
        `INSERT INTO vote_confirmations (election_id, name, matric_number) VALUES ($1, $2, $3)
         ON CONFLICT (election_id, matric_number) WHERE matric_number IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name`,
        [electionId, name, matric],
      );
      console.log(`added: ${name}${matric ? ` (${matric})` : ' (no reg no)'}`);
    } else if (cmd === 'import') {
      const lines = (await readStdin())
        .split(/\r?\n/)
        .map(parseLine)
        .filter(Boolean) as { name: string; matric: string | null }[];
      for (const l of lines) {
        await pool.query(
          `INSERT INTO vote_confirmations (election_id, name, matric_number) VALUES ($1, $2, $3)
           ON CONFLICT (election_id, matric_number) WHERE matric_number IS NOT NULL
           DO UPDATE SET name = EXCLUDED.name`,
          [electionId, l.name, l.matric],
        );
      }
      console.log(`imported ${lines.length} confirmation rows for election ${electionId}`);
    } else if (cmd === 'list') {
      const r = await pool.query(
        `SELECT name, matric_number FROM vote_confirmations WHERE election_id = $1 ORDER BY name`,
        [electionId],
      );
      console.table(r.rows);
      console.log(`${r.rowCount} confirmations`);
    } else if (cmd === 'reconcile') {
      const voters = await loadVoters();
      const confs = await loadConfs();
      const { matched, unmatched, unusedConfs } = classify(voters, confs);
      console.log(`\nElection ${electionId} reconciliation (match by reg number OR name)`);
      console.log(`  ballots cast:               ${voters.length}`);
      console.log(`  confirmation list entries:  ${confs.length}`);
      console.log(`  currently flagged invalid:  ${voters.filter((v) => v.invalidated).length}`);
      console.log(`\n  VALID stakeholders (voted and on the list): ${matched.length}`);
      matched.forEach((v) => console.log(`    + ${v.name}  ${v.matric_number}${v.invalidated ? '   [currently flagged INVALID]' : ''}`));
      console.log(`\n  VOTED but NOT on the list: ${unmatched.length}`);
      unmatched.forEach((v) => console.log(`    ? ${v.name}  ${v.matric_number}${v.invalidated ? '   [flagged invalid]' : ''}`));
      console.log(`\n  On the list but NO vote record: ${unusedConfs.length}`);
      unusedConfs.forEach((c) => console.log(`    ! ${c.name}  ${c.matric_number ?? '(no reg no)'}`));
      console.log('');
    } else if (cmd === 'apply') {
      const voters = await loadVoters();
      const confs = await loadConfs();
      const { unmatched } = classify(voters, confs);
      const toFlag = unmatched.filter((v) => !v.invalidated);
      console.log(`Would flag INVALID: ${toFlag.length} participant(s) who voted but are not on the confirmation list.`);
      toFlag.forEach((v) => console.log(`  - ${v.name}  ${v.matric_number}`));
      if (!flags.has('--yes')) {
        console.log('\nDry run. Re-run with --yes to apply. Note: candidate vote totals are NOT changed.');
      } else {
        for (const v of toFlag) {
          await pool.query(
            `UPDATE election_voters SET invalidated = true, invalid_reason = $3, invalidated_at = now()
             WHERE election_id = $1 AND voter_id = $2`,
            [electionId, v.voter_id, reason],
          );
        }
        console.log(`\nFlagged ${toFlag.length} participant(s) invalid. Candidate totals unchanged (secret ballot).`);
      }
    } else if (cmd === 'validate') {
      const key = rest[0] ?? '';
      const asMatric = normalizeMatric(key);
      const r = await pool.query(
        `UPDATE election_voters ev SET invalidated = false, invalid_reason = NULL, invalidated_at = NULL
         FROM voters v
         WHERE ev.voter_id = v.id AND ev.election_id = $1
           AND (v.matric_number = $2 OR lower(v.name) = lower($3))`,
        [electionId, asMatric, key],
      );
      console.log(`cleared invalid flag on ${r.rowCount ?? 0} participant(s)`);
    } else {
      console.error(`unknown command: ${cmd}`);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

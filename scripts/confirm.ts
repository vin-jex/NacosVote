import { config } from 'dotenv';

config({ path: '.env.local' });

import { normalizeMatric } from '../lib/normalize';

/*
 * Post-vote confirmation + declared-choice tooling for a confirmation-reconciled
 * open-mode election. A participant is a VALID stakeholder if their reg number
 * OR name matches a confirmation entry. Declared choices from confirmed-valid
 * entries form the OFFICIAL tally; the anonymous votes table stays as audit.
 *
 *   pnpm tsx scripts/confirm.ts import <electionId>       # stdin: "Full Name | 2024514226" per line
 *   pnpm tsx scripts/confirm.ts add <electionId> "Full Name" [regNo]
 *   pnpm tsx scripts/confirm.ts list <electionId>
 *   pnpm tsx scripts/confirm.ts reconcile <electionId>
 *   pnpm tsx scripts/confirm.ts confirm <electionId> [--yes]                 # mark matched entries confirmed valid
 *   pnpm tsx scripts/confirm.ts apply <electionId> [--yes] [--reason "..."]  # flag unmatched voters invalid
 *   pnpm tsx scripts/confirm.ts validate <electionId> <regNo|"Full Name">    # clear an invalid flag
 *   pnpm tsx scripts/confirm.ts declare <electionId> "<regNo|Full Name>" "<Candidate>" ["<Position>"]
 *   pnpm tsx scripts/confirm.ts declare-import <electionId>                  # stdin: "<regNo|Name> | <Candidate>" per line
 *   pnpm tsx scripts/confirm.ts official <electionId>                        # print the declared-choice tally
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

type Voter = { voter_id: number; matric_number: string; name: string; invalidated: boolean; confirmed_valid: boolean };
type Conf = { id: number; matric_number: string | null; name: string; confirmed_valid: boolean };

function classify(voters: Voter[], confs: Conf[]) {
  const byMatric = new Map(confs.filter((c) => c.matric_number).map((c) => [c.matric_number!, c]));
  const used = new Set<Conf>();
  const matched: { voter: Voter; conf: Conf }[] = [];
  const unmatched: Voter[] = [];
  for (const v of voters) {
    let hit: Conf | undefined = byMatric.get(v.matric_number);
    if (!hit) hit = confs.find((c) => !used.has(c) && nameMatch(c.name, v.name));
    if (hit) {
      used.add(hit);
      matched.push({ voter: v, conf: hit });
    } else {
      unmatched.push(v);
    }
  }
  return { matched, unmatched, unusedConfs: confs.filter((c) => !used.has(c)) };
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
    console.error(
      'Usage: pnpm tsx scripts/confirm.ts <import|add|list|reconcile|confirm|apply|validate|declare|declare-import|official> <electionId> ...',
    );
    process.exit(1);
  }

  const { pool } = await import('../lib/db');
  try {
    const loadVoters = async (): Promise<Voter[]> =>
      (
        await pool.query<Voter>(
          `SELECT v.id AS voter_id, v.matric_number, v.name, ev.invalidated, ev.confirmed_valid
           FROM election_voters ev JOIN voters v ON v.id = ev.voter_id
           WHERE ev.election_id = $1 AND ev.has_voted = true
           ORDER BY v.name`,
          [electionId],
        )
      ).rows;
    const loadConfs = async (): Promise<Conf[]> =>
      (
        await pool.query<Conf>(
          `SELECT id, matric_number, name, confirmed_valid FROM vote_confirmations WHERE election_id = $1`,
          [electionId],
        )
      ).rows;
    const positions = async () =>
      (
        await pool.query<{ id: number; name: string }>(
          `SELECT p.id, p.name FROM election_positions ep JOIN positions p ON p.id = ep.position_id
           WHERE ep.election_id = $1 ORDER BY ep.display_order, p.id`,
          [electionId],
        )
      ).rows;
    const candidates = async () =>
      (
        await pool.query<{ id: number; name: string; position_id: number }>(
          `SELECT c.id, c.name, c.position_id FROM candidates c
           JOIN election_positions ep ON ep.position_id = c.position_id AND ep.election_id = $1`,
          [electionId],
        )
      ).rows;

    async function findConfId(key: string): Promise<{ id: number; name: string } | null> {
      const asMatric = normalizeMatric(key);
      const confs = await loadConfs();
      const byM = confs.find((c) => c.matric_number === asMatric);
      if (byM) return { id: byM.id, name: byM.name };
      const byN = confs.find((c) => nameMatch(c.name, key) || c.name.toLowerCase() === key.toLowerCase());
      return byN ? { id: byN.id, name: byN.name } : null;
    }

    async function resolveChoice(candKey: string, posKey?: string) {
      const cands = await candidates();
      const posList = await positions();
      let pool2 = cands;
      if (posKey) {
        const p = posList.find(
          (x) => x.name.toLowerCase() === posKey.toLowerCase() || nameMatch(x.name, posKey),
        );
        if (!p) throw new Error(`position not found: ${posKey}`);
        pool2 = cands.filter((c) => c.position_id === p.id);
      } else if (posList.length !== 1) {
        throw new Error(`election has ${posList.length} positions; pass the position name as the 3rd arg`);
      }
      const lc = candKey.toLowerCase();
      let c = pool2.find((x) => x.name.toLowerCase() === lc);
      if (!c) c = pool2.find((x) => x.name.toLowerCase().includes(lc) || lc.includes(x.name.toLowerCase()));
      if (!c) c = pool2.find((x) => nameMatch(x.name, candKey));
      if (!c) throw new Error(`candidate not found: ${candKey}`);
      return { candidateId: c.id, positionId: c.position_id, candidateName: c.name };
    }

    async function setDeclaration(confId: number, candidateId: number, positionId: number) {
      await pool.query(
        `INSERT INTO vote_declarations (election_id, confirmation_id, position_id, candidate_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (confirmation_id, position_id) DO UPDATE SET candidate_id = EXCLUDED.candidate_id`,
        [electionId, confId, positionId, candidateId],
      );
    }

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
      const lines = (await readStdin()).split(/\r?\n/).map(parseLine).filter(Boolean) as {
        name: string;
        matric: string | null;
      }[];
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
        `SELECT name, matric_number, confirmed_valid FROM vote_confirmations WHERE election_id = $1 ORDER BY name`,
        [electionId],
      );
      console.table(r.rows);
      console.log(`${r.rowCount} confirmations`);
    } else if (cmd === 'reconcile') {
      const { matched, unmatched, unusedConfs } = classify(await loadVoters(), await loadConfs());
      console.log(`\nElection ${electionId} reconciliation (match by reg number OR name)`);
      console.log(`  ballots cast:               ${matched.length + unmatched.length}`);
      console.log(`  VALID stakeholders (voted and on the list): ${matched.length}`);
      matched.forEach(({ voter: v, conf: c }) =>
        console.log(`    + ${v.name}  ${v.matric_number}${c.confirmed_valid ? '  [confirmed]' : ''}`),
      );
      console.log(`\n  VOTED but NOT on the list: ${unmatched.length}`);
      unmatched.forEach((v) => console.log(`    ? ${v.name}  ${v.matric_number}`));
      console.log(`\n  On the list but NO vote record: ${unusedConfs.length}`);
      unusedConfs.forEach((c) => console.log(`    ! ${c.name}  ${c.matric_number ?? '(no reg no)'}`));
      console.log('');
    } else if (cmd === 'confirm') {
      const { matched } = classify(await loadVoters(), await loadConfs());
      const todo = matched.filter(({ voter, conf }) => !voter.confirmed_valid || !conf.confirmed_valid);
      console.log(`Would mark CONFIRMED VALID: ${todo.length} matched participant(s).`);
      todo.forEach(({ voter: v }) => console.log(`  + ${v.name}  ${v.matric_number}`));
      if (!flags.has('--yes')) {
        console.log('\nDry run. Re-run with --yes to apply.');
      } else {
        for (const { voter, conf } of todo) {
          await pool.query(
            `UPDATE election_voters SET confirmed_valid = true, confirmed_at = now(),
               invalidated = false, invalid_reason = NULL, invalidated_at = NULL
             WHERE election_id = $1 AND voter_id = $2`,
            [electionId, voter.voter_id],
          );
          await pool.query(`UPDATE vote_confirmations SET confirmed_valid = true WHERE id = $1`, [conf.id]);
        }
        console.log(`\nConfirmed ${todo.length} this run.`);
      }
    } else if (cmd === 'apply') {
      const { unmatched } = classify(await loadVoters(), await loadConfs());
      const toFlag = unmatched.filter((v) => !v.invalidated);
      console.log(`Would flag INVALID: ${toFlag.length} participant(s) who voted but are not on the list.`);
      toFlag.forEach((v) => console.log(`  - ${v.name}  ${v.matric_number}`));
      if (!flags.has('--yes')) {
        console.log('\nDry run. Re-run with --yes to apply. Note: anonymous candidate totals are NOT changed.');
      } else {
        for (const v of toFlag) {
          await pool.query(
            `UPDATE election_voters SET invalidated = true, invalid_reason = $3, invalidated_at = now()
             WHERE election_id = $1 AND voter_id = $2`,
            [electionId, v.voter_id, reason],
          );
        }
        console.log(`\nFlagged ${toFlag.length} participant(s) invalid.`);
      }
    } else if (cmd === 'validate') {
      const key = rest[0] ?? '';
      const r = await pool.query(
        `UPDATE election_voters ev SET invalidated = false, invalid_reason = NULL, invalidated_at = NULL
         FROM voters v
         WHERE ev.voter_id = v.id AND ev.election_id = $1
           AND (v.matric_number = $2 OR lower(v.name) = lower($3))`,
        [electionId, normalizeMatric(key), key],
      );
      console.log(`cleared invalid flag on ${r.rowCount ?? 0} participant(s)`);
    } else if (cmd === 'declare') {
      const [personKey, candKey, posKey] = rest;
      if (!personKey || !candKey) throw new Error('usage: declare <electionId> "<regNo|Name>" "<Candidate>" ["<Position>"]');
      const conf = await findConfId(personKey);
      if (!conf) throw new Error(`no confirmation entry matches: ${personKey}`);
      const { candidateId, positionId, candidateName } = await resolveChoice(candKey, posKey);
      await setDeclaration(conf.id, candidateId, positionId);
      console.log(`${conf.name} -> ${candidateName}`);
    } else if (cmd === 'declare-import') {
      const lines = (await readStdin())
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      let n = 0;
      const problems: string[] = [];
      for (const line of lines) {
        const parts = line.split('|').map((s) => s.trim());
        if (parts.length < 2) {
          problems.push(`no '|': ${line}`);
          continue;
        }
        const [personKey, candKey, posKey] = parts;
        try {
          const conf = await findConfId(personKey);
          if (!conf) throw new Error('no confirmation match');
          const { candidateId, positionId } = await resolveChoice(candKey, posKey);
          await setDeclaration(conf.id, candidateId, positionId);
          n++;
        } catch (e) {
          problems.push(`${line}  (${e instanceof Error ? e.message : e})`);
        }
      }
      console.log(`recorded ${n} declaration(s)`);
      if (problems.length) {
        console.log(`\n${problems.length} not recorded:`);
        problems.forEach((p) => console.log(`  x ${p}`));
      }
    } else if (cmd === 'official') {
      const rows = (
        await pool.query<{ position: string; candidate: string; declared: string }>(
          `SELECT p.name AS position, c.name AS candidate, count(*)::int AS declared
           FROM vote_declarations d
           JOIN vote_confirmations vc ON vc.id = d.confirmation_id AND vc.confirmed_valid = true
           JOIN positions p ON p.id = d.position_id
           JOIN candidates c ON c.id = d.candidate_id
           WHERE d.election_id = $1
           GROUP BY p.name, c.name
           ORDER BY p.name, declared DESC`,
          [electionId],
        )
      ).rows;
      const total = (
        await pool.query<{ n: string }>(
          `SELECT count(DISTINCT d.confirmation_id)::int n FROM vote_declarations d
           JOIN vote_confirmations vc ON vc.id = d.confirmation_id AND vc.confirmed_valid = true
           WHERE d.election_id = $1`,
          [electionId],
        )
      ).rows[0].n;
      console.log(`\nOfficial tally (declared by confirmed-valid stakeholders) - ${total} declarations`);
      let cur = '';
      for (const r of rows) {
        if (r.position !== cur) {
          cur = r.position;
          console.log(`\n  ${r.position}`);
        }
        console.log(`    ${r.candidate.padEnd(24)} ${r.declared}`);
      }
      console.log('');
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

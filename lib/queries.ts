import { pool, withTx, RollbackSignal } from './db';
import { normalizeMatric } from './normalize';
import { validateSelections, type BallotShape } from './ballot-rules';
import type { ElectionStatus } from './election';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Election = {
  id: number;
  title: string;
  description: string | null;
  status: ElectionStatus;
  voting_start: Date | null;
  voting_end: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
};

export type Voter = {
  id: number;
  matric_number: string;
  name: string;
  created_at: Date;
};

export type BallotCandidate = { id: number; name: string };
export type BallotPosition = { id: number; name: string; candidates: BallotCandidate[] };

export type ResultsPosition = {
  id: number;
  name: string;
  candidates: { id: number; name: string; votes: number }[];
};

export type Turnout = { voted: number; total: number };

export type ElectionSummary = Election & {
  eligible_count: number;
  voted_count: number;
};

// ---------------------------------------------------------------------------
// Elections
// ---------------------------------------------------------------------------

const ELECTION_COLS =
  'id, title, description, status, voting_start, voting_end, version, created_at, updated_at';

export async function listElections(): Promise<ElectionSummary[]> {
  const { rows } = await pool.query<ElectionSummary>(
    `SELECT e.id, e.title, e.description, e.status, e.voting_start, e.voting_end,
            e.version, e.created_at, e.updated_at,
            COALESCE(ev.eligible_count, 0)::int AS eligible_count,
            COALESCE(ev.voted_count, 0)::int    AS voted_count
     FROM elections e
     LEFT JOIN (
       SELECT election_id,
              count(*)                          AS eligible_count,
              count(*) FILTER (WHERE has_voted) AS voted_count
       FROM election_voters
       GROUP BY election_id
     ) ev ON ev.election_id = e.id
     ORDER BY e.created_at DESC`,
  );
  return rows;
}

export async function getElection(id: number): Promise<Election | null> {
  const { rows } = await pool.query<Election>(
    `SELECT ${ELECTION_COLS} FROM elections WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Authoritative open/closed check for the voting path, decided by the DATABASE
 * clock. Boundary: voting_start <= now() < voting_end.
 */
export async function getElectionForVoting(
  id: number,
): Promise<{ id: number; title: string; voting_end: Date | null; is_open: boolean } | null> {
  const { rows } = await pool.query<{
    id: number;
    title: string;
    voting_end: Date | null;
    is_open: boolean;
  }>(
    `SELECT id, title, voting_end,
            (status = 'open'
             AND voting_start IS NOT NULL AND voting_end IS NOT NULL
             AND now() >= voting_start AND now() < voting_end) AS is_open
     FROM elections WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function electionHasVotes(id: number): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM votes WHERE election_id = $1 LIMIT 1', [id]);
  return rows.length > 0;
}

export async function getOpenElections(): Promise<Pick<Election, 'id' | 'title' | 'voting_end'>[]> {
  const { rows } = await pool.query<Pick<Election, 'id' | 'title' | 'voting_end'>>(
    `SELECT id, title, voting_end
     FROM elections
     WHERE status = 'open'
       AND voting_start IS NOT NULL AND voting_end IS NOT NULL
       AND now() BETWEEN voting_start AND voting_end
     ORDER BY voting_end ASC`,
  );
  return rows;
}

export async function createElection(input: {
  title: string;
  description: string | null;
  voting_start: string | null;
  voting_end: string | null;
}): Promise<Election> {
  const { rows } = await pool.query<Election>(
    `INSERT INTO elections (title, description, voting_start, voting_end)
     VALUES ($1, $2, $3, $4)
     RETURNING ${ELECTION_COLS}`,
    [input.title, input.description, input.voting_start, input.voting_end],
  );
  return rows[0];
}

export type UpdateElectionResult =
  | { outcome: 'ok'; election: Election }
  | { outcome: 'not-found' }
  | { outcome: 'stale' };

/**
 * Optimistic-concurrency update. `expectedVersion` must match the row's current
 * version or the write is rejected as stale (another admin changed it first).
 * Version is bumped on every successful update.
 */
export async function updateElection(
  id: number,
  expectedVersion: number,
  patch: Partial<Pick<Election, 'title' | 'description' | 'status'>> & {
    voting_start?: string | null;
    voting_end?: string | null;
  },
): Promise<UpdateElectionResult> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const key of ['title', 'description', 'status', 'voting_start', 'voting_end'] as const) {
    if (key in patch) {
      sets.push(`${key} = $${i++}`);
      values.push((patch as Record<string, unknown>)[key]);
    }
  }
  sets.push('updated_at = now()', 'version = version + 1');
  values.push(id, expectedVersion);

  const { rows } = await pool.query<Election>(
    `UPDATE elections SET ${sets.join(', ')}
     WHERE id = $${i++} AND version = $${i}
     RETURNING ${ELECTION_COLS}`,
    values,
  );
  if (rows[0]) return { outcome: 'ok', election: rows[0] };

  const exists = await pool.query('SELECT 1 FROM elections WHERE id = $1', [id]);
  return exists.rows.length > 0 ? { outcome: 'stale' } : { outcome: 'not-found' };
}

export async function deleteElection(id: number): Promise<'ok' | 'not-draft' | 'not-found'> {
  const election = await getElection(id);
  if (!election) return 'not-found';
  if (election.status !== 'draft') return 'not-draft';
  await pool.query('DELETE FROM elections WHERE id = $1', [id]);
  return 'ok';
}

// ---------------------------------------------------------------------------
// Positions & candidates
// ---------------------------------------------------------------------------

export async function listAllPositions(): Promise<{ id: number; name: string }[]> {
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM positions ORDER BY name',
  );
  return rows;
}

/** Positions on an election's ballot, ordered, with their candidates ordered. */
export async function getElectionBallot(electionId: number): Promise<BallotPosition[]> {
  const { rows } = await pool.query<{
    position_id: number;
    position_name: string;
    pos_order: number;
    candidate_id: number | null;
    candidate_name: string | null;
    cand_order: number | null;
  }>(
    `SELECT p.id AS position_id, p.name AS position_name, ep.display_order AS pos_order,
            c.id AS candidate_id, c.name AS candidate_name, c.display_order AS cand_order
     FROM election_positions ep
     JOIN positions p ON p.id = ep.position_id
     LEFT JOIN candidates c ON c.position_id = p.id
     WHERE ep.election_id = $1
     ORDER BY ep.display_order, p.id, c.display_order, c.id`,
    [electionId],
  );

  const byId = new Map<number, BallotPosition>();
  for (const r of rows) {
    let pos = byId.get(r.position_id);
    if (!pos) {
      pos = { id: r.position_id, name: r.position_name, candidates: [] };
      byId.set(r.position_id, pos);
    }
    if (r.candidate_id != null) pos.candidates.push({ id: r.candidate_id, name: r.candidate_name! });
  }
  return [...byId.values()];
}

export async function addPositionToElection(
  electionId: number,
  opts: { positionId?: number; name?: string },
): Promise<{ id: number; name: string }> {
  return withTx(async (c) => {
    let positionId = opts.positionId ?? null;
    let name = opts.name?.trim() ?? '';

    if (!positionId) {
      const ins = await c.query<{ id: number; name: string }>(
        'INSERT INTO positions (name) VALUES ($1) RETURNING id, name',
        [name],
      );
      positionId = ins.rows[0].id;
      name = ins.rows[0].name;
    } else {
      const found = await c.query<{ name: string }>('SELECT name FROM positions WHERE id = $1', [
        positionId,
      ]);
      if (found.rows.length === 0) throw new Error('position-not-found');
      name = found.rows[0].name;
    }

    const ord = await c.query<{ next: number }>(
      `SELECT COALESCE(max(display_order), 0) + 1 AS next
       FROM election_positions WHERE election_id = $1`,
      [electionId],
    );
    await c.query(
      `INSERT INTO election_positions (election_id, position_id, display_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (election_id, position_id) DO NOTHING`,
      [electionId, positionId, ord.rows[0].next],
    );
    return { id: positionId!, name };
  });
}

export async function updatePosition(
  electionId: number,
  positionId: number,
  patch: { name?: string; displayOrder?: number },
): Promise<void> {
  await withTx(async (c) => {
    if (patch.name !== undefined) {
      await c.query('UPDATE positions SET name = $1 WHERE id = $2', [patch.name.trim(), positionId]);
    }
    if (patch.displayOrder !== undefined) {
      await c.query(
        'UPDATE election_positions SET display_order = $1 WHERE election_id = $2 AND position_id = $3',
        [patch.displayOrder, electionId, positionId],
      );
    }
  });
}

export async function removePositionFromElection(
  electionId: number,
  positionId: number,
): Promise<'ok' | 'has-votes'> {
  return withTx(async (c) => {
    const votes = await c.query(
      `SELECT 1 FROM votes v
       JOIN candidates ca ON ca.id = v.candidate_id
       WHERE v.election_id = $1 AND ca.position_id = $2
       LIMIT 1`,
      [electionId, positionId],
    );
    if (votes.rows.length > 0) return 'has-votes';

    await c.query(
      'DELETE FROM election_positions WHERE election_id = $1 AND position_id = $2',
      [electionId, positionId],
    );

    // Drop the global position too if nothing else references it and it has no votes anywhere.
    const stillUsed = await c.query(
      'SELECT 1 FROM election_positions WHERE position_id = $1 LIMIT 1',
      [positionId],
    );
    const anyVotes = await c.query(
      `SELECT 1 FROM votes v JOIN candidates ca ON ca.id = v.candidate_id
       WHERE ca.position_id = $1 LIMIT 1`,
      [positionId],
    );
    if (stillUsed.rows.length === 0 && anyVotes.rows.length === 0) {
      await c.query('DELETE FROM positions WHERE id = $1', [positionId]);
    }
    return 'ok';
  });
}

export async function positionInElection(
  electionId: number,
  positionId: number,
): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT 1 FROM election_positions WHERE election_id = $1 AND position_id = $2',
    [electionId, positionId],
  );
  return rows.length > 0;
}

export async function addCandidate(
  positionId: number,
  name: string,
): Promise<{ id: number; name: string }> {
  const { rows } = await pool.query<{ id: number; name: string }>(
    `INSERT INTO candidates (position_id, name, display_order)
     VALUES ($1, $2, (SELECT COALESCE(max(display_order), 0) + 1 FROM candidates WHERE position_id = $1))
     RETURNING id, name`,
    [positionId, name.trim()],
  );
  return rows[0];
}

export async function updateCandidate(
  candidateId: number,
  patch: { name?: string; displayOrder?: number },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(patch.name.trim());
  }
  if (patch.displayOrder !== undefined) {
    sets.push(`display_order = $${i++}`);
    values.push(patch.displayOrder);
  }
  if (sets.length === 0) return;
  values.push(candidateId);
  await pool.query(`UPDATE candidates SET ${sets.join(', ')} WHERE id = $${i}`, values);
}

export async function deleteCandidate(candidateId: number): Promise<'ok' | 'has-votes'> {
  const votes = await pool.query('SELECT 1 FROM votes WHERE candidate_id = $1 LIMIT 1', [
    candidateId,
  ]);
  if (votes.rows.length > 0) return 'has-votes';
  await pool.query('DELETE FROM candidates WHERE id = $1', [candidateId]);
  return 'ok';
}

export async function candidatePositionInElection(
  electionId: number,
  candidateId: number,
): Promise<number | null> {
  const { rows } = await pool.query<{ position_id: number }>(
    `SELECT c.position_id
     FROM candidates c
     JOIN election_positions ep ON ep.position_id = c.position_id AND ep.election_id = $1
     WHERE c.id = $2`,
    [electionId, candidateId],
  );
  return rows[0]?.position_id ?? null;
}

// ---------------------------------------------------------------------------
// Voter registry
// ---------------------------------------------------------------------------

export async function listVoters(opts: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Voter[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const search = opts.search?.trim();

  const where = search ? 'WHERE matric_number ILIKE $1 OR name ILIKE $1' : '';
  const params: unknown[] = search ? [`%${search}%`] : [];

  const totalRes = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM voters ${where}`,
    params,
  );
  const { rows } = await pool.query<Voter>(
    `SELECT id, matric_number, name, created_at FROM voters ${where}
     ORDER BY name LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { items: rows, total: Number(totalRes.rows[0].count) };
}

export async function createVoter(matricNumber: string, name: string): Promise<Voter> {
  const { rows } = await pool.query<Voter>(
    `INSERT INTO voters (matric_number, name) VALUES ($1, $2)
     RETURNING id, matric_number, name, created_at`,
    [normalizeMatric(matricNumber), name.trim()],
  );
  return rows[0];
}

export async function updateVoter(
  id: number,
  patch: { matricNumber?: string; name?: string },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (patch.matricNumber !== undefined) {
    sets.push(`matric_number = $${i++}`);
    values.push(normalizeMatric(patch.matricNumber));
  }
  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(patch.name.trim());
  }
  if (sets.length === 0) return;
  values.push(id);
  await pool.query(`UPDATE voters SET ${sets.join(', ')} WHERE id = $${i}`, values);
}

export async function deleteVoter(id: number): Promise<'ok' | 'has-voted'> {
  const voted = await pool.query(
    'SELECT 1 FROM election_voters WHERE voter_id = $1 AND has_voted = true LIMIT 1',
    [id],
  );
  if (voted.rows.length > 0) return 'has-voted';
  await pool.query('DELETE FROM voters WHERE id = $1', [id]);
  return 'ok';
}

export async function findVoterByMatric(matricNumber: string): Promise<Voter | null> {
  const { rows } = await pool.query<Voter>(
    `SELECT id, matric_number, name, created_at FROM voters WHERE matric_number = $1`,
    [normalizeMatric(matricNumber)],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Election eligibility (election_voters)
// ---------------------------------------------------------------------------

export type ElectionVoterRow = {
  voter_id: number;
  matric_number: string;
  name: string;
  has_voted: boolean;
  voted_at: Date | null;
};

export async function listElectionVoters(
  electionId: number,
  opts: { search?: string; limit?: number; offset?: number } = {},
): Promise<{
  rows: ElectionVoterRow[];
  matched: number;
  eligible: number;
  voted: number;
}> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [electionId];
  let filter = '';
  if (opts.search && opts.search.trim()) {
    params.push(`%${opts.search.trim()}%`);
    filter = ` AND (v.matric_number ILIKE $2 OR v.name ILIKE $2)`;
  }
  const { rows } = await pool.query<ElectionVoterRow>(
    `SELECT v.id AS voter_id, v.matric_number, v.name, ev.has_voted, ev.voted_at
     FROM election_voters ev
     JOIN voters v ON v.id = ev.voter_id
     WHERE ev.election_id = $1${filter}
     ORDER BY v.name
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const matchedRes = await pool.query<{ count: string }>(
    `SELECT count(*) AS count
     FROM election_voters ev JOIN voters v ON v.id = ev.voter_id
     WHERE ev.election_id = $1${filter}`,
    params,
  );
  const totals = await pool.query<{ eligible: string; voted: string }>(
    `SELECT count(*) AS eligible, count(*) FILTER (WHERE has_voted) AS voted
     FROM election_voters WHERE election_id = $1`,
    [electionId],
  );
  return {
    rows,
    matched: Number(matchedRes.rows[0].count),
    eligible: Number(totals.rows[0].eligible),
    voted: Number(totals.rows[0].voted),
  };
}

/** Add eligible voters by voter id and/or by "matric,name" CSV rows. Returns count added. */
export async function addElectionVoters(
  electionId: number,
  opts: { voterIds?: number[]; csvRows?: { matricNumber: string; name?: string }[] },
): Promise<{ added: number; createdVoters: number }> {
  return withTx(async (c) => {
    const voterIds = new Set<number>(opts.voterIds ?? []);
    let createdVoters = 0;

    for (const row of opts.csvRows ?? []) {
      const matric = normalizeMatric(row.matricNumber);
      if (!matric) continue;
      const existing = await c.query<{ id: number }>(
        'SELECT id FROM voters WHERE matric_number = $1',
        [matric],
      );
      if (existing.rows.length > 0) {
        voterIds.add(existing.rows[0].id);
      } else if (row.name && row.name.trim()) {
        const created = await c.query<{ id: number }>(
          'INSERT INTO voters (matric_number, name) VALUES ($1, $2) RETURNING id',
          [matric, row.name.trim()],
        );
        voterIds.add(created.rows[0].id);
        createdVoters++;
      }
    }

    let added = 0;
    for (const vid of voterIds) {
      const res = await c.query(
        `INSERT INTO election_voters (election_id, voter_id) VALUES ($1, $2)
         ON CONFLICT (election_id, voter_id) DO NOTHING`,
        [electionId, vid],
      );
      added += res.rowCount ?? 0;
    }
    return { added, createdVoters };
  });
}

export async function removeElectionVoter(
  electionId: number,
  voterId: number,
): Promise<'ok' | 'has-voted'> {
  const voted = await pool.query(
    'SELECT has_voted FROM election_voters WHERE election_id = $1 AND voter_id = $2',
    [electionId, voterId],
  );
  if (voted.rows[0]?.has_voted) return 'has-voted';
  await pool.query('DELETE FROM election_voters WHERE election_id = $1 AND voter_id = $2', [
    electionId,
    voterId,
  ]);
  return 'ok';
}

export async function getParticipation(
  electionId: number,
  voterId: number,
): Promise<{ has_voted: boolean } | null> {
  const { rows } = await pool.query<{ has_voted: boolean }>(
    'SELECT has_voted FROM election_voters WHERE election_id = $1 AND voter_id = $2',
    [electionId, voterId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Results & turnout
// ---------------------------------------------------------------------------

export async function getTurnout(electionId: number): Promise<Turnout> {
  const { rows } = await pool.query<{ voted: string; total: string }>(
    `SELECT count(*) FILTER (WHERE has_voted) AS voted, count(*) AS total
     FROM election_voters WHERE election_id = $1`,
    [electionId],
  );
  return { voted: Number(rows[0].voted), total: Number(rows[0].total) };
}

export async function getResults(
  electionId: number,
  participation: { search?: string; limit?: number; offset?: number } = {},
): Promise<{
  positions: ResultsPosition[];
  turnout: Turnout;
  voters: { id: number; matric_number: string; name: string; voted: boolean }[];
  participationTotal: number;
}> {
  const { rows } = await pool.query<{
    position_id: number;
    position_name: string;
    candidate_id: number | null;
    candidate_name: string | null;
    votes: string;
  }>(
    `SELECT p.id AS position_id, p.name AS position_name,
            c.id AS candidate_id, c.name AS candidate_name,
            count(v.id) AS votes
     FROM election_positions ep
     JOIN positions p ON p.id = ep.position_id
     LEFT JOIN candidates c ON c.position_id = p.id
     LEFT JOIN votes v ON v.candidate_id = c.id AND v.election_id = ep.election_id
     WHERE ep.election_id = $1
     GROUP BY ep.display_order, p.id, p.name, c.id, c.name, c.display_order
     ORDER BY ep.display_order, p.id, c.display_order, c.id`,
    [electionId],
  );

  const byId = new Map<number, ResultsPosition>();
  for (const r of rows) {
    let pos = byId.get(r.position_id);
    if (!pos) {
      pos = { id: r.position_id, name: r.position_name, candidates: [] };
      byId.set(r.position_id, pos);
    }
    if (r.candidate_id != null) {
      pos.candidates.push({ id: r.candidate_id, name: r.candidate_name!, votes: Number(r.votes) });
    }
  }

  const turnout = await getTurnout(electionId);

  const limit = Math.min(Math.max(participation.limit ?? 50, 1), 200);
  const offset = Math.max(participation.offset ?? 0, 0);
  const params: unknown[] = [electionId];
  let filter = '';
  if (participation.search && participation.search.trim()) {
    params.push(`%${participation.search.trim()}%`);
    filter = ' AND (v.matric_number ILIKE $2 OR v.name ILIKE $2)';
  }
  const { rows: voterRows } = await pool.query<{
    id: number;
    matric_number: string;
    name: string;
    has_voted: boolean;
  }>(
    `SELECT v.id, v.matric_number, v.name, ev.has_voted
     FROM election_voters ev JOIN voters v ON v.id = ev.voter_id
     WHERE ev.election_id = $1${filter}
     ORDER BY v.name
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const totalRes = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM election_voters ev JOIN voters v ON v.id = ev.voter_id
     WHERE ev.election_id = $1${filter}`,
    params,
  );

  return {
    positions: [...byId.values()],
    turnout,
    participationTotal: Number(totalRes.rows[0].count),
    voters: voterRows.map((v) => ({
      id: v.id,
      matric_number: v.matric_number,
      name: v.name,
      voted: v.has_voted,
    })),
  };
}

// ---------------------------------------------------------------------------
// Vote submission
//
// One transaction, one pooled connection. Steps, in order:
//   1. Re-check the election is open using the DATABASE clock.
//   2. Claim the idempotency key (INSERT ... ON CONFLICT DO NOTHING). A replay
//      of the same submission short-circuits here as "duplicate".
//   3. Atomically claim the voter's one opportunity
//      (UPDATE ... WHERE has_voted = false). Row lock => concurrent claims
//      serialize; only one wins.
//   4. Validate the full ballot against the authoritative DB config.
//   5. Insert one votes row per selection (a BEFORE INSERT trigger re-checks
//      that each candidate is on this election's ballot).
//   6. Enqueue the "vote recorded" email into the outbox (aggregate counts
//      only - no identity, no choice).
//
// Any business rejection throws RollbackSignal, so nothing (not even the
// idempotency key) persists and the voter can retry. No external HTTP call
// happens inside the transaction. Email is sent AFTER commit, best-effort.
//
// Identity (voterId) and choice (candidateIds) are both in scope in this
// function but are written to DIFFERENT tables: election_voters gets has_voted,
// votes gets candidate_id. There is no row anywhere holding both.
// ---------------------------------------------------------------------------

export type CastBallotResult =
  | { outcome: 'recorded'; turnout: Turnout }
  | { outcome: 'duplicate' }
  | { outcome: 'already-voted' }
  | { outcome: 'not-open' }
  | { outcome: 'invalid-ballot' };

export async function castBallot(input: {
  electionId: number;
  voterId: number;
  idempotencyKey: string;
  selections: { positionId: number; candidateId: number }[];
}): Promise<CastBallotResult> {
  try {
    return await withTx<CastBallotResult>(
      async (c) => {
        const el = await c.query<{ is_open: boolean }>(
          `SELECT (status = 'open'
                   AND voting_start IS NOT NULL AND voting_end IS NOT NULL
                   AND now() >= voting_start AND now() < voting_end) AS is_open
           FROM elections WHERE id = $1`,
          [input.electionId],
        );
        if (el.rows.length === 0 || !el.rows[0].is_open) {
          throw new RollbackSignal('not-open');
        }

        const idem = await c.query(
          `INSERT INTO vote_idempotency (key, election_id) VALUES ($1, $2)
           ON CONFLICT (key) DO NOTHING RETURNING key`,
          [input.idempotencyKey, input.electionId],
        );
        if (idem.rows.length === 0) {
          // Same submission already processed (double-click, retry, lost response).
          return { outcome: 'duplicate' };
        }

        const claim = await c.query<{ voter_id: number }>(
          `UPDATE election_voters
           SET has_voted = true, voted_at = now()
           WHERE election_id = $1 AND voter_id = $2 AND has_voted = false
           RETURNING voter_id`,
          [input.electionId, input.voterId],
        );
        if (claim.rows.length === 0) throw new RollbackSignal('already-voted');

        const ballotRows = await c.query<{ position_id: number; candidate_id: number | null }>(
          `SELECT ep.position_id, cand.id AS candidate_id
           FROM election_positions ep
           LEFT JOIN candidates cand ON cand.position_id = ep.position_id
           WHERE ep.election_id = $1`,
          [input.electionId],
        );
        const shape: BallotShape = [];
        const byPos = new Map<number, number[]>();
        for (const r of ballotRows.rows) {
          if (!byPos.has(r.position_id)) byPos.set(r.position_id, []);
          if (r.candidate_id != null) byPos.get(r.position_id)!.push(r.candidate_id);
        }
        for (const [positionId, candidateIds] of byPos) shape.push({ positionId, candidateIds });

        const validation = validateSelections(shape, input.selections);
        if (!validation.ok) throw new RollbackSignal('invalid-ballot');

        // Randomise insert order so row id / created_at can't hint at ballot shape.
        const shuffled = [...validation.candidateIds].sort(() => Math.random() - 0.5);
        for (const candidateId of shuffled) {
          await c.query('INSERT INTO votes (election_id, candidate_id) VALUES ($1, $2)', [
            input.electionId,
            candidateId,
          ]);
        }

        const turnoutRow = await c.query<{ voted: string; total: string }>(
          `SELECT count(*) FILTER (WHERE has_voted) AS voted, count(*) AS total
           FROM election_voters WHERE election_id = $1`,
          [input.electionId],
        );
        const turnout: Turnout = {
          voted: Number(turnoutRow.rows[0].voted),
          total: Number(turnoutRow.rows[0].total),
        };

        await c.query(
          `INSERT INTO email_outbox (kind, election_id, payload)
           VALUES ('vote_recorded', $1, $2)`,
          [input.electionId, JSON.stringify({ voted: turnout.voted, total: turnout.total })],
        );

        return { outcome: 'recorded', turnout };
      },
      { isolation: 'read committed', retries: 3 },
    );
  } catch (err) {
    if (err instanceof RollbackSignal) {
      switch (err.reason) {
        case 'not-open':
          return { outcome: 'not-open' };
        case 'already-voted':
          return { outcome: 'already-voted' };
        case 'invalid-ballot':
          return { outcome: 'invalid-ballot' };
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Ballot-edit locking
// ---------------------------------------------------------------------------

/**
 * A ballot may only be edited (positions/candidates added, renamed, removed)
 * while the election is still draft or scheduled AND no votes exist. Once
 * voting has produced any vote, the ballot is frozen so recorded votes keep
 * their meaning; the admin must clone the election instead.
 */
export async function ballotEditable(
  electionId: number,
): Promise<{ editable: true } | { editable: false; reason: 'has-votes' | 'not-editable-status' }> {
  const el = await getElection(electionId);
  if (!el) return { editable: false, reason: 'not-editable-status' };
  if (el.status !== 'draft' && el.status !== 'scheduled') {
    return { editable: false, reason: 'not-editable-status' };
  }
  if (await electionHasVotes(electionId)) return { editable: false, reason: 'has-votes' };
  return { editable: true };
}

// ---------------------------------------------------------------------------
// Email outbox
// ---------------------------------------------------------------------------

export type OutboxRow = {
  id: number;
  kind: 'vote_recorded' | 'final_results';
  election_id: number;
  payload: Record<string, unknown>;
  attempts: number;
};

export async function enqueueEmail(
  kind: OutboxRow['kind'],
  electionId: number,
  payload: Record<string, unknown>,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO email_outbox (kind, election_id, payload) VALUES ($1, $2, $3) RETURNING id`,
    [kind, electionId, JSON.stringify(payload)],
  );
  return rows[0].id;
}

export async function claimPendingEmails(limit = 20): Promise<OutboxRow[]> {
  // SKIP LOCKED lets multiple workers/instances drain the outbox without collisions.
  const { rows } = await pool.query<OutboxRow>(
    `UPDATE email_outbox SET attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM email_outbox
       WHERE status = 'pending'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     RETURNING id, kind, election_id, payload, attempts`,
    [limit],
  );
  return rows;
}

export async function markEmailSent(id: number): Promise<void> {
  await pool.query(
    `UPDATE email_outbox SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1`,
    [id],
  );
}

export async function markEmailFailed(id: number, error: string, maxAttempts = 5): Promise<void> {
  await pool.query(
    `UPDATE email_outbox
     SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
         last_error = $3
     WHERE id = $1`,
    [id, maxAttempts, error.slice(0, 500)],
  );
}

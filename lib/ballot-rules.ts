export type BallotShape = { positionId: number; candidateIds: number[] }[];
export type Selection = { positionId: number; candidateId: number };

export type BallotValidation =
  | { ok: true; candidateIds: number[] }
  | { ok: false; reason: 'missing-position' | 'extra-position' | 'duplicate-position' | 'bad-candidate' };

/**
 * Pure validation of a submitted set of selections against the authoritative
 * ballot shape (positions on the election with their valid candidate ids).
 *
 * Rules: every ballot position must have exactly one selection; no unknown
 * positions; no duplicate positions; each candidate must belong to its position.
 */
export function validateSelections(ballot: BallotShape, selections: Selection[]): BallotValidation {
  const valid = new Map<number, Set<number>>();
  for (const p of ballot) valid.set(p.positionId, new Set(p.candidateIds));

  const seen = new Set<number>();
  const candidateIds: number[] = [];

  for (const sel of selections) {
    if (!Number.isInteger(sel.positionId) || !Number.isInteger(sel.candidateId)) {
      return { ok: false, reason: 'bad-candidate' };
    }
    if (seen.has(sel.positionId)) return { ok: false, reason: 'duplicate-position' };
    const allowed = valid.get(sel.positionId);
    if (!allowed) return { ok: false, reason: 'extra-position' };
    if (!allowed.has(sel.candidateId)) return { ok: false, reason: 'bad-candidate' };
    seen.add(sel.positionId);
    candidateIds.push(sel.candidateId);
  }

  if (seen.size !== valid.size) return { ok: false, reason: 'missing-position' };
  return { ok: true, candidateIds };
}

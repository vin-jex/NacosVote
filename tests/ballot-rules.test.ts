import { describe, expect, it } from 'vitest';
import { validateSelections, type BallotShape } from '../lib/ballot-rules';

const ballot: BallotShape = [
  { positionId: 1, candidateIds: [10, 11] },
  { positionId: 2, candidateIds: [20, 21, 22] },
];

describe('validateSelections', () => {
  it('accepts exactly one valid choice per position', () => {
    const r = validateSelections(ballot, [
      { positionId: 1, candidateId: 11 },
      { positionId: 2, candidateId: 20 },
    ]);
    expect(r).toEqual({ ok: true, candidateIds: [11, 20] });
  });

  it('rejects a missing position', () => {
    const r = validateSelections(ballot, [{ positionId: 1, candidateId: 10 }]);
    expect(r).toEqual({ ok: false, reason: 'missing-position' });
  });

  it('rejects an unknown / foreign position', () => {
    const r = validateSelections(ballot, [
      { positionId: 1, candidateId: 10 },
      { positionId: 2, candidateId: 20 },
      { positionId: 99, candidateId: 1 },
    ]);
    expect(r).toEqual({ ok: false, reason: 'extra-position' });
  });

  it('rejects two selections for the same position', () => {
    const r = validateSelections(ballot, [
      { positionId: 1, candidateId: 10 },
      { positionId: 1, candidateId: 11 },
      { positionId: 2, candidateId: 20 },
    ]);
    expect(r).toEqual({ ok: false, reason: 'duplicate-position' });
  });

  it('rejects a candidate that belongs to another position', () => {
    const r = validateSelections(ballot, [
      { positionId: 1, candidateId: 20 },
      { positionId: 2, candidateId: 21 },
    ]);
    expect(r).toEqual({ ok: false, reason: 'bad-candidate' });
  });

  it('rejects a candidate id that is not on the ballot at all', () => {
    const r = validateSelections(ballot, [
      { positionId: 1, candidateId: 10 },
      { positionId: 2, candidateId: 999 },
    ]);
    expect(r).toEqual({ ok: false, reason: 'bad-candidate' });
  });
});

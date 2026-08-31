export type ElectionStatus = 'draft' | 'scheduled' | 'open' | 'closed';

export type ElectionTiming = {
  status: ElectionStatus;
  voting_start: Date | string | null;
  voting_end: Date | string | null;
};

/**
 * Status shown in the UI / used for the open decision on the READ path. The
 * stored `status` is admin intent; this folds in the server clock. Boundary
 * semantics: voting_start <= now < voting_end (closed exactly at voting_end).
 *
 * NOTE: the authoritative open/closed check on the WRITE path (verify/submit) is
 * done in SQL with the database clock — see getElectionForVoting / castBallot.
 * This helper is for display and must not be the sole gate on a mutation.
 */
export function effectiveStatus(e: ElectionTiming, now: Date = new Date()): ElectionStatus {
  if (e.status === 'draft' || e.status === 'closed' || e.status === 'scheduled') return e.status;
  if (!e.voting_start || !e.voting_end) return 'scheduled';
  const start = new Date(e.voting_start);
  const end = new Date(e.voting_end);
  if (now < start) return 'scheduled';
  if (now >= end) return 'closed';
  return 'open';
}

export function isVotingOpen(e: ElectionTiming, now: Date = new Date()): boolean {
  return effectiveStatus(e, now) === 'open';
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const ALLOWED: Record<ElectionStatus, ElectionStatus[]> = {
  draft: ['scheduled', 'open'],
  scheduled: ['draft', 'open', 'closed'],
  open: ['closed'],
  // Terminal. Reopening after votes exist is never allowed; even with no votes
  // a closed election should be cloned rather than reopened.
  closed: [],
};

export function canTransition(from: ElectionStatus, to: ElectionStatus): boolean {
  if (from === to) return true;
  return ALLOWED[from].includes(to);
}

export function transitionError(from: ElectionStatus, to: ElectionStatus): string {
  return `Cannot change status from "${from}" to "${to}".`;
}

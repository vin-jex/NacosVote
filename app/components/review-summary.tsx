type Review = { confirmedValid: number; invalidated: number; unreviewed: number };

/**
 * Post-vote review breakdown for open-mode elections that were reconciled
 * against an organiser confirmation list. Renders nothing when no review has
 * happened. The counts describe PARTICIPANTS, not candidate totals: the ballot
 * is secret, so a confirmed/invalid split cannot be applied per candidate.
 */
export function ReviewSummary({ review, ballots }: { review: Review; ballots: number }) {
  if (review.confirmedValid + review.invalidated === 0) return null;
  return (
    <div className="mt-4 rounded border border-line p-4 text-sm">
      <p className="kicker">Post-vote review</p>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 tabular-nums">
        <span>{ballots} ballots cast</span>
        <span className="font-semibold text-accent">{review.confirmedValid} confirmed valid</span>
        <span className="font-semibold text-danger">{review.invalidated} flagged invalid</span>
        <span className="text-ink/60">{review.unreviewed} unreviewed</span>
      </div>
      <p className="field-hint mt-2">
        Organisers reconciled the ballots against a confirmation list of people who reported voting.
        The ballot is secret, so this cannot be split by candidate. The counts below are the raw
        tally of all {ballots} ballots.
      </p>
    </div>
  );
}

-- Migration 010: optional ATTRIBUTABLE ballot mode.
--
-- Default elections are secret: the votes table holds only (election, candidate)
-- and nothing links a ballot to a person. When elections.ballot_attributable is
-- true, that election's ballots are written to attributed_votes WITH the
-- voter_id, so organisers can audit each ballot and invalidate specific ones
-- (e.g. a voter not on a confirmation list). Such an election is NOT a secret
-- ballot: any admin can see how each named voter voted.
--
--   pnpm tsx scripts/db-push.ts db/migrations/010_attributable_ballot.sql

ALTER TABLE elections
  ADD COLUMN IF NOT EXISTS ballot_attributable boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS attributed_votes (
  id            bigserial PRIMARY KEY,
  election_id   bigint NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  voter_id      bigint NOT NULL REFERENCES voters(id) ON DELETE CASCADE,
  position_id   bigint NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  candidate_id  bigint NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  invalidated   boolean NOT NULL DEFAULT false,
  invalid_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, voter_id, position_id)
);

CREATE INDEX IF NOT EXISTS attributed_votes_tally_idx
  ON attributed_votes (election_id, candidate_id) WHERE NOT invalidated;
CREATE INDEX IF NOT EXISTS attributed_votes_voter_idx
  ON attributed_votes (election_id, voter_id);

-- Reuse the same on-ballot check the votes table uses.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'attributed_votes_candidate_on_ballot') THEN
    CREATE TRIGGER attributed_votes_candidate_on_ballot
      BEFORE INSERT ON attributed_votes
      FOR EACH ROW EXECUTE FUNCTION assert_candidate_on_ballot();
  END IF;
END $$;

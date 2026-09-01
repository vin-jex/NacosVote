-- Migration 009: declared choices, and a confirmed-valid marker on the
-- confirmation list itself.
--
-- For an open-mode election reconciled against a confirmation list, organisers
-- can also collect *who each confirmed person says they voted for*. The OFFICIAL
-- tally counts declarations from confirmation entries marked confirmed_valid
-- only. The anonymous votes table stays as an audit reference.
--
--   pnpm tsx scripts/db-push.ts db/migrations/009_vote_declarations.sql

ALTER TABLE vote_confirmations
  ADD COLUMN IF NOT EXISTS confirmed_valid boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS vote_declarations (
  id              bigserial PRIMARY KEY,
  election_id     bigint NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  confirmation_id bigint NOT NULL REFERENCES vote_confirmations(id) ON DELETE CASCADE,
  position_id     bigint NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  candidate_id    bigint NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (confirmation_id, position_id)
);

CREATE INDEX IF NOT EXISTS vote_declarations_election_idx ON vote_declarations (election_id);

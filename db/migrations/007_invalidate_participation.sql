-- Migration 007: let organisers flag a participant's ballot as invalid after
-- the fact (e.g. an open-mode voter who is not on the confirmation list).
--
-- IMPORTANT: this flags the PARTICIPANT, not a votes row. Because the ballot is
-- secret there is no link from a person to a candidate, so flagging a
-- participant invalid adjusts turnout / valid-count reporting but CANNOT
-- subtract that ballot from an individual candidate's total.
--
--   pnpm tsx scripts/db-push.ts db/migrations/007_invalidate_participation.sql

ALTER TABLE election_voters ADD COLUMN IF NOT EXISTS invalidated boolean NOT NULL DEFAULT false;
ALTER TABLE election_voters ADD COLUMN IF NOT EXISTS invalid_reason text;
ALTER TABLE election_voters ADD COLUMN IF NOT EXISTS invalidated_at timestamptz;

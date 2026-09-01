-- Migration 008: positive "this participant has been confirmed valid" marker,
-- set from the confirmation list. Separate from `invalidated` so a participant
-- can be: unreviewed (neither), confirmed valid, or flagged invalid.
--
--   pnpm tsx scripts/db-push.ts db/migrations/008_confirm_valid.sql

ALTER TABLE election_voters ADD COLUMN IF NOT EXISTS confirmed_valid boolean NOT NULL DEFAULT false;
ALTER TABLE election_voters ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

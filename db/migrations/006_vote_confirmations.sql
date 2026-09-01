-- Migration 006: post-vote confirmation list.
--
-- Some elections run in "open" mode and the organisers separately collect
-- name + reg number from people who say they voted. This table holds that
-- list for reconciliation. It stores the SAME class of data already in
-- election_voters (who participated) and never references a votes row, so it
-- does not weaken ballot secrecy. It is advisory: it cannot remove a ballot.
--
--   pnpm tsx scripts/db-push.ts db/migrations/006_vote_confirmations.sql

CREATE TABLE IF NOT EXISTS vote_confirmations (
  id            bigserial PRIMARY KEY,
  election_id   bigint NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  name          text NOT NULL,
  matric_number text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vote_confirmations_matric_uq
  ON vote_confirmations (election_id, matric_number)
  WHERE matric_number IS NOT NULL;

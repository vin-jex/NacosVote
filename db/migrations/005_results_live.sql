-- Migration 005: allow public results to also show DURING an open election
-- (results_public = when-closed; + results_live = also-while-open).
--   pnpm tsx scripts/db-push.ts db/migrations/005_results_live.sql

ALTER TABLE elections ADD COLUMN IF NOT EXISTS results_live boolean NOT NULL DEFAULT false;

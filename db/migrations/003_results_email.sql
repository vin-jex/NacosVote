-- Migration 003: track whether the final-results email has been sent for an
-- election, so automatic sending on close happens exactly once.
--   pnpm tsx scripts/db-push.ts db/migrations/003_results_email.sql

ALTER TABLE elections ADD COLUMN IF NOT EXISTS results_emailed_at timestamptz;

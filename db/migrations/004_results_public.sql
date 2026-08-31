-- Migration 004: per-election toggle for publishing aggregate results on the
-- public /results/<id> page. Off by default; an admin turns it on (or back off)
-- from the election's Settings tab.
--   pnpm tsx scripts/db-push.ts db/migrations/004_results_public.sql

ALTER TABLE elections ADD COLUMN IF NOT EXISTS results_public boolean NOT NULL DEFAULT false;

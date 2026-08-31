-- Migration 002: per-election eligibility mode + optional ballot cap.
--   pnpm tsx scripts/db-push.ts db/migrations/002_eligibility_mode.sql

ALTER TABLE elections
  ADD COLUMN IF NOT EXISTS eligibility_mode text NOT NULL DEFAULT 'restricted';

ALTER TABLE elections
  ADD COLUMN IF NOT EXISTS max_voters integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'elections_eligibility_mode_check'
  ) THEN
    ALTER TABLE elections
      ADD CONSTRAINT elections_eligibility_mode_check
      CHECK (eligibility_mode IN ('restricted', 'open'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'elections_max_voters_check'
  ) THEN
    ALTER TABLE elections
      ADD CONSTRAINT elections_max_voters_check
      CHECK (max_voters IS NULL OR max_voters > 0);
  END IF;
END $$;

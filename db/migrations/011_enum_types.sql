-- Migration 011: replace ad-hoc text/boolean value domains with native ENUM types.
--   pnpm tsx scripts/db-push.ts db/migrations/011_enum_types.sql
--
-- election_status, eligibility_mode and the email_outbox kind/status columns
-- move from text + CHECK to real enums. ballot_attributable (boolean) becomes
-- ballot_mode, and the results_public/results_live boolean pair collapses into
-- a single results_visibility enum.

BEGIN;

-- 1. election_status --------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'election_status') THEN
    CREATE TYPE election_status AS ENUM ('draft', 'scheduled', 'open', 'closed');
  END IF;
END $$;

ALTER TABLE elections DROP CONSTRAINT IF EXISTS elections_status_check;
ALTER TABLE elections DROP CONSTRAINT IF EXISTS elections_window_required_when_live;
ALTER TABLE elections ALTER COLUMN status DROP DEFAULT;
ALTER TABLE elections
  ALTER COLUMN status TYPE election_status USING status::election_status;
ALTER TABLE elections ALTER COLUMN status SET DEFAULT 'draft';
ALTER TABLE elections
  ADD CONSTRAINT elections_window_required_when_live CHECK (
    status IN ('draft', 'closed')
    OR (voting_start IS NOT NULL AND voting_end IS NOT NULL)
  );

-- 2. eligibility_mode -----------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'eligibility_mode') THEN
    CREATE TYPE eligibility_mode AS ENUM ('restricted', 'open');
  END IF;
END $$;

ALTER TABLE elections DROP CONSTRAINT IF EXISTS elections_eligibility_mode_check;
ALTER TABLE elections ALTER COLUMN eligibility_mode DROP DEFAULT;
ALTER TABLE elections
  ALTER COLUMN eligibility_mode TYPE eligibility_mode USING eligibility_mode::eligibility_mode;
ALTER TABLE elections ALTER COLUMN eligibility_mode SET DEFAULT 'restricted';

-- 3. ballot_mode (replaces the ballot_attributable boolean) --------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ballot_mode') THEN
    CREATE TYPE ballot_mode AS ENUM ('secret', 'attributable');
  END IF;
END $$;

ALTER TABLE elections ADD COLUMN IF NOT EXISTS ballot_mode ballot_mode NOT NULL DEFAULT 'secret';
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'elections' AND column_name = 'ballot_attributable'
  ) THEN
    UPDATE elections
       SET ballot_mode = CASE WHEN ballot_attributable THEN 'attributable'::ballot_mode
                              ELSE 'secret'::ballot_mode END;
    ALTER TABLE elections DROP COLUMN ballot_attributable;
  END IF;
END $$;

-- 4. results_visibility (replaces results_public + results_live) ---------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'results_visibility') THEN
    CREATE TYPE results_visibility AS ENUM ('private', 'on_close', 'live');
  END IF;
END $$;

ALTER TABLE elections
  ADD COLUMN IF NOT EXISTS results_visibility results_visibility NOT NULL DEFAULT 'private';
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'elections' AND column_name = 'results_public'
  ) THEN
    UPDATE elections
       SET results_visibility = CASE
             WHEN results_live   THEN 'live'::results_visibility
             WHEN results_public THEN 'on_close'::results_visibility
             ELSE 'private'::results_visibility END;
    ALTER TABLE elections DROP COLUMN results_public;
    ALTER TABLE elections DROP COLUMN results_live;
  END IF;
END $$;

-- 5. email_outbox kind + status ----------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_kind') THEN
    CREATE TYPE email_kind AS ENUM ('vote_recorded', 'final_results');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'email_status') THEN
    CREATE TYPE email_status AS ENUM ('pending', 'sent', 'failed');
  END IF;
END $$;

-- The partial index predicate (status = 'pending') is stored against the old
-- text type; drop it before the type change and rebuild it after.
DROP INDEX IF EXISTS email_outbox_pending_idx;
ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_kind_check;
ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_status_check;
ALTER TABLE email_outbox ALTER COLUMN status DROP DEFAULT;
ALTER TABLE email_outbox ALTER COLUMN kind TYPE email_kind USING kind::email_kind;
ALTER TABLE email_outbox ALTER COLUMN status TYPE email_status USING status::email_status;
ALTER TABLE email_outbox ALTER COLUMN status SET DEFAULT 'pending';
CREATE INDEX email_outbox_pending_idx ON email_outbox (created_at) WHERE status = 'pending';

COMMIT;

-- Migration 001: admin credentials table.
-- Apply to a database created before the admins table existed:
--   psql "$DATABASE_URL" -f db/migrations/001_add_admins.sql
--   (or)  pnpm tsx scripts/db-push.ts db/migrations/001_add_admins.sql

CREATE TABLE IF NOT EXISTS admins (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admins_email_lowercase CHECK (email = lower(email))
);

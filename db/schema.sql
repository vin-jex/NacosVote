-- NacosVote schema. Apply once against an empty database:
--   psql "$DATABASE_URL" -f db/schema.sql
--   (or: pnpm tsx scripts/db-push.ts)
--
-- Future changes should be added as numbered migration files under db/migrations/
-- and applied in order; this file is the consolidated baseline.
--
-- SECRET-BALLOT INVARIANT
--   The votes table carries ONLY (election_id, candidate_id, created_at). No
--   column, foreign key, trigger, index, or companion table (vote_idempotency,
--   email_outbox, admin_audit_log) links a vote row to a voter, an
--   election_voters row, an IP, an email, or any other identifying value.

-- ---------------------------------------------------------------------------
-- Enum types (value domains)
-- ---------------------------------------------------------------------------

CREATE TYPE election_status AS ENUM ('draft', 'scheduled', 'open', 'closed');
CREATE TYPE eligibility_mode AS ENUM ('restricted', 'open');
CREATE TYPE ballot_mode AS ENUM ('secret', 'attributable');
CREATE TYPE results_visibility AS ENUM ('private', 'on_close', 'live');
CREATE TYPE email_kind AS ENUM ('vote_recorded', 'final_results');
CREATE TYPE email_status AS ENUM ('pending', 'sent', 'failed');

-- ---------------------------------------------------------------------------
-- Core registry
-- ---------------------------------------------------------------------------

CREATE TABLE voters (
  id            bigserial PRIMARY KEY,
  matric_number text NOT NULL UNIQUE,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voters_matric_not_blank CHECK (length(btrim(matric_number)) > 0),
  CONSTRAINT voters_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE elections (
  id            bigserial PRIMARY KEY,
  title         text NOT NULL CHECK (length(btrim(title)) > 0),
  description   text,
  status        election_status NOT NULL DEFAULT 'draft',
  voting_start  timestamptz,
  voting_end    timestamptz,
  version       integer NOT NULL DEFAULT 1,
  -- 'restricted': only voters on election_voters may vote (admin loads the list).
  -- 'open': anyone who gives a matric number + full name may vote; the identity
  --         is recorded (for later audit) and locked to that matric.
  eligibility_mode eligibility_mode NOT NULL DEFAULT 'restricted',
  -- Optional hard cap on the number of ballots cast (enforced in the vote
  -- transaction under a per-election advisory lock). NULL = no cap.
  max_voters    integer CHECK (max_voters IS NULL OR max_voters > 0),
  -- 'secret': the votes table is unlinkable to any voter (default).
  -- 'attributable': ballots are stored in attributed_votes linked to the voter
  --   so organisers can audit and invalidate individual ballots. Public and
  --   voter-facing results still show totals only.
  ballot_mode   ballot_mode NOT NULL DEFAULT 'secret',
  -- Public results visibility:
  --   'private'  -> only admins
  --   'on_close' -> aggregate tally is public once the election is CLOSED
  --   'live'     -> also public while voting is OPEN
  results_visibility results_visibility NOT NULL DEFAULT 'private',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- end strictly after start (invariant: impossible windows rejected by the DB)
  CONSTRAINT elections_window_valid CHECK (
    voting_start IS NULL OR voting_end IS NULL OR voting_end > voting_start
  ),
  -- a scheduled/open election must have a full window
  CONSTRAINT elections_window_required_when_live CHECK (
    status IN ('draft', 'closed')
    OR (voting_start IS NOT NULL AND voting_end IS NOT NULL)
  )
);

CREATE TABLE positions (
  id   bigserial PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0)
);

CREATE TABLE candidates (
  id            bigserial PRIMARY KEY,
  position_id   bigint NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  display_order integer NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Per-election ballot configuration and eligibility
-- ---------------------------------------------------------------------------

CREATE TABLE election_positions (
  election_id   bigint NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  position_id   bigint NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (election_id, position_id)
);

-- One row per (election, voter). has_voted + voted_at are the authoritative
-- one-vote record and double as the idempotency marker for a committed ballot.
CREATE TABLE election_voters (
  election_id bigint NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  voter_id    bigint NOT NULL REFERENCES voters(id) ON DELETE CASCADE,
  has_voted   boolean NOT NULL DEFAULT false,
  voted_at    timestamptz,
  -- Post-vote review against an organiser confirmation list (open-mode
  -- elections). Advisory: flags the participant, never a ballot, so it adjusts
  -- valid-count reporting but cannot change candidate totals (secret ballot).
  confirmed_valid boolean NOT NULL DEFAULT false,
  confirmed_at    timestamptz,
  invalidated     boolean NOT NULL DEFAULT false,
  invalid_reason  text,
  invalidated_at  timestamptz,
  PRIMARY KEY (election_id, voter_id),
  CONSTRAINT election_voters_voted_at_consistent CHECK (has_voted = (voted_at IS NOT NULL))
);

-- Optional: the "I voted" confirmation list organisers collect out of band for
-- an open-mode election. Same class of data as election_voters (who took part),
-- never linked to a votes row.
CREATE TABLE vote_confirmations (
  id              bigserial PRIMARY KEY,
  election_id     bigint NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  name            text NOT NULL,
  matric_number   text,
  confirmed_valid boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vote_confirmations_matric_uq
  ON vote_confirmations (election_id, matric_number) WHERE matric_number IS NOT NULL;

-- Who each confirmed person says they voted for. Forms the OFFICIAL tally for a
-- confirmation-reconciled open-mode election; the anonymous votes table stays as
-- an audit reference.
CREATE TABLE vote_declarations (
  id              bigserial PRIMARY KEY,
  election_id     bigint NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  confirmation_id bigint NOT NULL REFERENCES vote_confirmations(id) ON DELETE CASCADE,
  position_id     bigint NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  candidate_id    bigint NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (confirmation_id, position_id)
);
CREATE INDEX vote_declarations_election_idx ON vote_declarations (election_id);

-- ---------------------------------------------------------------------------
-- The ballot box
-- ---------------------------------------------------------------------------

CREATE TABLE votes (
  id           bigserial PRIMARY KEY,
  election_id  bigint NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  candidate_id bigint NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- DB-level enforcement of "a vote's candidate is on that election's ballot".
CREATE FUNCTION assert_candidate_on_ballot() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM candidates c
    JOIN election_positions ep
      ON ep.position_id = c.position_id AND ep.election_id = NEW.election_id
    WHERE c.id = NEW.candidate_id
  ) THEN
    RAISE EXCEPTION 'candidate % is not on the ballot for election %',
      NEW.candidate_id, NEW.election_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER votes_candidate_on_ballot
  BEFORE INSERT ON votes
  FOR EACH ROW EXECUTE FUNCTION assert_candidate_on_ballot();

-- ---------------------------------------------------------------------------
-- Idempotency + outbox + audit  (never carry voter identity + choice together)
-- ---------------------------------------------------------------------------

-- Random client-generated key per ballot submission. No voter_id, no
-- candidate_id: it cannot associate a voter with a choice. Written inside the
-- vote transaction so a rollback removes it and the voter can retry.
CREATE TABLE vote_idempotency (
  key         text PRIMARY KEY,
  election_id bigint NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox for admin notification emails. payload holds only
-- aggregate counts and titles.
CREATE TABLE email_outbox (
  id          bigserial PRIMARY KEY,
  kind        email_kind NOT NULL,
  election_id bigint NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  payload     jsonb NOT NULL,
  status      email_status NOT NULL DEFAULT 'pending',
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);

CREATE TABLE admin_audit_log (
  id          bigserial PRIMARY KEY,
  admin_email text NOT NULL,
  action      text NOT NULL,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Admin credentials. Seeded once from the ADMIN_*_EMAIL / ADMIN_*_PASSWORD_HASH
-- env vars (see lib/admins.ts), then owned by the database so an admin can
-- change their own password. Only the bcrypt hash is ever stored.
CREATE TABLE admins (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admins_email_lowercase CHECK (email = lower(email))
);

-- ---------------------------------------------------------------------------
-- Indexes (driven by actual query patterns)
-- ---------------------------------------------------------------------------

-- voters.matric_number is already indexed by its UNIQUE constraint.
CREATE INDEX voters_name_idx              ON voters (lower(name));
CREATE INDEX election_positions_elect_idx ON election_positions (election_id);
CREATE INDEX candidates_position_idx      ON candidates (position_id);
CREATE INDEX election_voters_election_idx ON election_voters (election_id);
CREATE INDEX election_voters_voter_idx    ON election_voters (voter_id);
CREATE INDEX election_voters_open_idx     ON election_voters (election_id) WHERE has_voted = false;
CREATE INDEX votes_election_idx           ON votes (election_id);
CREATE INDEX votes_candidate_idx          ON votes (candidate_id);
CREATE INDEX email_outbox_pending_idx     ON email_outbox (created_at) WHERE status = 'pending';
CREATE INDEX admin_audit_log_created_idx  ON admin_audit_log (created_at DESC);

# NacosVote

Secret-ballot voting for the NACOS (Nigeria Association of Computer Science Students) chapter at
Nnamdi Azikiwe University, Awka. Admins run multiple independent elections over time; each has its
own ballot, its own eligible-voter list, and its own voting window.

## The one guarantee that overrides everything

**A voter's identity is never stored together with their choice, and no join path can reconstruct
the link.**

- `votes` holds only `(id, election_id, candidate_id, created_at)`. No `voter_id`, no matric
  number, no name, no IP, no `election_voters` reference, no session id.
- `election_voters` holds `has_voted` / `voted_at` per `(election, voter)` - participation, never a
  choice.
- `vote_idempotency` holds a random client key + `election_id` + timestamp - no voter, no candidate.
- `email_outbox`, `admin_audit_log`: aggregate counts and admin actions only.
- Votes are inserted in randomised order so row id / `created_at` ordering can't hint at a ballot's
  shape.
- Logs are structured and never carry a voter identifier and a candidate identifier in the same
  event.

`db/schema.sql` is the authority; the layout is enforced by columns and foreign keys, not by
convention.

---

## Stack

Next.js 14 (App Router, mostly Server Components) · TypeScript · pnpm · PostgreSQL on Neon,
accessed with `@neondatabase/serverless` (its `Pool` is a drop-in for `pg.Pool` and speaks the
Postgres protocol over a WebSocket on port 443 - raw parameterised SQL, no ORM, full interactive
transactions) · Redis via ioredis (rate limiting only) · Resend (admin email) · NextAuth
Credentials (admin auth) · Zod (runtime input validation) · Vitest · GitHub Actions CI. Deploy:
Vercel + Neon.

---

## Setup

### 1. Install

```bash
pnpm install
```

### 2. Configure

```bash
cp .env.example .env.local
```

Fill in every value. `NEXTAUTH_SECRET`: `openssl rand -base64 32`. Admin hashes:

```bash
pnpm tsx scripts/hash-password.ts "a-strong-password"
```

### Admin accounts

There are exactly two admins. `ADMIN_1_EMAIL` / `ADMIN_1_PASSWORD_HASH` (and
`ADMIN_2_*`) **seed** the `admins` table the first time someone signs in. After
that the database is authoritative, so an admin can change their own password at
`/admin/account` (current password required; a notification email is sent). The
env `*_PASSWORD_HASH` is never re-applied on redeploy once a row exists.

Reset a locked-out admin out of band:

```bash
pnpm tsx scripts/set-admin-password.ts "admin@example.com" "a-new-strong-password"
```

If your database predates the `admins` table, apply the migration:

```bash
pnpm tsx scripts/db-push.ts db/migrations/001_add_admins.sql
```

### 3. Create the schema (run once, against an empty database)

```bash
psql "$DATABASE_URL" -f db/schema.sql
# or, if psql can't reach Neon from your network:
pnpm tsx scripts/db-push.ts
```

### 4. Seed (optional placeholder data)

Edit the arrays at the top of `scripts/seed.ts`, then:

```bash
pnpm tsx scripts/seed.ts
```

### 5. Run

```bash
pnpm dev          # http://localhost:3000  (voter)  ·  /admin  (admin)
pnpm test         # pure-logic unit tests (no DB needed)
pnpm load-test    # concurrency check against a running server - see scripts/load-test.ts
```

### 6. Deploy

Set **every** variable from `.env.example` in the Vercel project (Production) first; set
`NEXTAUTH_URL` to the deployed URL. Then `vercel --prod`, and run steps 3 to 4 against the production
`DATABASE_URL`. Optionally add a Vercel Cron hitting `POST /api/admin/outbox/flush` with header
`x-cron-key: $CRON_SECRET` every few minutes to drain deferred notification emails.

### CI/CD

- **`.github/workflows/ci.yml`** runs on every push and PR to `main`: `pnpm install --frozen-lockfile`,
  `pnpm test`, applies `db/schema.sql` to a throwaway Postgres 16 service (catches SQL/DDL
  regressions), then `pnpm build`. No real secrets or database are used.
- **`.github/workflows/deploy.yml`** deploys to Vercel production on push to `main`, but only when
  the repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` are set - otherwise it
  no-ops green. It deploys **code only**: apply schema/migration changes to the production database
  yourself. (Or connect the repo in the Vercel dashboard and delete this workflow to use Vercel's
  native Git integration.)

---

## Architecture

### 1. Database schema

`voters` (registry) · `elections` (with `status`, `version` for optimistic locking) ·
`positions` + `candidates` (reusable) · `election_positions` (ballot = which positions, in what
order) · `election_voters` (eligibility + `has_voted`) · `votes` (the ballot box) ·
`vote_idempotency` · `email_outbox` · `admin_audit_log`. CHECK constraints enforce a valid voting
window (`voting_end > voting_start`), a full window for any non-draft/closed election, and
`has_voted = (voted_at IS NOT NULL)`. A `BEFORE INSERT` trigger on `votes` rejects any candidate
not on that election's ballot.

### 2. Vote transaction (`castBallot` in `lib/queries.ts`)

One transaction, one pooled connection, in order: (a) re-check the election is open using the
**database** clock `voting_start <= now() < voting_end`; (b) `INSERT ... ON CONFLICT DO NOTHING`
the idempotency key - a replay short-circuits as `duplicate`; (c) `UPDATE election_voters SET
has_voted = true WHERE ... AND has_voted = false RETURNING` - the atomic one-vote claim; (d)
validate the whole ballot against the authoritative config (`lib/ballot-rules.ts`); (e) insert one
`votes` row per selection; (f) enqueue the notification into `email_outbox`. Any business rejection
throws `RollbackSignal`, so **nothing** - not even the idempotency key - persists and the voter can
retry. No HTTP call happens inside the transaction.

### 3. Concurrency strategy

The one-vote invariant rests entirely on the conditional `UPDATE ... WHERE has_voted = false`.
That statement takes a row lock, so N concurrent claims for the same voter serialise on that row
and exactly one gets `RETURNING` rows; the rest see zero and roll back. No Redis lock, no
in-process lock, no `SELECT`-then-`UPDATE`. `scripts/load-test.ts` fires 100 concurrent submissions
for one voter and asserts exactly one is accepted.

### 4. Transaction isolation

**READ COMMITTED** for the vote path - sufficient because correctness comes from the row lock, not
from isolation. `withTx` accepts a level and a bounded retry count; retries fire **only** on
serialization failure (`40001`) and deadlock (`40P01`), with exponential backoff + jitter, capped
at 3 attempts. Nothing else is retried.

### 5. Idempotency / exactly-once

HTTP is at-least-once: a browser, proxy, or the user can resend a POST, and a response can be lost
after the server commits. The client generates one `idempotencyKey` (UUID) per verified ballot and
**reuses it on every retry**. The server records it inside the vote transaction. A resend with the
same key returns `{ status: "recorded", duplicate: true }` without inserting anything. So the
*request* is effectively idempotent while the *database* holds the actual one-vote invariant. We do
not claim exactly-once execution - we claim exactly-once **effect**. The idempotency row has no
voter or candidate column, so it cannot leak a choice.

### 6. Failure recovery

- **Before commit** (crash mid-transaction): PostgreSQL rolls back; `has_voted` is never left true
  without a committed ballot; the voter can retry.
- **During ballot insertion** (3rd of 4 rows fails): the whole transaction rolls back; no partial
  ballot; the voter can retry.
- **After commit, response lost**: the voter retries. The idempotency key (or, failing that, the
  `has_voted` claim) makes the retry a no-op that returns a safe "already recorded" outcome. The
  UI never says the vote failed - a timeout puts it in an *"we couldn't confirm"* state with a
  **Check vote status** action that re-runs verification.

### 7. Redis failure behaviour

Redis is rate-limiting only. On any Redis error `rateLimit()` logs and falls back to a
per-instance in-memory limiter (best-effort, cannot affect correctness), then returns. Voting
verification and submission proceed. `GET /api/health/ready` reports Redis status but a Redis
outage never makes the app "not ready".

### 8. Resend failure behaviour

Email is never inside a transaction. A recorded vote enqueues a row in `email_outbox`; delivery is
attempted after commit and, on failure, the row stays `pending` (up to 5 attempts) for the next
drain - triggered by the next vote, by the admin "Send results" button, or by the cron endpoint.
A Resend outage never changes the vote result or the API's "recorded" response.

### 9. Election timing enforcement

The **write** path (`/api/vote/verify`, `castBallot`) decides open/closed in SQL with `now()` -
`voting_start <= now() < voting_end` (closed exactly at `voting_end`). The stored `status` is admin
intent; `effectiveStatus()` folds in the clock for **display only** and is never the sole gate on a
mutation. Client countdowns are informational. If the window closes while a voter is on the ballot,
submission is rejected server-side with `ELECTION_CLOSED`.

`closeExpiredElections()` flips `status` to `closed` for any election past `voting_end` and queues
its final-results email exactly once (`results_emailed_at` guard). It runs from the Vercel cron in
`vercel.json` (`GET /api/cron/close-expired`, every 5 min) and opportunistically whenever the public
`/api/elections/open` endpoint is hit, so an ended election finalises and emails even if the cron is
unavailable. An admin who closes an election manually triggers the same results email.

### 9a. Eligibility modes

Each election is `restricted` (default) or `open`:

- **restricted**: only voters on `election_voters` may vote; the admin loads that list (registry
  pick or `matric,name` CSV). Verify checks the voter is on the list and the name matches.
- **open**: no list. Anyone giving a matric number + full name may vote. The matric is registered
  on first use and the name is **locked** to it; later attempts must match. Identity is recorded
  (in `voters` / `election_voters`) for audit, but never joined to a `votes` row.

`max_voters` (optional) caps the number of **ballots cast**. When set, the vote transaction takes a
per-election advisory lock (`pg_advisory_xact_lock`) so the cap is exact under concurrency; the
one-vote guarantee still comes from the conditional `UPDATE`, not the lock.

### 10. Admin concurrency control

`elections.version` is optimistic-lock. `GET` returns it; `PATCH` requires it and runs
`UPDATE ... SET version = version + 1 WHERE id = $ AND version = $expected`. Zero rows + row exists
→ `409 STALE_VERSION`, and the UI reloads the latest values instead of silently overwriting.
Status changes are checked against a state machine (`draft → scheduled → open → closed`, plus
`scheduled → draft`); **a closed election can never be reopened**. Once any vote exists the ballot
is frozen: positions/candidates cannot be added, renamed, reordered, or deleted (409
`ELECTION_LOCKED`) - clone the election instead. A voter who has voted cannot be removed.

### 11. Ballot-secrecy guarantees

Covered above and audited by grepping the tree for `voter`, `matric`, `candidate` in the same
persistence path. Admin results are `COUNT(*) ... GROUP BY candidate_id` (candidates with zero
votes included via `LEFT JOIN`); turnout is `count(*) FILTER (WHERE has_voted)` on
`election_voters`. The participation list shows *who voted*, never *what they chose*. There is no
endpoint, query, export, or column that pairs the two.

### 12. Observability

Structured one-line JSON logs (`lib/log.ts`) with a per-request id, surfaced in the
`x-request-id` response header. Events: `vote_verification_*`, `vote_submission_started` /
`_committed` / `_rejected` / `_duplicate`, `db_unavailable`, `db_contention`,
`rate_limit_triggered`, `admin_login_failed`, `outbox_send_failed`. No request bodies, matric
numbers, names, or selections are logged.

### 13. Errors & degraded UI

All API errors use `{ error: { code, message } }` with real status codes (400/401/403/404/409/
413/415/429/500/503). Transient DB failures map to `503 TEMPORARY_ERROR` with no SQL, hostnames,
or stack traces. The voter page still renders if the database is down (server-rendered shell +
client "temporarily unavailable / Retry"). Every async admin section has explicit
loading (skeletons) / success / empty / error+retry states; the results dashboard background-
refreshes every 15 s without flashing and keeps the last good data if a refresh fails. Large
lists (registry, eligible voters, participation) are server-paginated.

---

## Failure and Recovery Model

| # | Scenario | What happens | Why results stay correct |
|---|---|---|---|
| 1 | **PostgreSQL unavailable** | Reads → `503 TEMPORARY_ERROR`; voter page shows a degraded "try again" state; the app shell still serves. Submissions error out **before** any write. | No vote is ever reported recorded unless its transaction committed. |
| 2 | **Redis unavailable** | `rateLimit()` logs once and uses a per-instance fallback limiter. Voting proceeds. | Redis is never consulted for `has_voted` or election status. |
| 3 | **Resend unavailable** | Vote still commits and returns `recorded`. The `email_outbox` row stays `pending` and is retried later. | Email is outside the transaction entirely. |
| 4 | **Vercel terminates a function mid-request** | The Postgres transaction either already committed or is rolled back by the server on disconnect. | No partial ballot, no orphan `has_voted`. |
| 5 | **Voter double-clicks Submit** | Button disables on click (UX only). Second request carries the same idempotency key → `duplicate` → no second ballot. | One-vote claim + idempotency key. |
| 6 | **Voter retries after a network timeout** | UI enters "couldn't confirm", never "failed". Retry reuses the key → `duplicate`; or `verify` reports `already-voted` → success screen. | Idempotency key; `has_voted` claim as backstop. |
| 7 | **Two requests for the same voter at once** | Both reach the conditional `UPDATE`; one gets the row lock and `RETURNING` rows, the other gets zero and rolls back → `409 ALREADY_VOTED`. | Row-level lock in READ COMMITTED. |
| 8 | **Two admins edit one election** | Second `PATCH` with a stale `version` → `409 STALE_VERSION`; the UI reloads. | Optimistic `version` column. |
| 9 | **Election closes while a voter is on the ballot** | `castBallot`'s SQL `now()` check fails → `RollbackSignal('not-open')` → `403 ELECTION_CLOSED`. | Window is evaluated with the DB clock at submit time. |
| 10 | **Transaction fails halfway (e.g. 3rd vote insert)** | `withTx` issues `ROLLBACK`; every row from the attempt disappears, including the idempotency key. | Single transaction, single connection. |
| 11 | **App crashes immediately after COMMIT** | Client sees a timeout → "couldn't confirm" → retry is a no-op. | Idempotency key persisted in the same commit. |
| 12 | **Email fails after a successful vote** | Logged; outbox row `pending`; retried by the next drain. Voter still sees success. | Transactional outbox. |
| 13 | **Admin tries to modify an active election's ballot** | `409 ELECTION_LOCKED`; the ballot tab renders read-only with an explanation. | `ballotEditable()` blocks it in the API. |

---

## Backup & Disaster Recovery

- **The `votes` rows are the election result.** Protecting PostgreSQL is the whole DR story;
  application-level fault tolerance cannot recover data lost from the database.
- **Neon** provides continuous backups and point-in-time restore (retention depends on plan). Take
  a manual `pg_dump` before opening each election and archive it off-Neon:
  `pg_dump "$DATABASE_URL" -Fc -f nacosvote-$(date +%F).dump`.
- **Temporary DB outage:** the app degrades (table above); no data is lost; it recovers on its own
  when Neon returns.
- **Bad application deploy:** Vercel keeps previous immutable deployments - roll back in the
  dashboard or `vercel rollback`. App instances are stateless; there is nothing to migrate back.
- **Schema changes:** add numbered files under `db/migrations/` and apply them in order; never
  hand-edit production tables. The app assumes the baseline schema exists and will surface clear
  `500`s (not silent wrong answers) if an object is missing.
- **DB role:** point `DATABASE_URL` at a least-privilege role (DML + sequence usage on the app
  tables); keep DDL/migration rights on a separate role.

---

## Implemented vs. deferred

**Implemented:** everything above - DB constraints + trigger, atomic idempotent vote transaction,
bounded retry/backoff, READ COMMITTED with documented rationale, hardened `pg.Pool` (timeouts, no
client leaks, no external calls inside transactions), optimistic-concurrency admin edits, election
state machine + frozen-ballot lock, DB-clock timing, Zod validation on every external input with a
consistent error envelope, structured PII-safe logging with request ids, `/api/health` +
`/api/health/ready`, Redis fail-open + per-instance fallback, transactional email outbox with a
drain endpoint, server-side pagination, skeleton/empty/error/refresh UI states, error boundaries,
offline detection, "couldn't confirm" recovery path, unit tests + a concurrency load-test script.

**Deferred (documented, not built):** an automated DB-integration test suite (needs a throwaway
`TEST_DATABASE_URL`; `scripts/load-test.ts` covers the concurrency invariant end-to-end today);
CSRF tokens on admin mutations (currently: same-site auth cookie + JSON-only + method checks -
adequate for this threat model, a token layer would harden it further); drag-and-drop ballot
reordering (numeric up-arrow ordering is wired); a full Playwright pass over the 20-scenario UX
matrix.

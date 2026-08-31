import { config } from 'dotenv';

config({ path: '.env.local' });

/**
 * Concurrency check against a RUNNING server (local `pnpm dev` or a deploy).
 *
 *   BASE_URL=http://localhost:3000 \
 *   TEST_ELECTION_ID=1 TEST_MATRIC=CSC/2023/001 TEST_NAME="John Doe" \
 *   pnpm load-test
 *
 * It fires N concurrent /api/vote/submit requests for the SAME voter (a mix of
 * shared and distinct idempotency keys) and asserts that the server accepts the
 * ballot at most once. It does not add artificial locks; correctness comes from
 * the DB transaction.
 */
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const electionId = Number(process.env.TEST_ELECTION_ID);
const matricNumber = process.env.TEST_MATRIC ?? '';
const name = process.env.TEST_NAME ?? '';
const N = Number(process.env.CONCURRENCY ?? 100);

async function verify() {
  const res = await fetch(`${BASE}/api/vote/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ matricNumber, name, electionId }),
  });
  return res.json();
}

async function submit(idempotencyKey: string, selections: unknown) {
  const res = await fetch(`${BASE}/api/vote/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ matricNumber, name, electionId, idempotencyKey, selections }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function main() {
  if (!electionId || !matricNumber || !name) {
    console.error('Set TEST_ELECTION_ID, TEST_MATRIC and TEST_NAME.');
    process.exit(1);
  }

  const v = await verify();
  if (v.status !== 'ok') {
    console.error(`Cannot run: verify returned "${v.status}" (voter must be eligible and not yet voted).`);
    process.exit(1);
  }
  const selections = (v.ballot as { id: number; candidates: { id: number }[] }[]).map((p) => ({
    positionId: p.id,
    candidateId: p.candidates[0].id,
  }));

  const sharedKey = crypto.randomUUID();
  const jobs = Array.from({ length: N }, (_, i) =>
    submit(i % 2 === 0 ? sharedKey : crypto.randomUUID(), selections),
  );
  const results = await Promise.all(jobs);

  const recorded = results.filter((r) => r.status === 200 && r.body.status === 'recorded' && !r.body.duplicate);
  const duplicate = results.filter((r) => r.status === 200 && r.body.duplicate);
  const alreadyVoted = results.filter((r) => r.body?.error?.code === 'ALREADY_VOTED');
  const other = results.filter(
    (r) => !recorded.includes(r) && !duplicate.includes(r) && !alreadyVoted.includes(r),
  );

  console.log(`requests:        ${N}`);
  console.log(`recorded (new):  ${recorded.length}   <-- must be exactly 1`);
  console.log(`idempotent dup:  ${duplicate.length}`);
  console.log(`already-voted:   ${alreadyVoted.length}`);
  console.log(`other responses: ${other.length}`, other.slice(0, 3).map((r) => r.status));

  if (recorded.length !== 1) {
    console.error('\nFAIL: the voter was accepted more than once (or not at all).');
    process.exit(1);
  }
  console.log('\nPASS: exactly one ballot accepted for the voter under concurrency.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

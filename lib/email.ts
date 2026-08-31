import { Resend } from 'resend';
import { pool } from './db';
import { claimPendingEmails, markEmailFailed, markEmailSent } from './queries';
import { log, safeError } from './log';

const FROM = process.env.RESEND_FROM || 'NacosVote <onboarding@resend.dev>';

function adminAddresses(): string[] {
  return [process.env.ADMIN_1_EMAIL, process.env.ADMIN_2_EMAIL].filter(Boolean) as string[];
}

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString() : 'not set';
}

type VoteRecordedPayload = { voted: number; total: number };
type FinalResultsPayload = {
  title: string;
  votingStart: string | null;
  votingEnd: string | null;
  turnout: { voted: number; total: number };
  positions: { name: string; candidates: { name: string; votes: number }[] }[];
};

async function electionTitle(electionId: number): Promise<string> {
  const { rows } = await pool.query<{ title: string }>('SELECT title FROM elections WHERE id = $1', [
    electionId,
  ]);
  return rows[0]?.title ?? `Election ${electionId}`;
}

function renderVoteRecorded(title: string, p: VoteRecordedPayload) {
  return {
    subject: `NacosVote: new vote recorded - ${title}`,
    text: `New vote recorded.\n\nElection: ${title}\nTurnout: ${p.voted} of ${p.total}`,
  };
}

function renderFinalResults(p: FinalResultsPayload) {
  const pct = p.turnout.total === 0 ? '0%' : `${((p.turnout.voted / p.turnout.total) * 100).toFixed(1)}%`;
  const lines = [
    `${p.title} - final results`,
    '',
    `Voting period: ${fmt(p.votingStart)} → ${fmt(p.votingEnd)}`,
    `Turnout: ${p.turnout.voted} of ${p.turnout.total} (${pct})`,
    '',
  ];
  for (const pos of p.positions) {
    lines.push(pos.name);
    for (const c of pos.candidates) lines.push(`  ${c.name}: ${c.votes}`);
    lines.push('');
  }
  return { subject: `NacosVote: final results - ${p.title}`, text: lines.join('\n') };
}

/**
 * Drains pending rows from email_outbox. Safe to call from any request path or a
 * cron. Never throws into the caller; a send failure leaves the row pending
 * (up to a max attempt count) for the next drain. Contains only aggregate data.
 */
export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  const resend = client();
  const to = adminAddresses();
  const rows = await claimPendingEmails(20);
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (!resend || to.length === 0) {
        await markEmailFailed(row.id, 'email not configured');
        failed++;
        continue;
      }
      const message =
        row.kind === 'vote_recorded'
          ? renderVoteRecorded(
              await electionTitle(row.election_id),
              row.payload as VoteRecordedPayload,
            )
          : renderFinalResults(row.payload as FinalResultsPayload);

      const res = await resend.emails.send({ from: FROM, to, ...message });
      if (res.error) throw new Error(res.error.message);
      await markEmailSent(row.id);
      sent++;
    } catch (err) {
      log.error('outbox_send_failed', { id: row.id, kind: row.kind, err: safeError(err) });
      await markEmailFailed(row.id, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }
  return { sent, failed };
}

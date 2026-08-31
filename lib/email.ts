import { Resend } from 'resend';
import { pool } from './db';
import { claimPendingEmails, markEmailFailed, markEmailSent } from './queries';
import { log, safeError } from './log';

const FROM = process.env.RESEND_FROM || 'NacosVote <onboarding@resend.dev>';

// NACOS palette (kept in sync with app/globals.css tokens).
const C = {
  paper: '#f6f3ea',
  ink: '#1c2b22',
  muted: '#5b6b60',
  line: '#d8d2bf',
  accent: '#006934',
  white: '#ffffff',
};

function adminAddresses(): string[] {
  return [process.env.ADMIN_1_EMAIL, process.env.ADMIN_2_EMAIL].filter(Boolean) as string[];
}

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// Emails are read by admins in Nigeria; render times in a fixed zone with AM/PM
// and label it, so a UTC server clock does not confuse anyone. Override with
// EMAIL_TIMEZONE (an IANA name).
const EMAIL_TZ = process.env.EMAIL_TIMEZONE || 'Africa/Lagos';

function fmtInTz(d: Date): string {
  const s = d.toLocaleString('en-US', {
    timeZone: EMAIL_TZ,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${s} (${EMAIL_TZ})`;
}

function fmt(d: string | null): string {
  return d ? fmtInTz(new Date(d)) : 'not set';
}

function logoUrl(): string | null {
  const base = process.env.NEXTAUTH_URL;
  return base && base.startsWith('https://') ? `${base.replace(/\/$/, '')}/brand/nacos-logo-160.png` : null;
}

/** Wraps body HTML in the branded NacosVote shell. */
function shell(heading: string, bodyHtml: string): string {
  const logo = logoUrl();
  const serif = "Georgia,'Iowan Old Style','Times New Roman',serif";
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  return `<!doctype html><html><body style="margin:0;padding:0;background:${C.paper};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.white};border:1px solid ${C.line};">
  <tr><td style="padding:20px 28px;border-bottom:3px solid ${C.accent};">
    ${logo ? `<img src="${logo}" width="34" height="34" alt="NACOS" style="vertical-align:middle;margin-right:10px;">` : ''}
    <span style="font:600 11px/1 ${sans};letter-spacing:2px;color:${C.muted};text-transform:uppercase;vertical-align:middle;">NACOS &middot; UNIZIK</span>
  </td></tr>
  <tr><td style="padding:24px 28px 8px;">
    <h1 style="margin:0;font:400 22px/1.25 ${serif};color:${C.ink};">${esc(heading)}</h1>
  </td></tr>
  <tr><td style="padding:0 28px 24px;font:400 14px/1.6 ${sans};color:${C.ink};">
    ${bodyHtml}
  </td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid ${C.line};font:400 12px/1.5 ${sans};color:${C.muted};">
    Sent by NacosVote, the NACOS UNIZIK chapter election platform.
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

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

function pctOf(voted: number, total: number): string {
  return total === 0 ? '0%' : `${((voted / total) * 100).toFixed(1)}%`;
}

function renderVoteRecorded(title: string, p: VoteRecordedPayload) {
  const html = shell('A vote was recorded', `
    <p style="margin:0 0 12px;">A ballot was submitted in this election.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;border-top:1px solid ${C.line};color:${C.muted};">Election</td>
          <td style="padding:8px 0;border-top:1px solid ${C.line};text-align:right;font-weight:600;">${esc(title)}</td></tr>
      <tr><td style="padding:8px 0;border-top:1px solid ${C.line};color:${C.muted};">Ballots cast</td>
          <td style="padding:8px 0;border-top:1px solid ${C.line};text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${p.voted} of ${p.total}</td></tr>
    </table>
    <p style="margin:16px 0 0;color:${C.muted};font-size:12px;">This notice carries no candidate information.</p>
  `);
  return {
    subject: `NacosVote: vote recorded - ${title}`,
    text: `A vote was recorded.\n\nElection: ${title}\nBallots cast: ${p.voted} of ${p.total}\n\nThis notice carries no candidate information.`,
    html,
  };
}

function renderFinalResults(p: FinalResultsPayload) {
  const pct = pctOf(p.turnout.voted, p.turnout.total);

  const positionsHtml = p.positions
    .map((pos) => {
      const rows = pos.candidates.length
        ? pos.candidates
            .map(
              (c) => `<tr>
                <td style="padding:7px 0;border-top:1px solid ${C.line};">${esc(c.name)}</td>
                <td style="padding:7px 0;border-top:1px solid ${C.line};text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">${c.votes}</td>
              </tr>`,
            )
            .join('')
        : `<tr><td colspan="2" style="padding:7px 0;border-top:1px solid ${C.line};color:${C.muted};">No candidates.</td></tr>`;
      return `
        <h2 style="margin:22px 0 2px;font:400 16px/1.3 Georgia,'Times New Roman',serif;color:${C.ink};text-transform:uppercase;letter-spacing:.5px;">${esc(pos.name)}</h2>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>`;
    })
    .join('');

  const html = shell(`${p.title}`, `
    <p style="margin:0 0 4px;font:600 11px/1 -apple-system,Arial,sans-serif;letter-spacing:1.5px;color:${C.muted};text-transform:uppercase;">Final results</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:8px;">
      <tr><td style="padding:8px 0;border-top:1px solid ${C.line};color:${C.muted};">Voting period</td>
          <td style="padding:8px 0;border-top:1px solid ${C.line};text-align:right;">${esc(fmt(p.votingStart))} to ${esc(fmt(p.votingEnd))}</td></tr>
      <tr><td style="padding:8px 0;border-top:1px solid ${C.line};color:${C.muted};">Turnout</td>
          <td style="padding:8px 0;border-top:1px solid ${C.line};text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">${p.turnout.voted} of ${p.turnout.total} (${pct})</td></tr>
    </table>
    ${positionsHtml}
    <p style="margin:22px 0 0;color:${C.muted};font-size:12px;">Counts are aggregate. No record links a voter to a candidate.</p>
  `);

  const lines = [
    `${p.title} - final results`,
    '',
    `Voting period: ${fmt(p.votingStart)} to ${fmt(p.votingEnd)}`,
    `Turnout: ${p.turnout.voted} of ${p.turnout.total} (${pct})`,
    '',
  ];
  for (const pos of p.positions) {
    lines.push(pos.name.toUpperCase());
    if (pos.candidates.length === 0) lines.push('  (no candidates)');
    for (const c of pos.candidates) lines.push(`  ${c.name}: ${c.votes}`);
    lines.push('');
  }
  return { subject: `NacosVote: final results - ${p.title}`, text: lines.join('\n'), html };
}

// ---------------------------------------------------------------------------
// Direct sends (not via outbox)
// ---------------------------------------------------------------------------

export async function sendPasswordChangedEmail(adminEmail: string): Promise<void> {
  const resend = client();
  if (!resend) return;
  const recipients = new Set([adminEmail, ...adminAddresses()]);
  const when = fmtInTz(new Date());
  const html = shell('An admin password was changed', `
    <p style="margin:0 0 12px;">The password for <strong>${esc(adminEmail)}</strong> was just changed.</p>
    <p style="margin:0 0 12px;color:${C.muted};">Time: ${esc(when)}</p>
    <p style="margin:0;">If you did not make this change, your account may be compromised. Contact the
    other administrator right away. If you can still sign in, change the password again from the
    Account page.</p>
  `);
  await resend.emails.send({
    from: FROM,
    to: [...recipients],
    subject: 'NacosVote: an admin password was changed',
    text:
      `The password for the admin account ${adminEmail} was just changed.\n` +
      `Time: ${when}\n\n` +
      `If you did not make this change, your account may be compromised. Contact the other ` +
      `administrator right away. If you can still sign in, change the password again from the ` +
      `Account page.`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Outbox drain
// ---------------------------------------------------------------------------

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
          ? renderVoteRecorded(await electionTitle(row.election_id), row.payload as VoteRecordedPayload)
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

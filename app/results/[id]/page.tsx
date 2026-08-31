import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getElection, getPublicResults } from '@/lib/queries';
import { effectiveStatus } from '@/lib/election';
import { Brand } from '@/app/components/brand';
import { StatusBadge } from '@/app/components/ui';

export const dynamic = 'force-dynamic';

const DT = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
} as const;
const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString(undefined, DT) : 'not set');

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const id = Number(params.id);
  const election = Number.isInteger(id) ? await getElection(id).catch(() => null) : null;
  return { title: election && election.results_public ? `${election.title} results` : 'Results' };
}

export default async function PublicResultsPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const election = await getElection(id);
  // Not published => the page does not exist publicly.
  if (!election || !election.results_public) notFound();

  const status = effectiveStatus(election);
  const showTally = status === 'closed' || election.results_live;

  return (
    <main className="mx-auto w-full max-w-[680px]">
      <Brand title="Election results" subtitle={election.title} />

      <div className="mb-4">
        <StatusBadge status={status} />
      </div>
      <p className="meta">
        Voting period: {fmt(election.voting_start)} to {fmt(election.voting_end)}
      </p>
      <hr className="rule my-6" />

      {showTally && status !== 'closed' && (
        <div className="msg-warn mb-6" role="status">
          <p className="msg-title">Live results, voting is still open</p>
          <p className="mt-1 text-ink/75">These counts will keep changing until voting closes.</p>
        </div>
      )}

      {showTally ? (
        <Results id={id} />
      ) : (
        <div className="msg-info" role="status">
          <p className="msg-title">Results are not final yet</p>
          <p className="mt-1 text-ink/75">
            The tally is published here once voting closes
            {election.voting_end ? ` (${fmt(election.voting_end)})` : ''}.
          </p>
        </div>
      )}

      <hr className="rule my-8" />
      <Link href="/" className="font-semibold no-underline hover:underline">
        Back to voting
      </Link>
    </main>
  );
}

async function Results({ id }: { id: number }) {
  const data = await getPublicResults(id);
  if (!data) notFound();

  const totalVotes = data.positions.reduce(
    (s, p) => s + p.candidates.reduce((a, c) => a + c.votes, 0),
    0,
  );
  const noVotes = totalVotes === 0;

  return (
    <>
      <p className="kicker">Turnout</p>
      <p className="mt-1 font-serif text-2xl tabular-nums">
        {data.turnout.voted} of {data.turnout.total}
      </p>
      <p className="meta tabular-nums">{data.turnout.percent.toFixed(1)}% voted</p>

      {noVotes ? (
        <div className="mt-6 border-y border-line py-8 text-center">
          <p className="section-title">No votes were recorded</p>
        </div>
      ) : (
        data.positions.map((p) => {
          const cast = p.candidates.reduce((s, c) => s + c.votes, 0);
          const top = Math.max(1, ...p.candidates.map((c) => c.votes));
          return (
            <section key={p.id} className="mt-8">
              <h2 className="position-title text-base">{p.name}</h2>
              <p className="field-hint">{cast} vote{cast === 1 ? '' : 's'} for this position</p>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {p.candidates.map((c) => {
                    const pct = cast ? (c.votes / cast) * 100 : 0;
                    return (
                      <tr key={c.id} className="border-b border-line last:border-b-0">
                        <td className="w-2/5 py-2 pr-3 align-top">{c.name}</td>
                        <td className="py-2 align-top">
                          <span
                            aria-hidden="true"
                            className="mr-2 inline-block h-2 rounded-sm bg-accent align-middle"
                            style={{ width: `${(c.votes / top) * 100}%`, minWidth: c.votes ? 6 : 0 }}
                          />
                        </td>
                        <td className="whitespace-nowrap py-2 text-right align-top tabular-nums">
                          <span className="font-semibold">{c.votes}</span>
                          <span className="ml-2 text-ink/60">{pct.toFixed(1)}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })
      )}

      <p className="field-hint mt-8">
        Counts are aggregate. No record links any voter to a candidate.
      </p>
    </>
  );
}

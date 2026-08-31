import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/auth';
import { getElection, getPublicResults } from '@/lib/queries';
import { effectiveStatus } from '@/lib/election';
import { Brand } from '@/app/components/brand';
import { StatusBadge } from '@/app/components/ui';
import PrintButton from '@/app/components/print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Printable results' };

const DT = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
} as const;
const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString(undefined, DT) : 'not set');

export default async function PrintableResults({ params }: { params: { id: string } }) {
  await requireAdminPage();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const election = await getElection(id);
  if (!election) notFound();
  const data = await getPublicResults(id);
  if (!data) notFound();

  return (
    <main className="mx-auto w-full max-w-[680px]">
      <div className="no-print mb-6 flex flex-wrap items-center gap-4">
        <Link href={`/admin/elections/${id}`} className="font-semibold no-underline hover:underline">
          Back to election
        </Link>
        <PrintButton label="Print / save as PDF" />
      </div>

      <Brand title="Election results" subtitle={election.title} />
      <div className="mb-3">
        <StatusBadge status={effectiveStatus(election)} />
      </div>
      <p className="meta">
        Voting period: {fmt(election.voting_start)} to {fmt(election.voting_end)}
      </p>
      <hr className="rule my-6" />

      <p className="kicker">Turnout</p>
      <p className="mt-1 font-serif text-2xl tabular-nums">
        {data.turnout.voted} of {data.turnout.total}
      </p>
      <p className="meta tabular-nums">{data.turnout.percent.toFixed(1)}% voted</p>

      {data.positions.every((p) => p.candidates.every((c) => c.votes === 0)) ? (
        <p className="section-title mt-6">No votes were recorded.</p>
      ) : (
        data.positions.map((p) => {
          const cast = p.candidates.reduce((s, c) => s + c.votes, 0);
          return (
            <section key={p.id} className="mt-8">
              <h2 className="position-title text-base">{p.name}</h2>
              <p className="field-hint">{cast} vote{cast === 1 ? '' : 's'} for this position</p>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {p.candidates.map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-b-0">
                      <td className="py-2 pr-3">{c.name}</td>
                      <td className="whitespace-nowrap py-2 text-right tabular-nums">
                        <span className="font-semibold">{c.votes}</span>
                        <span className="ml-2 text-ink/60">
                          {(cast ? (c.votes / cast) * 100 : 0).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })
      )}

      <p className="field-hint mt-10">
        Counts are aggregate. No record links any voter to a candidate. Generated{' '}
        {fmt(new Date())}.
      </p>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useResource } from '@/lib/client/use-resource';
import { EmptyState, ErrorState, SkeletonCard } from '../components/states';
import { StatusBadge } from '../components/ui';

type Row = {
  id: number;
  title: string;
  effectiveStatus: string;
  votingStart: string | null;
  votingEnd: string | null;
  eligibleCount: number;
  votedCount: number;
  createdAt: string;
};

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Not set';
}

export default function ElectionsList() {
  const { data, error, loading, reload } = useResource<{ elections: Row[] }>('/api/admin/elections');

  return (
    <>
      {loading && (
        <div>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      )}

      {!loading && error && (
        <ErrorState
          title="Unable to load elections"
          message="The server could not retrieve the election data."
          onRetry={reload}
        />
      )}

      {!loading && !error && data && data.elections.length === 0 && (
        <EmptyState
          title="No elections yet"
          message="Create your first voting session to get started."
          action={
            <Link href="/admin/elections/new" className="btn-primary no-underline">
              <span>Create election</span>
            </Link>
          }
        />
      )}

      {!loading && !error && data && data.elections.length > 0 && (
        <ul className="border-t border-line">
          {data.elections.map((e) => (
            <li key={e.id} className="border-b border-line py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <Link
                  href={`/admin/elections/${e.id}`}
                  className="section-title no-underline hover:underline"
                >
                  {e.title}
                </Link>
                <StatusBadge status={e.effectiveStatus} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink/65">
                <span>
                  {fmt(e.votingStart)} to {fmt(e.votingEnd)}
                </span>
                <span className="tabular-nums">
                  {e.votedCount} of {e.eligibleCount} voted
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10">
        <button className="btn-secondary" onClick={() => signOut({ callbackUrl: '/admin/login' })}>
          <span>Sign out</span>
        </button>
      </div>
    </>
  );
}

'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useResource } from '@/lib/client/use-resource';
import { EmptyState, ErrorState, SkeletonCard } from '../components/states';

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
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export default function ElectionsList() {
  const { data, error, loading, reload } = useResource<{ elections: Row[] }>('/api/admin/elections');

  return (
    <>
      {loading && (
        <div>
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
            <Link href="/admin/elections/new" className="btnlink">
              Create election
            </Link>
          }
        />
      )}

      {!loading && !error && data && data.elections.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Voting window</th>
                <th className="num">Eligible</th>
                <th className="num">Voted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.elections.map((e) => (
                <tr key={e.id}>
                  <td>{e.title}</td>
                  <td>
                    <span className={`pill ${e.effectiveStatus}`}>{e.effectiveStatus}</span>
                  </td>
                  <td className="muted">
                    {fmt(e.votingStart)} → {fmt(e.votingEnd)}
                  </td>
                  <td className="num">{e.eligibleCount}</td>
                  <td className="num">{e.votedCount}</td>
                  <td>
                    <Link href={`/admin/elections/${e.id}`}>Manage</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 32 }}>
        <button className="secondary" onClick={() => signOut({ callbackUrl: '/admin/login' })}>
          Sign out
        </button>
      </p>
    </>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { useResource } from '@/lib/client/use-resource';
import { EmptyState, ErrorState, SkeletonRows, Spinner } from '@/app/components/states';

type Voter = { id: number; matricNumber: string; name: string; createdAt: string };
const PAGE = 50;

function useToast() {
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  return { toast, ok: (t: string) => setToast({ kind: 'ok', text: t }), err: (t: string) => setToast({ kind: 'err', text: t }) };
}

export default function VoterRegistry() {
  const { toast, ok, err } = useToast();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [matric, setMatric] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const url = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (debouncedQ) p.set('q', debouncedQ);
    return `/api/admin/voters?${p.toString()}`;
  }, [debouncedQ, offset]);

  const { data, error, loading, reload } = useResource<{ voters: Voter[]; total: number }>(url);

  async function add() {
    setBusy(true);
    const res = await apiFetch<{ id: number }>('/api/admin/voters', {
      method: 'POST',
      body: JSON.stringify({ matricNumber: matric.trim(), name: name.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      ok('Voter added.');
      setMatric('');
      setName('');
      reload();
    } else {
      err(res.message);
    }
  }

  async function update(v: Voter, patch: { matricNumber?: string; name?: string }) {
    const res = await apiFetch(`/api/admin/voters/${v.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      ok('Saved.');
      reload();
    } else {
      err(res.message);
    }
  }

  async function remove(v: Voter) {
    if (!confirm(`Remove ${v.name} from the registry?`)) return;
    const res = await apiFetch(`/api/admin/voters/${v.id}`, { method: 'DELETE' });
    if (res.ok) {
      ok('Removed.');
      reload();
    } else {
      err(res.message);
    }
  }

  const from = data && data.total ? offset + 1 : 0;
  const to = data ? Math.min(offset + PAGE, data.total) : 0;

  return (
    <div>
      <div className="card">
        <label>Add voter</label>
        <div className="row">
          <input value={matric} onChange={(e) => setMatric(e.target.value)} placeholder="Matric number" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          <button disabled={busy || !matric.trim() || !name.trim()} onClick={add}>
            {busy ? <Spinner label="Adding" /> : null}
            <span>Add</span>
          </button>
        </div>
      </div>

      <div className="card">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or matric"
          aria-label="Search voters"
        />

        {loading && !data && <SkeletonRows rows={8} cols={3} />}
        {error && !data && (
          <ErrorState title="Unable to load the registry" message={error.message} onRetry={reload} />
        )}
        {data && data.voters.length === 0 && (
          <EmptyState
            title={debouncedQ ? 'No voters found' : 'The registry is empty'}
            message={debouncedQ ? 'Try a different matric number or name.' : 'Add voters above or import them per election.'}
          />
        )}
        {data && data.voters.length > 0 && (
          <>
            <div className="table-scroll">
              <table className="voters">
                <thead>
                  <tr>
                    <th>Matric</th>
                    <th>Name</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.voters.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <input
                          defaultValue={v.matricNumber}
                          onBlur={(e) =>
                            e.target.value.trim() &&
                            e.target.value !== v.matricNumber &&
                            update(v, { matricNumber: e.target.value.trim() })
                          }
                        />
                      </td>
                      <td>
                        <input
                          defaultValue={v.name}
                          onBlur={(e) =>
                            e.target.value.trim() &&
                            e.target.value !== v.name &&
                            update(v, { name: e.target.value.trim() })
                          }
                        />
                      </td>
                      <td>
                        <button className="secondary danger" onClick={() => remove(v)}>
                          remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.total > PAGE && (
              <div className="row between">
                <span className="muted">
                  {from}–{to} of {data.total}
                </span>
                <div className="row">
                  <button
                    className="secondary"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE))}
                  >
                    Prev
                  </button>
                  <button
                    className="secondary"
                    disabled={to >= data.total}
                    onClick={() => setOffset(offset + PAGE)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {toast && <p className={toast.kind === 'ok' ? 'ok' : 'error'}>{toast.text}</p>}
    </div>
  );
}

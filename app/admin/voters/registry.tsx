'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { useResource } from '@/lib/client/use-resource';
import { EmptyState, ErrorState, SkeletonRows } from '@/app/components/states';
import { Button } from '@/app/components/ui';

type Voter = { id: number; matricNumber: string; name: string; createdAt: string };
const PAGE = 50;

function useToast() {
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  return {
    toast,
    ok: (t: string) => setToast({ kind: 'ok', text: t }),
    err: (t: string) => setToast({ kind: 'err', text: t }),
  };
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
      <p className="position-title">Add voter</p>
      <hr className="rule mb-4 mt-2" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="nm" className="field-label">
            Matric number
          </label>
          <input
            id="nm"
            className="field-input"
            value={matric}
            onChange={(e) => setMatric(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <label htmlFor="nn" className="field-label">
            Full name
          </label>
          <input
            id="nn"
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button loading={busy} disabled={!matric.trim() || !name.trim()} onClick={add}>
          Add
        </Button>
      </div>

      <p className="position-title mt-10">Registered voters</p>
      <hr className="rule mb-4 mt-2" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name or matric number"
        aria-label="Search voters"
        className="field-input mb-4"
      />

      {loading && !data && <SkeletonRows rows={8} cols={3} />}
      {error && !data && (
        <ErrorState title="Unable to load the registry" message={error.message} onRetry={reload} />
      )}
      {data && data.voters.length === 0 && (
        <EmptyState
          title={debouncedQ ? 'No voters found' : 'The registry is empty'}
          message={
            debouncedQ
              ? 'Try a different matric number or name.'
              : 'Add voters above, or import them per election.'
          }
        />
      )}

      {data && data.voters.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="w-full border-t border-line text-sm">
              <thead>
                <tr className="text-left text-ink/60">
                  <th className="py-2 pr-3 font-semibold">Matric</th>
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {data.voters.map((v) => (
                  <tr key={v.id} className="border-t border-line align-middle">
                    <td className="py-2 pr-3">
                      <input
                        defaultValue={v.matricNumber}
                        className="field-input min-h-[38px] py-1.5"
                        onBlur={(e) =>
                          e.target.value.trim() &&
                          e.target.value !== v.matricNumber &&
                          update(v, { matricNumber: e.target.value.trim() })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        defaultValue={v.name}
                        className="field-input min-h-[38px] py-1.5"
                        onBlur={(e) =>
                          e.target.value.trim() &&
                          e.target.value !== v.name &&
                          update(v, { name: e.target.value.trim() })
                        }
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        className="btn-danger min-h-[38px] px-3"
                        onClick={() => remove(v)}
                      >
                        <span>Remove</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.total > PAGE && (
            <div className="mt-4 flex items-center justify-between">
              <span className="meta tabular-nums">
                {from} to {to} of {data.total}
              </span>
              <div className="flex gap-2">
                <button
                  className="btn-secondary min-h-[38px] px-3"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  <span>Previous</span>
                </button>
                <button
                  className="btn-secondary min-h-[38px] px-3"
                  disabled={to >= data.total}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  <span>Next</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {toast && (
        <p className={`mt-4 text-sm font-semibold ${toast.kind === 'ok' ? 'text-accent' : 'text-danger'}`}>
          {toast.text}
        </p>
      )}
    </div>
  );
}

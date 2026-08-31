'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/client/api';
import { useResource } from '@/lib/client/use-resource';
import {
  EmptyState,
  ErrorState,
  RefreshNote,
  SkeletonCard,
  SkeletonRows,
  Spinner,
} from '@/app/components/states';

type Candidate = { id: number; name: string };
type Position = { id: number; name: string; candidates: Candidate[] };
type Detail = {
  id: number;
  title: string;
  description: string | null;
  status: string;
  effectiveStatus: string;
  version: number;
  votingStart: string | null;
  votingEnd: string | null;
  ballotEditable: boolean;
  hasVotes: boolean;
  ballot: Position[];
  turnout: { voted: number; total: number };
};
type Tab = 'settings' | 'ballot' | 'voters' | 'results';

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function useToast() {
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  return {
    toast,
    ok: (text: string) => setToast({ kind: 'ok', text }),
    err: (text: string) => setToast({ kind: 'err', text }),
  };
}

export default function ElectionDetail({ electionId }: { electionId: number }) {
  const [tab, setTab] = useState<Tab>('settings');
  const { data, error, loading, refreshing, reload } = useResource<Detail>(
    `/api/admin/elections/${electionId}`,
  );

  if (loading) {
    return (
      <>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={4} />
      </>
    );
  }
  if (error || !data) {
    return (
      <ErrorState
        title="Unable to load this election"
        message={error?.message}
        onRetry={reload}
      />
    );
  }

  return (
    <>
      <div className="row between">
        <h1>{data.title}</h1>
        <span className={`pill ${data.effectiveStatus}`}>{data.effectiveStatus}</span>
      </div>
      <StatusBanner detail={data} />
      <RefreshNote refreshing={refreshing} error={null} onRetry={reload} />

      <div className="tabs" role="tablist">
        {(['settings', 'ballot', 'voters', 'results'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'ballot' ? 'Positions & candidates' : t === 'voters' ? 'Eligible voters' : t}
          </button>
        ))}
      </div>

      {tab === 'settings' && <SettingsTab detail={data} reload={reload} />}
      {tab === 'ballot' && <BallotTab detail={data} reload={reload} />}
      {tab === 'voters' && <VotersTab electionId={electionId} status={data.status} reload={reload} />}
      {tab === 'results' && <ResultsTab electionId={electionId} />}
    </>
  );
}

function StatusBanner({ detail }: { detail: Detail }) {
  const s = detail.effectiveStatus;
  const cls = s === 'open' ? 'open' : s === 'closed' ? 'closed' : 'wait';
  return (
    <div className={`banner ${cls}`} role="status">
      <strong>{s.toUpperCase()}</strong>
      <div>
        {fmt(detail.votingStart)} → {fmt(detail.votingEnd)}
      </div>
      <div>
        {detail.turnout.voted} / {detail.turnout.total} voters have voted
      </div>
    </div>
  );
}

function SettingsTab({ detail, reload }: { detail: Detail; reload: () => void }) {
  const { toast, ok, err } = useToast();
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description ?? '');
  const [start, setStart] = useState(toLocalInput(detail.votingStart));
  const [end, setEnd] = useState(toLocalInput(detail.votingEnd));
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    const res = await apiFetch<{ ok: boolean }>(`/api/admin/elections/${detail.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ version: detail.version, ...body }),
    });
    setBusy(false);
    if (res.ok) {
      ok('Saved.');
      reload();
    } else if (res.status === 409 && res.code === 'STALE_VERSION') {
      err('Someone else changed this election. Reloading the latest version…');
      reload();
    } else {
      err(res.message);
    }
  }

  async function remove() {
    if (!confirm('Delete this draft election?')) return;
    const res = await apiFetch(`/api/admin/elections/${detail.id}`, { method: 'DELETE' });
    if (res.ok) window.location.href = '/admin';
    else err(res.message);
  }

  return (
    <div className="card">
      <label>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} />
      <label>Description</label>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      <label>Voting start</label>
      <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
      <label>Voting end</label>
      <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />

      <div className="row">
        <button
          disabled={busy}
          onClick={() =>
            patch({
              title: title.trim(),
              description: description.trim() || null,
              votingStart: start ? new Date(start).toISOString() : null,
              votingEnd: end ? new Date(end).toISOString() : null,
            })
          }
        >
          {busy ? <Spinner label="Saving" /> : null}
          <span>Save settings</span>
        </button>
        {(detail.status === 'draft' || detail.status === 'scheduled') && (
          <button className="secondary" disabled={busy} onClick={() => patch({ status: 'scheduled' })}>
            Mark scheduled
          </button>
        )}
        {detail.status !== 'closed' && (
          <button className="secondary" disabled={busy} onClick={() => patch({ status: 'open' })}>
            Open now
          </button>
        )}
        {(detail.status === 'open' || detail.status === 'scheduled') && (
          <button className="secondary" disabled={busy} onClick={() => patch({ status: 'closed' })}>
            Close now
          </button>
        )}
        {detail.status === 'draft' && (
          <button className="secondary danger" disabled={busy} onClick={remove}>
            Delete draft
          </button>
        )}
      </div>
      <p className="muted">
        A closed election cannot be reopened. The server decides &quot;open&quot; from status plus the
        current time being inside the window.
      </p>
      {toast && <p className={toast.kind === 'ok' ? 'ok' : 'error'}>{toast.text}</p>}
    </div>
  );
}

function BallotTab({ detail, reload }: { detail: Detail; reload: () => void }) {
  const { toast, ok, err } = useToast();
  const [newPosition, setNewPosition] = useState('');
  const [candidateDraft, setCandidateDraft] = useState<Record<number, string>>({});
  const locked = !detail.ballotEditable;
  const base = `/api/admin/elections/${detail.id}`;

  async function run(res: Promise<{ ok: boolean; message?: string }>) {
    const r = await res;
    if (r.ok) {
      ok('Saved.');
      reload();
    } else {
      err(r.message ?? 'Failed.');
    }
  }

  return (
    <div>
      {locked && (
        <div className="banner wait" role="status">
          The ballot is frozen{detail.hasVotes ? ' because votes have been cast' : ''}. Clone the
          election to change positions or candidates.
        </div>
      )}

      {!locked && (
        <div className="card">
          <label htmlFor="np">Add a position</label>
          <div className="row">
            <input
              id="np"
              value={newPosition}
              onChange={(e) => setNewPosition(e.target.value)}
              placeholder="e.g. President"
            />
            <button
              disabled={!newPosition.trim()}
              onClick={() => {
                run(
                  apiFetch(`${base}/positions`, {
                    method: 'POST',
                    body: JSON.stringify({ name: newPosition.trim() }),
                  }),
                );
                setNewPosition('');
              }}
            >
              Add position
            </button>
          </div>
        </div>
      )}

      {detail.ballot.length === 0 && (
        <EmptyState
          title="No positions added"
          message="Add the positions voters will choose candidates for."
        />
      )}

      {detail.ballot.map((p, idx) => (
        <div className="card" key={p.id}>
          <div className="row between">
            <input
              defaultValue={p.name}
              disabled={locked}
              onBlur={(e) => {
                if (!locked && e.target.value.trim() && e.target.value !== p.name) {
                  run(
                    apiFetch(`${base}/positions/${p.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ name: e.target.value.trim() }),
                    }),
                  );
                }
              }}
            />
            {!locked && (
              <div className="row">
                <button
                  className="secondary"
                  disabled={idx === 0}
                  title="Move up"
                  onClick={() =>
                    run(
                      apiFetch(`${base}/positions/${p.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ displayOrder: idx }),
                      }),
                    )
                  }
                >
                  ↑
                </button>
                <button
                  className="secondary danger"
                  onClick={() => run(apiFetch(`${base}/positions/${p.id}`, { method: 'DELETE' }))}
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          {p.candidates.length === 0 && (
            <p className="muted">No candidates added for this position.</p>
          )}
          <ul className="candlist">
            {p.candidates.map((c) => (
              <li key={c.id} className="row between">
                <input
                  defaultValue={c.name}
                  disabled={locked}
                  onBlur={(e) => {
                    if (!locked && e.target.value.trim() && e.target.value !== c.name) {
                      run(
                        apiFetch(`${base}/candidates/${c.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ name: e.target.value.trim() }),
                        }),
                      );
                    }
                  }}
                />
                {!locked && (
                  <button
                    className="secondary danger"
                    onClick={() => run(apiFetch(`${base}/candidates/${c.id}`, { method: 'DELETE' }))}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>

          {!locked && (
            <div className="row">
              <input
                value={candidateDraft[p.id] ?? ''}
                onChange={(e) => setCandidateDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                placeholder="Add candidate name"
              />
              <button
                disabled={!(candidateDraft[p.id] ?? '').trim()}
                onClick={() => {
                  run(
                    apiFetch(`${base}/candidates`, {
                      method: 'POST',
                      body: JSON.stringify({
                        positionId: p.id,
                        name: (candidateDraft[p.id] ?? '').trim(),
                      }),
                    }),
                  );
                  setCandidateDraft((d) => ({ ...d, [p.id]: '' }));
                }}
              >
                Add
              </button>
            </div>
          )}
        </div>
      ))}
      {toast && <p className={toast.kind === 'ok' ? 'ok' : 'error'}>{toast.text}</p>}
    </div>
  );
}

const PAGE = 50;

function VotersTab({
  electionId,
  status,
  reload,
}: {
  electionId: number;
  status: string;
  reload: () => void;
}) {
  const { toast, ok, err } = useToast();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [csv, setCsv] = useState('');
  const [registryQ, setRegistryQ] = useState('');
  const [registry, setRegistry] = useState<{ id: number; matricNumber: string; name: string }[] | null>(
    null,
  );

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
    return `/api/admin/elections/${electionId}/voters?${p.toString()}`;
  }, [electionId, debouncedQ, offset]);

  const { data, error, loading, refreshing, reload: reloadVoters } = useResource<{
    eligible: number;
    voted: number;
    notVoted: number;
    matched: number;
    voters: { id: number; matricNumber: string; name: string; voted: boolean }[];
  }>(url);

  const refreshAll = useCallback(() => {
    reloadVoters();
    reload();
  }, [reloadVoters, reload]);

  async function searchRegistry() {
    const res = await apiFetch<{ voters: typeof registry }>(
      `/api/admin/voters?limit=50${registryQ ? `&q=${encodeURIComponent(registryQ)}` : ''}`,
    );
    if (res.ok) setRegistry(res.data.voters);
    else err(res.message);
  }

  async function post(body: Record<string, unknown>) {
    const res = await apiFetch<{ added: number; createdVoters: number }>(
      `/api/admin/elections/${electionId}/voters`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (res.ok) {
      ok(`Added ${res.data.added}${res.data.createdVoters ? ` (${res.data.createdVoters} new)` : ''}.`);
      refreshAll();
    } else {
      err(res.message);
    }
  }

  async function removeVoter(voterId: number) {
    const res = await apiFetch(`/api/admin/elections/${electionId}/voters/${voterId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      ok('Removed.');
      refreshAll();
    } else {
      err(res.message);
    }
  }

  return (
    <div>
      <div className="card">
        {loading && !data ? (
          <SkeletonCard lines={1} />
        ) : error && !data ? (
          <ErrorState title="Unable to load voters" message={error.message} onRetry={reloadVoters} />
        ) : data ? (
          <div className="row between">
            <p className="big">
              {data.eligible} eligible · {data.voted} voted · {data.notVoted} not yet
            </p>
            <RefreshNote refreshing={refreshing} error={error} onRetry={reloadVoters} />
          </div>
        ) : null}
      </div>

      {status !== 'closed' && (
        <>
          <div className="card">
            <label htmlFor="rq">Add from voter registry</label>
            <div className="row">
              <input
                id="rq"
                value={registryQ}
                onChange={(e) => setRegistryQ(e.target.value)}
                placeholder="Search name or matric"
              />
              <button className="secondary" onClick={searchRegistry}>
                Search
              </button>
            </div>
            {registry && registry.length === 0 && (
              <p className="muted">No matching registry entries.</p>
            )}
            {registry && registry.length > 0 && (
              <>
                <button onClick={() => post({ voterIds: registry.map((r) => r.id) })}>
                  Add all {registry.length} shown
                </button>
                <ul className="candlist">
                  {registry.map((r) => (
                    <li key={r.id} className="row between">
                      <span>
                        {r.name} <span className="muted">({r.matricNumber})</span>
                      </span>
                      <button className="secondary" onClick={() => post({ voterIds: [r.id] })}>
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="card">
            <label htmlFor="csv">Bulk import — one per line: matric,name</label>
            <textarea
              id="csv"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={4}
              placeholder={'CSC/2023/001,John Doe\nCSC/2023/002,Jane Doe'}
            />
            <button disabled={!csv.trim()} onClick={() => post({ csv })}>
              Import
            </button>
            <p className="muted">Adds to the list; never removes existing voters. The whole file is rejected if any row is malformed.</p>
          </div>
        </>
      )}

      <div className="card">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter eligible voters"
          aria-label="Filter eligible voters"
        />
        {loading && !data ? (
          <SkeletonRows rows={6} cols={4} />
        ) : data && data.voters.length === 0 ? (
          <EmptyState
            title={debouncedQ ? 'No voters found' : 'No eligible voters yet'}
            message={
              debouncedQ
                ? 'Try a different matric number or name.'
                : 'Add voters to this election before opening it.'
            }
          />
        ) : data ? (
          <>
            <div className="table-scroll">
              <table className="voters">
                <thead>
                  <tr>
                    <th>Matric</th>
                    <th>Name</th>
                    <th>Voted</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.voters.map((v) => (
                    <tr key={v.id}>
                      <td>{v.matricNumber}</td>
                      <td>{v.name}</td>
                      <td>{v.voted ? 'yes' : 'no'}</td>
                      <td>
                        {!v.voted && status !== 'closed' && (
                          <button className="secondary danger" onClick={() => removeVoter(v.id)}>
                            remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              offset={offset}
              page={PAGE}
              total={data.matched}
              onPage={setOffset}
            />
          </>
        ) : null}
      </div>
      {toast && <p className={toast.kind === 'ok' ? 'ok' : 'error'}>{toast.text}</p>}
    </div>
  );
}

function Pager({
  offset,
  page,
  total,
  onPage,
}: {
  offset: number;
  page: number;
  total: number;
  onPage: (n: number) => void;
}) {
  if (total <= page) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + page, total);
  return (
    <div className="row between">
      <span className="muted">
        {from}–{to} of {total}
      </span>
      <div className="row">
        <button className="secondary" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - page))}>
          Prev
        </button>
        <button className="secondary" disabled={to >= total} onClick={() => onPage(offset + page)}>
          Next
        </button>
      </div>
    </div>
  );
}

function ResultsTab({ electionId }: { electionId: number }) {
  const { toast, ok, err } = useToast();
  const [offset, setOffset] = useState(0);
  const url = `/api/admin/elections/${electionId}/results?limit=${PAGE}&offset=${offset}`;
  const { data, error, loading, refreshing, reload } = useResource<{
    positions: { id: number; name: string; candidates: { id: number; name: string; votes: number }[] }[];
    turnout: { voted: number; total: number; notVoted: number; percent: number };
    participation: {
      total: number;
      voters: { id: number; matric_number: string; name: string; voted: boolean }[];
    };
    generatedAt: string;
  }>(url, { pollMs: 15_000 });
  const [busy, setBusy] = useState(false);

  async function notify() {
    setBusy(true);
    const res = await apiFetch<{ deferred: boolean; message: string }>(
      `/api/admin/elections/${electionId}/notify-results`,
      { method: 'POST' },
    );
    setBusy(false);
    if (res.ok) ok(res.data.message);
    else err(res.message);
  }

  if (loading && !data) {
    return (
      <>
        <SkeletonCard lines={1} />
        <SkeletonCard lines={4} />
      </>
    );
  }
  if (error && !data) {
    return <ErrorState title="Unable to load results" message={error.message} onRetry={reload} />;
  }
  if (!data) return null;

  const noVotes = data.turnout.voted === 0;

  return (
    <div>
      <div className="card">
        <div className="row between">
          <div>
            <p className="big">
              Turnout: {data.turnout.voted} / {data.turnout.total} ({data.turnout.percent.toFixed(1)}%)
            </p>
            <p className="muted">{data.turnout.notVoted} eligible voters have not voted.</p>
          </div>
          <RefreshNote refreshing={refreshing} error={error} onRetry={reload} />
        </div>
      </div>

      {noVotes ? (
        <EmptyState
          title="No votes recorded yet"
          message="Results will appear here once votes are submitted."
        />
      ) : (
        data.positions.map((p) => (
          <div className="card" key={p.id}>
            <h3>{p.name}</h3>
            {p.candidates.length === 0 ? (
              <p className="muted">No candidates.</p>
            ) : (
              <table>
                <tbody>
                  {p.candidates.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td className="num">{c.votes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))
      )}

      <div className="card">
        <h3>Participation</h3>
        <div className="table-scroll">
          <table className="voters">
            <thead>
              <tr>
                <th>Matric</th>
                <th>Name</th>
                <th>Voted</th>
              </tr>
            </thead>
            <tbody>
              {data.participation.voters.map((v) => (
                <tr key={v.id}>
                  <td>{v.matric_number}</td>
                  <td>{v.name}</td>
                  <td>{v.voted ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager offset={offset} page={PAGE} total={data.participation.total} onPage={setOffset} />
        <p className="muted">This list never shows how anyone voted.</p>
      </div>

      <div className="row">
        <button onClick={notify} disabled={busy}>
          {busy ? <Spinner label="Sending" /> : null}
          <span>Send final results email</span>
        </button>
        {toast && <span className={toast.kind === 'ok' ? 'ok' : 'error'}>{toast.text}</span>}
      </div>
    </div>
  );
}

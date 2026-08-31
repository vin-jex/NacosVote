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
} from '@/app/components/states';
import { Button, MessageBlock, StatusBadge } from '@/app/components/ui';
import Link from 'next/link';

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
  eligibilityMode: 'restricted' | 'open';
  maxVoters: number | null;
  resultsPublic: boolean;
  ballotsCast: number;
  ballot: Position[];
  turnout: { voted: number; total: number };
};
type Tab = 'settings' | 'ballot' | 'voters' | 'results';

function fmt(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    : 'Not set';
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
function Toast({ toast }: { toast: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!toast) return null;
  return (
    <p
      className={`mt-4 text-sm font-semibold ${toast.kind === 'ok' ? 'text-accent' : 'text-danger'}`}
      role="status"
    >
      {toast.text}
    </p>
  );
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
      <ErrorState title="Unable to load this election" message={error?.message} onRetry={reload} />
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="page-title">{data.title}</h1>
        <StatusBadge status={data.effectiveStatus} />
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink/70">
        <div>
          <dt className="inline font-semibold text-ink/60">Window: </dt>
          <dd className="inline">
            {fmt(data.votingStart)} to {fmt(data.votingEnd)}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink/60">Voted: </dt>
          <dd className="inline tabular-nums">
            {data.turnout.voted} of {data.turnout.total}
          </dd>
        </div>
      </dl>

      <div className="mt-4 border-b border-line">
        <RefreshNote refreshing={refreshing} error={null} onRetry={reload} />
        <div className="-mb-px flex flex-wrap gap-1" role="tablist">
          {(['settings', 'ballot', 'voters', 'results'] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`min-h-[40px] rounded-t px-3 text-sm font-semibold capitalize transition-colors ${tab === t
                  ? 'border-b-2 border-accent text-ink'
                  : 'text-ink/55 hover:bg-ink/5'
                }`}
            >
              {t === 'ballot' ? 'Positions & candidates' : t === 'voters' ? 'Eligible voters' : t}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {tab === 'settings' && <SettingsTab detail={data} reload={reload} />}
        {tab === 'ballot' && <BallotTab detail={data} reload={reload} />}
        {tab === 'voters' && (
          <VotersTab
            electionId={electionId}
            status={data.status}
            eligibilityMode={data.eligibilityMode}
            maxVoters={data.maxVoters}
            reload={reload}
          />
        )}
        {tab === 'results' && (
          <ResultsTab electionId={electionId} resultsPublic={data.resultsPublic} />
        )}
      </div>
    </>
  );
}

function SettingsTab({ detail, reload }: { detail: Detail; reload: () => void }) {
  const { toast, ok, err } = useToast();
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description ?? '');
  const [start, setStart] = useState(toLocalInput(detail.votingStart));
  const [end, setEnd] = useState(toLocalInput(detail.votingEnd));
  const [mode, setMode] = useState<'restricted' | 'open'>(detail.eligibilityMode);
  const [maxVoters, setMaxVoters] = useState(detail.maxVoters != null ? String(detail.maxVoters) : '');
  const [resultsPublic, setResultsPublic] = useState(detail.resultsPublic);
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
      err('Someone else changed this election. Reloading the latest version.');
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
    <div>
      <p className="position-title">Election details</p>
      <hr className="rule mb-5 mt-2" />

      <div className="mb-4">
        <label htmlFor="s-title" className="field-label">
          Title
        </label>
        <input
          id="s-title"
          className="field-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="mb-4">
        <label htmlFor="s-desc" className="field-label">
          Description
        </label>
        <textarea
          id="s-desc"
          className="field-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>

      <p className="position-title mt-8">Voting period</p>
      <hr className="rule mb-5 mt-2" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="s-start" className="field-label">
            Start
          </label>
          <input
            id="s-start"
            type="datetime-local"
            className="field-input"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="s-end" className="field-label">
            End
          </label>
          <input
            id="s-end"
            type="datetime-local"
            className="field-input"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      <p className="position-title mt-8">Who can vote</p>
      <hr className="rule mb-5 mt-2" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="s-mode" className="field-label">
            Eligibility
          </label>
          <select
            id="s-mode"
            className="field-input"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'restricted' | 'open')}
          >
            <option value="restricted">Restricted to a voter list</option>
            <option value="open">Open (anyone with a matric number and full name)</option>
          </select>
        </div>
        <div>
          <label htmlFor="s-max" className="field-label">
            Maximum ballots (optional)
          </label>
          <input
            id="s-max"
            type="number"
            min={1}
            className="field-input"
            value={maxVoters}
            onChange={(e) => setMaxVoters(e.target.value)}
            placeholder="No limit"
          />
        </div>
      </div>
      <p className="field-hint">
        In open mode a voter still gives their matric number and full name; it is recorded and locked
        to that matric so the roll can be audited afterward. The limit counts ballots actually cast.
      </p>

      <p className="position-title mt-8">Results</p>
      <hr className="rule mb-4 mt-2" />
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-accent"
          checked={resultsPublic}
          onChange={(e) => setResultsPublic(e.target.checked)}
        />
        <span className="text-sm">
          Publish results publicly. Once the election is <strong>closed</strong>, its aggregate tally
          appears at <code>/results/{detail.id}</code> and in the &quot;Published results&quot; list on
          the voter home page. Uncheck any time to remove it. Individual voters and their choices are
          never shown.
        </span>
      </label>
      {resultsPublic && detail.status === 'closed' && (
        <p className="field-hint">
          Live now:{' '}
          <Link href={`/results/${detail.id}`} target="_blank" rel="noreferrer">
            /results/{detail.id}
          </Link>
        </p>
      )}

      <hr className="rule my-6" />

      <div className="flex flex-wrap gap-3">
        <Button
          loading={busy}
          onClick={() =>
            patch({
              title: title.trim(),
              description: description.trim() || null,
              votingStart: start ? new Date(start).toISOString() : null,
              votingEnd: end ? new Date(end).toISOString() : null,
              eligibilityMode: mode,
              maxVoters: maxVoters.trim() === '' ? null : Math.max(1, Math.floor(Number(maxVoters))),
              resultsPublic,
            })
          }
        >
          Save settings
        </Button>
        {(detail.status === 'draft' || detail.status === 'scheduled') && (
          <Button variant="secondary" disabled={busy} onClick={() => patch({ status: 'scheduled' })}>
            Mark scheduled
          </Button>
        )}
        {detail.status !== 'closed' && (
          <Button variant="secondary" disabled={busy} onClick={() => patch({ status: 'open' })}>
            Open now
          </Button>
        )}
        {(detail.status === 'open' || detail.status === 'scheduled') && (
          <Button variant="danger" disabled={busy} onClick={() => patch({ status: 'closed' })}>
            Close now
          </Button>
        )}
        {detail.status === 'draft' && (
          <Button variant="danger" disabled={busy} onClick={remove}>
            Delete draft
          </Button>
        )}
      </div>
      <p className="field-hint">
        A closed election cannot be reopened. The server decides &quot;open&quot; from status plus the
        current time being inside the window.
      </p>
      <Toast toast={toast} />
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
        <div className="mb-5">
          <MessageBlock variant="warn" title="The ballot is frozen">
            {detail.hasVotes
              ? 'Votes have been cast, so positions and candidates can no longer change. Clone the election if you need a different ballot.'
              : 'Positions and candidates can only be edited while the election is a draft or scheduled.'}
          </MessageBlock>
        </div>
      )}

      {!locked && (
        <div className="mb-6">
          <label htmlFor="np" className="field-label">
            Add a position
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="np"
              className="field-input"
              value={newPosition}
              onChange={(e) => setNewPosition(e.target.value)}
              placeholder="For example: President"
            />
            <Button
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
            </Button>
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
        <section key={p.id} className="border-t border-line py-5">
          <div className="flex flex-wrap items-center gap-3">
            <input
              defaultValue={p.name}
              disabled={locked}
              aria-label="Position name"
              className="field-input flex-1"
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
              <div className="flex gap-2">
                <button
                  className="btn-secondary min-h-[40px] px-3"
                  disabled={idx === 0}
                  onClick={() =>
                    run(
                      apiFetch(`${base}/positions/${p.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ displayOrder: idx }),
                      }),
                    )
                  }
                >
                  <span>Move up</span>
                </button>
                <button
                  className="btn-danger min-h-[40px] px-3"
                  onClick={() => run(apiFetch(`${base}/positions/${p.id}`, { method: 'DELETE' }))}
                >
                  <span>Remove</span>
                </button>
              </div>
            )}
          </div>

          {p.candidates.length === 0 && (
            <p className="meta mt-3">No candidates added for this position.</p>
          )}
          <ul className="mt-3 divide-y divide-line">
            {p.candidates.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <input
                  defaultValue={c.name}
                  disabled={locked}
                  aria-label="Candidate name"
                  className="field-input min-h-[38px] flex-1 py-1.5"
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
                    className="btn-danger min-h-[38px] px-3"
                    onClick={() =>
                      run(apiFetch(`${base}/candidates/${c.id}`, { method: 'DELETE' }))
                    }
                  >
                    <span>Remove</span>
                  </button>
                )}
              </li>
            ))}
          </ul>

          {!locked && (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                className="field-input"
                value={candidateDraft[p.id] ?? ''}
                onChange={(e) => setCandidateDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                placeholder="Add candidate name"
              />
              <Button
                variant="secondary"
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
                Add candidate
              </Button>
            </div>
          )}
        </section>
      ))}
      <Toast toast={toast} />
    </div>
  );
}

const PAGE = 50;

function VotersTab({
  electionId,
  status,
  eligibilityMode,
  maxVoters,
  reload,
}: {
  electionId: number;
  status: string;
  eligibilityMode: 'restricted' | 'open';
  maxVoters: number | null;
  reload: () => void;
}) {
  const isOpen = eligibilityMode === 'open';
  const { toast, ok, err } = useToast();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [csv, setCsv] = useState('');
  const [registryQ, setRegistryQ] = useState('');
  const [registry, setRegistry] = useState<
    { id: number; matricNumber: string; name: string }[] | null
  >(null);

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

  const {
    data,
    error,
    loading,
    refreshing,
    reload: reloadVoters,
  } = useResource<{
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
      ok(
        `Added ${res.data.added}${res.data.createdVoters ? ` (${res.data.createdVoters} new)` : ''}.`,
      );
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
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        {loading && !data ? (
          <SkeletonCard lines={1} />
        ) : error && !data ? (
          <ErrorState title="Unable to load voters" message={error.message} onRetry={reloadVoters} />
        ) : data ? (
          <>
            <p className="text-lg font-semibold tabular-nums">
              {isOpen
                ? `${data.voted} ballot${data.voted === 1 ? '' : 's'} cast${maxVoters != null ? ` of ${maxVoters} allowed` : ''
                }`
                : `${data.eligible} eligible, ${data.voted} voted, ${data.notVoted} not yet`}
            </p>
            <RefreshNote refreshing={refreshing} error={error} onRetry={reloadVoters} />
          </>
        ) : null}
      </div>

      {isOpen && (
        <div className="mt-5">
          <MessageBlock variant="info" title="Open election">
            No pre-set list. Anyone who provides a matric number and full name can vote
            {maxVoters != null ? `, up to ${maxVoters} ballots` : ''}. Their details are recorded and
            locked to that matric. The list below is everyone who has voted; change the mode in
            Settings to restrict it.
          </MessageBlock>
        </div>
      )}

      {!isOpen && status !== 'closed' && (
        <>
          <p className="position-title mt-8">Add from voter registry</p>
          <hr className="rule mb-4 mt-2" />
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="rq"
              className="field-input"
              value={registryQ}
              onChange={(e) => setRegistryQ(e.target.value)}
              placeholder="Search name or matric number"
            />
            <Button variant="secondary" onClick={searchRegistry}>
              Search
            </Button>
          </div>
          {registry && registry.length === 0 && (
            <p className="meta mt-3">No matching registry entries.</p>
          )}
          {registry && registry.length > 0 && (
            <div className="mt-3">
              <Button onClick={() => post({ voterIds: registry.map((r) => r.id) })}>
                Add all {registry.length} shown
              </Button>
              <ul className="mt-2 divide-y divide-line">
                {registry.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      {r.name} <span className="text-ink/55">({r.matricNumber})</span>
                    </span>
                    <button
                      className="btn-secondary min-h-[36px] px-3"
                      onClick={() => post({ voterIds: [r.id] })}
                    >
                      <span>Add</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="position-title mt-8">Bulk import</p>
          <hr className="rule mb-4 mt-2" />
          <label htmlFor="csv" className="field-label">
            One voter per line: matric number, then a comma, then the name
          </label>
          <textarea
            id="csv"
            className="field-input"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={4}
            placeholder={'CSC/2023/001,John Doe\nCSC/2023/002,Jane Doe'}
          />
          <div className="mt-3">
            <Button variant="secondary" disabled={!csv.trim()} onClick={() => post({ csv })}>
              Import
            </Button>
          </div>
          <p className="field-hint">
            Adds to the list and never removes existing voters. The whole file is rejected if any row
            is malformed.
          </p>
        </>
      )}

      <p className="position-title mt-8">{isOpen ? 'Who has voted' : 'Eligible voters'}</p>
      <hr className="rule mb-4 mt-2" />
      <input
        className="field-input mb-4"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={isOpen ? 'Filter by matric number or name' : 'Filter eligible voters'}
        aria-label="Filter voters"
      />
      {loading && !data ? (
        <SkeletonRows rows={6} cols={4} />
      ) : data && data.voters.length === 0 ? (
        <EmptyState
          title={debouncedQ ? 'No voters found' : isOpen ? 'No ballots cast yet' : 'No eligible voters yet'}
          message={
            debouncedQ
              ? 'Try a different matric number or name.'
              : isOpen
                ? 'People appear here as they vote.'
                : 'Add voters to this election before opening it.'
          }
        />
      ) : data ? (
        <>
          <div className="table-scroll">
            <table className="w-full border-t border-line text-sm">
              <thead>
                <tr className="text-left text-ink/60">
                  <th className="py-2 pr-3 font-semibold">Matric</th>
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Voted</th>
                  <th className="py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {data.voters.map((v) => (
                  <tr key={v.id} className="border-t border-line">
                    <td className="py-2 pr-3">{v.matricNumber}</td>
                    <td className="py-2 pr-3">{v.name}</td>
                    <td className="py-2 pr-3">{v.voted ? 'Yes' : 'No'}</td>
                    <td className="py-2 text-right">
                      {!v.voted && status !== 'closed' && (
                        <button
                          className="btn-danger min-h-[34px] px-2.5"
                          onClick={() => removeVoter(v.id)}
                        >
                          <span>Remove</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} page={PAGE} total={data.matched} onPage={setOffset} />
        </>
      ) : null}
      <Toast toast={toast} />
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
    <div className="mt-4 flex items-center justify-between">
      <span className="meta tabular-nums">
        {from} to {to} of {total}
      </span>
      <div className="flex gap-2">
        <button
          className="btn-secondary min-h-[36px] px-3"
          disabled={offset === 0}
          onClick={() => onPage(Math.max(0, offset - page))}
        >
          <span>Previous</span>
        </button>
        <button
          className="btn-secondary min-h-[36px] px-3"
          disabled={to >= total}
          onClick={() => onPage(offset + page)}
        >
          <span>Next</span>
        </button>
      </div>
    </div>
  );
}

function ResultsTab({
  electionId,
  resultsPublic,
}: {
  electionId: number;
  resultsPublic: boolean;
}) {
  const { toast, ok, err } = useToast();
  const [offset, setOffset] = useState(0);
  const url = `/api/admin/elections/${electionId}/results?limit=${PAGE}&offset=${offset}`;
  const { data, error, loading, refreshing, reload } = useResource<{
    positions: {
      id: number;
      name: string;
      candidates: { id: number; name: string; votes: number }[];
    }[];
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
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="kicker">Turnout</p>
          <p className="mt-1 font-serif text-2xl tabular-nums">
            {data.turnout.voted} of {data.turnout.total}
          </p>
          <p className="meta tabular-nums">
            {data.turnout.percent.toFixed(1)}% voted. {data.turnout.notVoted} have not voted.
          </p>
        </div>
        <RefreshNote refreshing={refreshing} error={error} onRetry={reload} />
      </div>

      <p className="position-title mt-8">Results</p>
      <hr className="rule mb-2 mt-2" />

      {noVotes ? (
        <EmptyState
          title="No votes recorded"
          message="Election results will appear once votes are submitted."
        />
      ) : (
        data.positions.map((p) => (
          <section key={p.id} className="border-t border-line py-5 first:border-t-0">
            <h3 className="position-title text-base">{p.name}</h3>
            {p.candidates.length === 0 ? (
              <p className="meta mt-2">No candidates.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {p.candidates.map((c) => (
                    <tr key={c.id} className="border-b border-line last:border-b-0">
                      <td className="py-2">{c.name}</td>
                      <td className="py-2 text-right font-semibold tabular-nums">{c.votes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))
      )}

      <p className="position-title mt-8">Voter participation</p>
      <hr className="rule mb-2 mt-2" />
      <div className="table-scroll">
        <table className="w-full border-t border-line text-sm">
          <thead>
            <tr className="text-left text-ink/60">
              <th className="py-2 pr-3 font-semibold">Matric</th>
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.participation.voters.map((v) => (
              <tr key={v.id} className="border-t border-line">
                <td className="py-2 pr-3">{v.matric_number}</td>
                <td className="py-2 pr-3">{v.name}</td>
                <td className="py-2">{v.voted ? 'Voted' : 'Not voted'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager offset={offset} page={PAGE} total={data.participation.total} onPage={setOffset} />
      <p className="field-hint">This list never shows how anyone voted.</p>

      <hr className="rule my-6" />
      <div className="flex flex-wrap items-center gap-4">
        <Link
          href={`/admin/elections/${electionId}/results-print`}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary no-underline"
        >
          <span>Printable results sheet</span>
        </Link>
        <Button variant="secondary" loading={busy} onClick={notify}>
          Send final results email
        </Button>
      </div>
      <p className="field-hint">
        {resultsPublic
          ? 'Results are set to publish publicly (once closed). Change this in Settings.'
          : 'Results are private. Turn on public results in Settings to share them at /results/' +
          electionId +
          '.'}
      </p>
      <Toast toast={toast} />
    </div>
  );
}

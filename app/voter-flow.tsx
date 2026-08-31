'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { apiFetch, apiGetWithRetry } from '@/lib/client/api';
import { EmptyState, ErrorState, Spinner } from './components/states';

type OpenElection = { id: number; title: string; votingEnd: string | null };
type Candidate = { id: number; name: string };
type Position = { id: number; name: string; candidates: Candidate[] };
type Step = 'pick' | 'identify' | 'confirm' | 'ballot' | 'done' | 'uncertain';

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function VoterFlow({ initialElections }: { initialElections: OpenElection[] | null }) {
  const online = useOnline();

  const [elections, setElections] = useState<OpenElection[] | null>(initialElections);
  const [loadFailed, setLoadFailed] = useState(initialElections === null);
  const [reloading, setReloading] = useState(false);

  const [electionId, setElectionId] = useState<number | null>(null);
  const [step, setStep] = useState<Step>('pick');
  const [matricNumber, setMatricNumber] = useState('');
  const [name, setName] = useState('');
  const [verifiedName, setVerifiedName] = useState('');
  const [verifiedMatric, setVerifiedMatric] = useState('');
  const [electionTitle, setElectionTitle] = useState('');
  const [electionEnd, setElectionEnd] = useState<string | null>(null);
  const [ballot, setBallot] = useState<Position[]>([]);
  const [selections, setSelections] = useState<Record<number, number>>({});
  // One key per verified ballot: reused across retries so the server can dedupe.
  const [idemKey, setIdemKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Reconcile initial state once elections are known.
  useEffect(() => {
    if (!elections) return;
    if (elections.length === 1) {
      setElectionId(elections[0].id);
      setStep((s) => (s === 'pick' ? 'identify' : s));
    }
  }, [elections]);

  const chosen = useMemo(
    () => elections?.find((e) => e.id === electionId) ?? null,
    [elections, electionId],
  );
  const allAnswered = useMemo(
    () => ballot.length > 0 && ballot.every((p) => selections[p.id] != null),
    [ballot, selections],
  );

  const reloadElections = useCallback(async () => {
    setReloading(true);
    const res = await apiGetWithRetry<{ elections: OpenElection[] }>('/api/elections/open');
    setReloading(false);
    if (res.ok) {
      setElections(res.data.elections);
      setLoadFailed(false);
      setStep(res.data.elections.length === 1 ? 'identify' : 'pick');
    } else {
      setLoadFailed(true);
    }
  }, []);

  function restart() {
    setStep(elections && elections.length === 1 ? 'identify' : 'pick');
    setMatricNumber('');
    setName('');
    setVerifiedName('');
    setVerifiedMatric('');
    setBallot([]);
    setSelections({});
    setIdemKey('');
    setError('');
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!electionId) return;
    setError('');
    setBusy(true);
    const res = await apiFetch<{
      status: string;
      voter?: { name: string; matricNumber: string };
      election?: { title: string; votingEnd: string | null };
      ballot?: Position[];
    }>('/api/vote/verify', {
      method: 'POST',
      body: JSON.stringify({ matricNumber: matricNumber.trim(), name: name.trim(), electionId }),
      timeoutMs: 12_000,
    });
    setBusy(false);

    if (!res.ok) {
      if (res.status === 429) setError('Too many attempts. Please wait a minute and try again.');
      else if (res.status === 503)
        setError('The voting service is temporarily unavailable. Your details were not submitted.');
      else if (res.code === 'TIMEOUT' || res.code === 'NETWORK') setError(res.message);
      else setError(res.message);
      return;
    }

    const data = res.data;
    if (data.status === 'ok' && data.voter && data.election && data.ballot) {
      setVerifiedName(data.voter.name);
      setVerifiedMatric(data.voter.matricNumber);
      setElectionTitle(data.election.title);
      setElectionEnd(data.election.votingEnd);
      setBallot(data.ballot);
      setSelections({});
      setIdemKey(newKey());
      setStep('confirm');
    } else if (data.status === 'already-voted') {
      setError('A vote has already been recorded for this voter in this election.');
    } else if (data.status === 'not-open') {
      setError('This election is not open for voting right now.');
    } else {
      setError('We could not verify you for this election. Check your matric number and full name.');
    }
  }

  async function submit() {
    if (!electionId || !idemKey) return;
    setError('');
    setBusy(true);
    const res = await apiFetch<{ status: string }>('/api/vote/submit', {
      method: 'POST',
      body: JSON.stringify({
        matricNumber: matricNumber.trim(),
        name: name.trim(),
        electionId,
        idempotencyKey: idemKey,
        selections: Object.entries(selections).map(([positionId, candidateId]) => ({
          positionId: Number(positionId),
          candidateId,
        })),
      }),
      timeoutMs: 20_000,
    });
    setBusy(false);

    if (res.ok && res.data.status === 'recorded') {
      setSelections({});
      setStep('done');
      return;
    }
    if (!res.ok && res.timedOut) {
      // The server may have committed. Never claim failure; offer a safe check.
      setStep('uncertain');
      return;
    }
    if (!res.ok && res.status === 409 && res.code === 'ALREADY_VOTED') {
      // Most likely our own earlier attempt succeeded.
      setStep('done');
      return;
    }
    if (!res.ok && res.status === 403) {
      setError('Voting has closed for this election.');
      return;
    }
    if (!res.ok && res.code === 'INVALID_BALLOT') {
      setError('Your ballot was not accepted. Please reload the page and vote again.');
      return;
    }
    setError(res.ok ? 'Unexpected response. Please try again.' : res.message);
  }

  async function checkStatus() {
    if (!electionId) return;
    setBusy(true);
    setError('');
    const res = await apiFetch<{ status: string }>('/api/vote/verify', {
      method: 'POST',
      body: JSON.stringify({ matricNumber: matricNumber.trim(), name: name.trim(), electionId }),
    });
    setBusy(false);
    if (res.ok && res.data.status === 'already-voted') {
      setStep('done');
    } else if (res.ok && res.data.status === 'ok') {
      setError('Your vote was not recorded. You can submit it again.');
      setStep('ballot');
    } else if (res.ok && res.data.status === 'not-open') {
      setError('Voting has closed. If you submitted before the deadline your vote may still count.');
    } else {
      setError('Could not check your status right now. Please try again shortly.');
    }
  }

  // ---- render -------------------------------------------------------------

  return (
    <main aria-live="polite">
      <h1>NacosVote</h1>
      <p className="muted">Secret ballot — your identity is never linked to your choices.</p>

      {!online && (
        <div className="banner closed" role="alert">
          <strong>You&apos;re offline.</strong> Check your internet connection and try again.
        </div>
      )}

      {loadFailed && (
        <ErrorState
          title="Voting information is temporarily unavailable"
          message="We couldn't load the current elections. Please try again shortly."
          onRetry={reloadElections}
        />
      )}
      {reloading && <Spinner label="Loading elections" />}

      {!loadFailed && elections && elections.length === 0 && (
        <EmptyState
          title="No election is currently open"
          message="There is no active voting session right now. Check back later."
        />
      )}

      {!loadFailed && elections && elections.length > 0 && step === 'pick' && (
        <div>
          <div className="banner open">Choose the election you are here to vote in.</div>
          <label htmlFor="election">Election</label>
          <select
            id="election"
            value={electionId ?? ''}
            onChange={(e) => setElectionId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Select an election…</option>
            {elections.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <button disabled={!electionId} onClick={() => setStep('identify')}>
            Continue
          </button>
        </div>
      )}

      {step === 'identify' && chosen && (
        <form onSubmit={verify}>
          <div className="banner open">
            <strong>{chosen.title}</strong>
            {chosen.votingEnd ? <div>Voting closes {fmtTime(chosen.votingEnd)}</div> : null}
          </div>
          <label htmlFor="matric">Matriculation / registration number</label>
          <input
            id="matric"
            value={matricNumber}
            onChange={(e) => setMatricNumber(e.target.value)}
            autoComplete="off"
            required
          />
          <label htmlFor="fullname">Full name</label>
          <input
            id="fullname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            required
          />
          <div className="row">
            <button type="submit" disabled={busy || !matricNumber.trim() || !name.trim()}>
              {busy ? <Spinner label="Verifying" /> : null}
              <span>Verify &amp; continue</span>
            </button>
            {elections && elections.length > 1 && (
              <button type="button" className="secondary" onClick={() => setStep('pick')}>
                Back
              </button>
            )}
          </div>
        </form>
      )}

      {step === 'confirm' && (
        <div>
          <div className="banner open">
            <strong>{electionTitle}</strong>
            {electionEnd ? <div>Voting closes {fmtTime(electionEnd)}</div> : null}
          </div>
          <p>Continue as</p>
          <p className="name">{verifiedName}</p>
          <p className="muted">Matric number: {verifiedMatric}</p>
          <div className="row">
            <button onClick={() => setStep('ballot')}>Continue</button>
            <button className="secondary" onClick={restart}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'ballot' && (
        <div>
          <div className="banner open">
            <strong>{electionTitle}</strong>
          </div>
          {ballot.map((p) => (
            <fieldset key={p.id}>
              <legend>{p.name}</legend>
              {p.candidates.length === 0 && <p className="muted">No candidates for this position.</p>}
              {p.candidates.map((c) => (
                <label key={c.id} className="opt">
                  <input
                    type="radio"
                    name={`pos-${p.id}`}
                    checked={selections[p.id] === c.id}
                    onChange={() => setSelections((s) => ({ ...s, [p.id]: c.id }))}
                  />
                  {c.name}
                </label>
              ))}
            </fieldset>
          ))}
          <button onClick={submit} disabled={busy || !allAnswered || !online}>
            {busy ? <Spinner label="Submitting" /> : null}
            <span>Submit vote</span>
          </button>
          {!allAnswered && <p className="muted">Select one candidate for every position.</p>}
        </div>
      )}

      {step === 'uncertain' && (
        <div className="state">
          <p className="state-title">We couldn&apos;t confirm the result of your submission</p>
          <p>Do not submit another ballot yet. Your selections are still here.</p>
          <div className="row">
            <button onClick={checkStatus} disabled={busy}>
              {busy ? <Spinner label="Checking" /> : null}
              <span>Check vote status</span>
            </button>
            <button className="secondary" onClick={() => setStep('ballot')} disabled={busy}>
              Back to ballot
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="done">
          <h2>✓ Vote recorded</h2>
          <p>Your vote has been successfully recorded.</p>
          <p>You cannot vote again in this election.</p>
          <p className="muted">Thank you.</p>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

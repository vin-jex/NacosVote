'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { apiFetch, apiGetWithRetry } from '@/lib/client/api';
import { EmptyState, ErrorState, Spinner } from './components/states';
import { Button, CandidateOption, MessageBlock, SectionRule, StatusBadge } from './components/ui';
import { Brand } from './components/brand';

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
      setStep('uncertain');
      return;
    }
    if (!res.ok && res.status === 409 && res.code === 'ALREADY_VOTED') {
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

  return (
    <main className="mx-auto w-full max-w-[620px]">
      <Brand
        title="NacosVote"
        subtitle={electionTitle && step !== 'pick' ? electionTitle : undefined}
      />

      <p className="meta">
        Your vote is secret. Your identity is not linked to your candidate selections, and it can
        only be submitted once for this election.
      </p>

      <SectionRule />

      {!online && (
        <div className="mb-4">
          <MessageBlock variant="warn" title="You are offline">
            Check your internet connection, then try again.
          </MessageBlock>
        </div>
      )}

      {loadFailed && (
        <ErrorState
          title="Voting information is temporarily unavailable"
          message="We could not load the current elections. Please try again shortly."
          onRetry={reloadElections}
        />
      )}
      {reloading && (
        <p className="meta flex items-center gap-2">
          <Spinner label="Loading elections" /> Loading elections
        </p>
      )}

      {!loadFailed && elections && elections.length === 0 && (
        <EmptyState
          title="No election is currently open"
          message="There is no active voting session right now. Check back when voting begins."
        />
      )}

      {!loadFailed && elections && elections.length > 0 && step === 'pick' && (
        <div>
          <p className="section-title">Select your election</p>
          <p className="meta mt-1">More than one election is open. Choose the one you are here to vote in.</p>
          <div className="mt-4">
            <label htmlFor="election" className="field-label">
              Election
            </label>
            <select
              id="election"
              className="field-input"
              value={electionId ?? ''}
              onChange={(e) => setElectionId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Select an election</option>
              {elections.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </div>
          <Button className="mt-5" block disabled={!electionId} onClick={() => setStep('identify')}>
            Continue
          </Button>
        </div>
      )}

      {step === 'identify' && chosen && (
        <form onSubmit={verify}>
          <div className="mb-5">
            <p className="section-title">{chosen.title}</p>
            <div className="mt-2">
              <StatusBadge
                status="open"
                detail={chosen.votingEnd ? `Closes ${fmtTime(chosen.votingEnd)}` : undefined}
              />
            </div>
          </div>

          <p className="position-title">Voter verification</p>
          <hr className="rule mb-4 mt-2" />

          <div className="mb-4">
            <label htmlFor="matric" className="field-label">
              Matriculation number
            </label>
            <input
              id="matric"
              className="field-input"
              value={matricNumber}
              onChange={(e) => setMatricNumber(e.target.value)}
              autoComplete="off"
              inputMode="text"
              required
            />
          </div>
          <div className="mb-5">
            <label htmlFor="fullname" className="field-label">
              Full name
            </label>
            <input
              id="fullname"
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              loading={busy}
              disabled={!matricNumber.trim() || !name.trim()}
            >
              Verify and continue
            </Button>
            {elections && elections.length > 1 && (
              <Button type="button" variant="secondary" onClick={() => setStep('pick')}>
                Back
              </Button>
            )}
          </div>
        </form>
      )}

      {step === 'confirm' && (
        <div>
          <div className="mb-5">
            <StatusBadge
              status="open"
              detail={electionEnd ? `Closes ${fmtTime(electionEnd)}` : undefined}
            />
          </div>
          <p className="kicker">Continue as</p>
          <p className="page-title mt-1">{verifiedName}</p>
          <p className="meta mt-1">{verifiedMatric}</p>
          <hr className="rule my-5" />
          <p className="text-sm text-ink/75">If this is not you, go back and check your details.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => setStep('ballot')}>Continue to ballot</Button>
            <Button variant="secondary" onClick={restart}>
              Not you
            </Button>
          </div>
        </div>
      )}

      {step === 'ballot' && (
        <div>
          <div className="mb-4">
            <StatusBadge
              status="open"
              detail={electionEnd ? `Closes ${fmtTime(electionEnd)}` : undefined}
            />
          </div>

          {ballot.map((p) => (
            <section key={p.id} className="mb-2">
              <hr className="rule my-5" />
              <h2 className="position-title">{p.name}</h2>
              <p className="meta mt-1">Select one candidate.</p>
              <div className="mt-3">
                {p.candidates.length === 0 ? (
                  <p className="meta">No candidates are configured for this position.</p>
                ) : (
                  p.candidates.map((c) => (
                    <CandidateOption
                      key={c.id}
                      name={`pos-${p.id}`}
                      value={c.id}
                      candidate={c.name}
                      checked={selections[p.id] === c.id}
                      onChange={() => setSelections((s) => ({ ...s, [p.id]: c.id }))}
                    />
                  ))
                )}
              </div>
            </section>
          ))}

          <hr className="rule my-5" />

          {!allAnswered && (
            <div className="mb-4">
              <MessageBlock variant="warn">
                Select one candidate for every position before submitting.
              </MessageBlock>
            </div>
          )}

          <Button block loading={busy} disabled={!allAnswered || !online} onClick={submit}>
            Submit vote
          </Button>
        </div>
      )}

      {step === 'uncertain' && (
        <div>
          <hr className="rule my-5" />
          <p className="section-title">We could not confirm your submission</p>
          <p className="mt-2 text-sm text-ink/80">
            Do not submit another ballot yet. Your selections are still on this page. Check your vote
            status to see whether it was recorded.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button loading={busy} onClick={checkStatus}>
              Check vote status
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setStep('ballot')}>
              Back to ballot
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div>
          <hr className="rule my-6" />
          <p className="kicker text-accent">Vote recorded</p>
          <h2 className="page-title mt-1">Your ballot has been recorded</h2>
          <p className="mt-3 text-sm text-ink/80">
            Your vote is secret. Your identity is not stored with your candidate selections.
          </p>
          <p className="mt-2 text-sm text-ink/80">You cannot vote again in this election.</p>
          <hr className="rule my-6" />
          <p className="meta">Thank you for participating.</p>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <MessageBlock variant="error" title="There was a problem">
            {error}
          </MessageBlock>
        </div>
      )}
    </main>
  );
}

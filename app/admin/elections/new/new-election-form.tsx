'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client/api';
import { Spinner } from '@/app/components/states';

export default function NewElectionForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [votingStart, setVotingStart] = useState('');
  const [votingEnd, setVotingEnd] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const res = await apiFetch<{ id: number }>('/api/admin/elections', {
      method: 'POST',
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || null,
        votingStart: votingStart ? new Date(votingStart).toISOString() : null,
        votingEnd: votingEnd ? new Date(votingEnd).toISOString() : null,
      }),
    });
    setBusy(false);
    if (res.ok) router.push(`/admin/elections/${res.data.id}`);
    else setError(res.message);
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="title">Title</label>
      <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />

      <label htmlFor="desc">Description (optional)</label>
      <textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />

      <label htmlFor="start">Voting start</label>
      <input
        id="start"
        type="datetime-local"
        value={votingStart}
        onChange={(e) => setVotingStart(e.target.value)}
      />

      <label htmlFor="end">Voting end</label>
      <input
        id="end"
        type="datetime-local"
        value={votingEnd}
        onChange={(e) => setVotingEnd(e.target.value)}
      />

      <div className="row">
        <button type="submit" disabled={busy || !title.trim()}>
          {busy ? <Spinner label="Creating" /> : null}
          <span>Create</span>
        </button>
        <button type="button" className="secondary" onClick={() => router.push('/admin')}>
          Cancel
        </button>
      </div>
      <p className="muted">
        The election starts as a draft. Configure the ballot and eligible voters, then open it.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

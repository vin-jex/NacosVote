'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client/api';
import { Button, MessageBlock } from '@/app/components/ui';

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
      <p className="position-title">Election details</p>
      <hr className="rule mb-5 mt-2" />

      <div className="mb-4">
        <label htmlFor="title" className="field-label">
          Title
        </label>
        <input
          id="title"
          className="field-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <div className="mb-4">
        <label htmlFor="desc" className="field-label">
          Description
        </label>
        <textarea
          id="desc"
          className="field-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
        <p className="field-hint">Optional.</p>
      </div>

      <p className="position-title mt-8">Voting period</p>
      <hr className="rule mb-5 mt-2" />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="start" className="field-label">
            Start
          </label>
          <input
            id="start"
            type="datetime-local"
            className="field-input"
            value={votingStart}
            onChange={(e) => setVotingStart(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="end" className="field-label">
            End
          </label>
          <input
            id="end"
            type="datetime-local"
            className="field-input"
            value={votingEnd}
            onChange={(e) => setVotingEnd(e.target.value)}
          />
        </div>
      </div>

      <hr className="rule my-6" />

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy} disabled={!title.trim()}>
          Create election
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push('/admin')}>
          Cancel
        </Button>
      </div>
      <p className="field-hint">
        The election starts as a draft. Configure the ballot and eligible voters, then open it.
      </p>

      {error && (
        <div className="mt-4">
          <MessageBlock variant="error" title="Could not create the election">
            {error}
          </MessageBlock>
        </div>
      )}
    </form>
  );
}

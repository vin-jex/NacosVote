'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { signOut } from 'next-auth/react';
import { apiFetch } from '@/lib/client/api';
import { Button, MessageBlock } from '@/app/components/ui';

export default function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (next !== confirm) {
      setError('The new password and confirmation do not match.');
      return;
    }
    if (!window.confirm('Change your admin password now? You will be signed out and must log in again with the new password.')) {
      return;
    }
    setBusy(true);
    const res = await apiFetch('/api/admin/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } else {
      setError(res.message);
    }
  }

  if (done) {
    return (
      <div>
        <MessageBlock variant="info" title="Password changed">
          Your password has been updated. Sign in again with the new password.
        </MessageBlock>
        <Button className="mt-4" onClick={() => signOut({ callbackUrl: '/admin/login' })}>
          Sign out now
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="mb-4">
        <label htmlFor="cp" className="field-label">
          Current password
        </label>
        <input
          id="cp"
          type="password"
          className="field-input"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <div className="mb-4">
        <label htmlFor="np" className="field-label">
          New password
        </label>
        <input
          id="np"
          type="password"
          className="field-input"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={10}
          required
        />
        <p className="field-hint">At least 10 characters.</p>
      </div>
      <div className="mb-5">
        <label htmlFor="cf" className="field-label">
          Confirm new password
        </label>
        <input
          id="cf"
          type="password"
          className="field-input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>
      <Button type="submit" loading={busy} disabled={!current || next.length < 10 || !confirm}>
        Update password
      </Button>
      {error && (
        <div className="mt-4">
          <MessageBlock variant="error" title="Could not change the password">
            {error}
          </MessageBlock>
        </div>
      )}
    </form>
  );
}

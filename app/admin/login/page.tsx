'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button, MessageBlock } from '@/app/components/ui';
import { Brand } from '@/app/components/brand';

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const res = await signIn('credentials', { email, password, redirect: false });
    setBusy(false);
    if (res?.ok) {
      router.push('/admin');
      router.refresh();
    } else {
      setError('Invalid email or password, or too many attempts. Wait a few minutes and try again.');
    }
  }

  return (
    <main className="mx-auto w-full max-w-sm">
      <Brand title="Election administration" motto />
      <p className="meta">Sign in to manage elections.</p>
      <hr className="rule my-6" />

      <form onSubmit={onSubmit}>
        <div className="mb-4">
          <label htmlFor="email" className="field-label">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="field-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
        </div>
        <div className="mb-5">
          <label htmlFor="password" className="field-label">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="field-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <Button type="submit" block loading={busy}>
          Sign in
        </Button>
      </form>

      {error && (
        <div className="mt-4">
          <MessageBlock variant="error" title="Sign in failed">
            {error}
          </MessageBlock>
        </div>
      )}
    </main>
  );
}

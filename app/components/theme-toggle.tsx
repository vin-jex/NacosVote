'use client';

import { useEffect, useState } from 'react';

type Mode = 'system' | 'light' | 'dark';
const KEY = 'nacosvote-theme';
const MODES: Mode[] = ['system', 'light', 'dark'];

function apply(mode: Mode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem(KEY) as Mode | null) ?? 'system';
    setMode(MODES.includes(stored) ? stored : 'system');
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    apply(mode);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => mode === 'system' && apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode, ready]);

  function choose(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: fall back to session-only */
    }
  }

  return (
    <div
      className="inline-flex overflow-hidden rounded border border-line text-xs"
      role="group"
      aria-label="Appearance"
    >
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => choose(m)}
          aria-pressed={ready && mode === m}
          className={`min-h-[32px] px-2.5 font-semibold capitalize transition-colors ${
            ready && mode === m
              ? 'bg-accent text-white'
              : 'bg-transparent text-ink/70 hover:bg-ink/5'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

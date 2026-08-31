'use client';

import type { ReactNode } from 'react';

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

export function SkeletonLine({ w = '100%', className = '' }: { w?: string; className?: string }) {
  return (
    <span
      className={`skeleton my-2 h-[0.85rem] ${className}`}
      style={{ width: w }}
      aria-hidden="true"
    />
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="border-t border-line py-5" aria-hidden="true">
      <SkeletonLine w="45%" className="h-4" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} w={`${90 - i * 12}%`} />
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 5, cols = 3 }: { rows?: number; cols?: number }) {
  return (
    <div aria-hidden="true" className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonLine key={c} w={c === 0 ? '32%' : '20%'} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="msg-error my-4" role="alert">
      <p className="msg-title">{title}</p>
      {message && <p className="mt-1 text-ink/75">{message}</p>}
      {onRetry && (
        <button className="btn-secondary mt-3" onClick={onRetry}>
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-y border-line py-10 text-center">
      <p className="section-title">{title}</p>
      {message && <p className="meta mx-auto mt-1 max-w-sm">{message}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function RefreshNote({
  refreshing,
  error,
  onRetry,
}: {
  refreshing: boolean;
  error: { message: string } | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger" role="status">
        Could not refresh.
        <button className="font-semibold underline underline-offset-2" onClick={onRetry}>
          Retry
        </button>
      </span>
    );
  }
  if (refreshing) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink/55" role="status">
        <span className="spinner spinner-sm" aria-hidden="true" /> updating
      </span>
    );
  }
  return null;
}

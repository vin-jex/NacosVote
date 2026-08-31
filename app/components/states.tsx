'use client';

import type { ReactNode } from 'react';

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

export function SkeletonLine({ w = '100%' }: { w?: string }) {
  return <span className="skeleton skeleton-line" style={{ width: w }} aria-hidden="true" />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card" aria-hidden="true">
      <SkeletonLine w="45%" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} w={`${90 - i * 12}%`} />
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 5, cols = 3 }: { rows?: number; cols?: number }) {
  return (
    <table aria-hidden="true">
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c}>
                <SkeletonLine w={c === 0 ? '80%' : '50%'} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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
    <div className="state state-error" role="alert">
      <p className="state-title">{title}</p>
      {message && <p className="muted">{message}</p>}
      {onRetry && (
        <button className="secondary" onClick={onRetry}>
          Retry
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
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {message && <p className="muted">{message}</p>}
      {action}
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
      <span className="refresh-note error" role="status">
        Couldn&apos;t refresh.{' '}
        <button className="linkbtn" onClick={onRetry}>
          Retry
        </button>
      </span>
    );
  }
  if (refreshing) {
    return (
      <span className="refresh-note muted" role="status">
        <span className="spinner sm" aria-hidden="true" /> updating…
      </span>
    );
  }
  return null;
}

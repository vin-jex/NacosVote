'use client';

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main>
      <div className="state state-error" role="alert">
        <p className="state-title">This section couldn&apos;t load</p>
        <p className="muted">A dependency may be temporarily unavailable.</p>
        <button className="secondary" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}

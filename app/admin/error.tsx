'use client';

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main>
      <div className="msg-error" role="alert">
        <p className="msg-title">This section could not load</p>
        <p className="mt-1 text-ink/75">A dependency may be temporarily unavailable.</p>
        <button className="btn-secondary mt-3" onClick={reset}>
          <span>Try again</span>
        </button>
      </div>
    </main>
  );
}

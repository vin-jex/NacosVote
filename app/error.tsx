'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main>
      <h1>NacosVote</h1>
      <div className="state state-error" role="alert">
        <p className="state-title">This page hit a problem</p>
        <p className="muted">
          The service may be temporarily unavailable. Your information has not been submitted.
        </p>
        <button className="secondary" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}

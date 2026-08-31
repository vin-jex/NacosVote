'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-[620px]">
      <p className="kicker">NACOS · UNIZIK</p>
      <h1 className="page-title mt-1">NacosVote</h1>
      <div className="msg-error mt-6" role="alert">
        <p className="msg-title">This page hit a problem</p>
        <p className="mt-1 text-ink/75">
          The service may be temporarily unavailable. Your information has not been submitted.
        </p>
        <button className="btn-secondary mt-3" onClick={reset}>
          <span>Try again</span>
        </button>
      </div>
    </main>
  );
}

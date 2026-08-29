"use client";

export default function CopyTradingDashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="panel max-w-lg w-full p-6 space-y-4">
        <div>
          <span className="eyebrow">Dashboard interrupted</span>
          <h1 className="font-display text-2xl font-semibold mt-2">
            The dashboard could not load
          </h1>
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          This is usually caused by a temporary network or database connection issue.
          Retry once the connection stabilizes.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="w-full font-display font-semibold text-sm py-2.5 bg-[var(--text)] text-[var(--bg)]"
        >
          Retry dashboard
        </button>
      </div>
    </main>
  );
}

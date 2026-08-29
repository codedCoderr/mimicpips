"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

function VerifyEmailContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [error, setError] = useState<string | null>(null);
  
  // Track if the request has been fired to prevent Strict Mode double-fetching
  const hasAttempted = useRef(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setStatus("error");
      setError("No verification token was provided.");
      return;
    }

    // Abort if we have already made the API call
    if (hasAttempted.current) return;
    hasAttempted.current = true;

    fetch(`/api/saas/verify-email?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setStatus("error");
          setError(data?.error ?? "Verification failed.");
          return;
        }
        setStatus("success");
        redirectTimer.current = setTimeout(() => router.push("/app/dashboard"), 2000);
      })
      .catch(() => {
        setStatus("error");
        setError("Could not reach the server.");
      });

    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, [params, router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="flex flex-col items-center gap-4 text-center max-w-[400px]">
        {status === "verifying" && (
          <>
            <Loader2 size={32} className="animate-spin text-[var(--muted)]" />
            <p className="font-mono text-sm text-[var(--muted)]" aria-live="polite">Verifying your email…</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle2 size={32} color="var(--long)" />
            <p className="font-display text-lg font-semibold">Email verified</p>
            <p className="font-mono text-sm text-[var(--muted)]" aria-live="polite">Taking you to your dashboard…</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle size={32} color="var(--short)" />
            <p className="font-display text-lg font-semibold">Verification failed</p>
            <p role="alert" className="font-mono text-sm text-[var(--muted)]">{error}</p>
            <button
              onClick={() => router.push("/app/dashboard")}
              className="mt-2 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] underline"
            >
              Go to dashboard
            </button>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}

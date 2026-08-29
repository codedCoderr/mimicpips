"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";

function CallbackContent() {
  const router = useRouter();
  const [message, setMessage] = useState("Confirming your payment…");

  useEffect(() => {
    // Paystack's webhook is the actual source of truth for payment
    // status — this redirect just tells the user what to expect. A
    // short delay gives the webhook a moment to land before sending them
    // on, since it's usually near-instant but not guaranteed to beat the
    // browser redirect.
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      setMessage("Payment received. Redirecting…");
      redirectTimer = setTimeout(() => router.push("/app/billing"), 1200);
    }, 1500);

    return () => {
      clearTimeout(timer);
      if (redirectTimer) clearTimeout(redirectTimer);
    };
  }, [router]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <CheckCircle2 size={32} color="var(--long)" />
        <p className="font-mono text-sm text-[var(--muted)] flex items-center gap-2" aria-live="polite">
          <Loader2 size={14} className="animate-spin" />
          {message}
        </p>
      </div>
    </main>
  );
}

export default function BillingCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackContent />
    </Suspense>
  );
}

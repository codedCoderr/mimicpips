"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loadSession } from "@/lib/session";

function safeNextPath(value: string | null): string | null {
  if (!value) return null;
  return value === "/setup" || value === "/dashboard" || value.startsWith("/dashboard/")
    ? value
    : null;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Login failed.");
        return;
      }

      const next = safeNextPath(params.get("next"));
      const hasBotConnection = !!loadSession();
      router.push(next ?? (hasBotConnection ? "/dashboard" : "/setup"));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(var(--hairline-bright) 1px, transparent 1px), linear-gradient(90deg, var(--hairline-bright) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="w-full max-w-[380px] relative">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--long)] pulse-dot" />
          <span className="eyebrow">Control Room</span>
        </div>

        <h1 className="font-display text-[28px] font-semibold leading-tight mb-2">
          Sign in
        </h1>
        <p className="text-sm text-[var(--muted)] mb-8 leading-relaxed">
          Enter the dashboard password to continue.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="operatorPassword" className="eyebrow block mb-2">Password</label>
            <input
              id="operatorPassword"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3.5 py-2.5 text-sm font-mono
                         text-[var(--text)] placeholder:text-[var(--muted-dim)]
                         focus:outline-none focus:border-[var(--long)] transition-colors"
            />
          </div>

          {error && (
            <div role="alert" className="text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full mt-2 bg-[var(--text)] text-[var(--bg)] font-display font-semibold text-sm
                       py-3 hover:bg-[var(--long)] transition-colors disabled:opacity-50
                       disabled:cursor-not-allowed"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

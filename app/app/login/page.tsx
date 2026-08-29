"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function safeNextPath(value: string | null): string {
  return value?.startsWith("/app/") ? value : "/app/dashboard";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/saas/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Login failed.");
        return;
      }
      router.push(safeNextPath(params.get("next")));
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
          <span className="eyebrow">Copy Trading</span>
        </div>

        <h1 className="font-display text-[28px] font-semibold leading-tight mb-2">
          Sign in
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4 mt-8">
          <div>
            <label htmlFor="loginEmail" className="eyebrow block mb-2">Email</label>
            <input
              id="loginEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3.5 py-2.5 text-sm font-mono
                         text-[var(--text)] placeholder:text-[var(--muted-dim)]
                         focus:outline-none focus:border-[var(--long)] transition-colors"
            />
          </div>

          <div>
            <label htmlFor="loginPassword" className="eyebrow block mb-2">Password</label>
            <input
              id="loginPassword"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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

        <p className="text-xs text-[var(--muted-dim)] mt-6 font-mono">
          Don&apos;t have an account?{" "}
          <Link href="/app/signup" className="text-[var(--muted)] hover:text-[var(--text)] underline">
            Sign up
          </Link>
        </p>
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

"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

const truths = [
  "Futures trading can lose money quickly, especially with leverage.",
  "Mimic Pips does not promise fixed returns, daily profit, or recovery after losses.",
  "Copy trading only makes sense when risk limits, subscription status, and exchange access are clear.",
  "The platform is built to show when trading should pause, not just when a trade should copy.",
];

const riskTerms = [
  "You can lose part or all of the capital you allocate to futures trading.",
  "Past performance, backtests, screenshots, or signal history do not guarantee future results.",
  "Copy execution can differ by exchange latency, liquidity, balance, symbol availability, and account settings.",
  "Risk Guard can pause or block copying when account gates are not met, but it cannot remove market risk.",
  "You remain responsible for deciding whether this kind of leveraged trading fits your finances and temperament.",
];

const workflow = [
  { title: "Connect", body: "Create an account, verify email, connect a supported exchange account, and accept the risk disclosure." },
  { title: "Qualify", body: "Risk Guard checks subscription status, payment gates, exchange readiness, and available balance before copy trading can go live." },
  { title: "Monitor", body: "Followers see copied trades, active gates, billing state, and account health so decisions are not made from panic or hype." },
];

export default function LandingPage() {
  const [showRisk, setShowRisk] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!showRisk) return;
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setShowRisk(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showRisk]);

  return (
    <main className="min-h-screen overflow-hidden">
      <header className="relative z-10 flex items-center justify-between px-6 py-5 max-w-[1180px] mx-auto">
        <BrandMark label="Mimic Pips" />
        <nav aria-label="Primary" className="flex items-center gap-4 text-xs font-mono text-[var(--muted)]">
          <Link href="/app/login" className="hover:text-[var(--text)] transition-colors">Follower login</Link>
          <Link href="/login" className="hidden sm:inline hover:text-[var(--text)] transition-colors">Leader login</Link>
          <Link href="/app/signup" className="bg-[var(--long)] text-[var(--bg)] px-3.5 py-2 font-display font-semibold">Create account</Link>
        </nav>
      </header>

      <section className="relative max-w-[1180px] mx-auto px-6 pt-14 pb-16 lg:pt-24 lg:pb-24">
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[var(--hairline-bright)] to-transparent" />
        <div className="grid lg:grid-cols-[1fr_420px] gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 border border-[var(--warn)]/40 bg-[var(--warn)]/5 px-3 py-2 text-xs font-mono text-[var(--warn)] mb-6">
              <AlertTriangle size={14} />
              Not a get-rich-quick product
            </div>
            <h1 className="font-display text-5xl sm:text-6xl lg:text-7xl font-semibold leading-[0.96] max-w-4xl">
              Copy-trading infrastructure for people who want the risk shown plainly.
            </h1>
            <p className="mt-6 text-lg text-[var(--muted)] leading-relaxed max-w-2xl">
              Mimic Pips helps followers mirror a futures strategy with visible gates, account health checks, billing controls, and trade history. It is built for disciplined participation, not emotional speculation.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/app/signup" className="bg-[var(--text)] text-[var(--bg)] font-display font-semibold px-5 py-3 hover:bg-[var(--long)] transition-colors">
                Create follower account
              </Link>
              <button type="button" onClick={() => setShowRisk(true)} className="border border-[var(--hairline-bright)] text-[var(--muted)] hover:text-[var(--text)] font-display font-semibold px-5 py-3 transition-colors">
                Read risk summary
              </button>
            </div>
          </div>

          <div className="panel-raised p-5 relative">
            <div className="flex items-center justify-between mb-6">
              <span className="eyebrow">Follower readiness</span>
              <span className="text-[10px] font-mono text-[var(--long)] border border-[var(--long-dim)] px-2 py-1">Risk Guard active</span>
            </div>
            <div className="h-48 border border-[var(--hairline)] bg-[var(--panel)] relative overflow-hidden mb-5">
              <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "linear-gradient(var(--hairline-bright) 1px, transparent 1px), linear-gradient(90deg, var(--hairline-bright) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
              <svg viewBox="0 0 420 190" className="absolute inset-0 w-full h-full" role="img" aria-label="Illustrative equity curve with drawdown zone">
                <path d="M0 142 C42 126 62 154 96 135 C134 112 144 88 178 98 C218 110 236 58 274 64 C314 70 324 34 365 42 C392 47 404 34 420 30" fill="none" stroke="var(--long)" strokeWidth="4" />
                <path d="M0 142 C42 126 62 154 96 135 C134 112 144 88 178 98 C218 110 236 58 274 64 C314 70 324 34 365 42 C392 47 404 34 420 30 L420 190 L0 190 Z" fill="rgba(61,214,140,0.08)" />
                <line x1="0" y1="132" x2="420" y2="132" stroke="var(--warn)" strokeDasharray="7 8" strokeWidth="2" />
              </svg>
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[10px] font-mono text-[var(--muted)]">
                <span>Equity curve</span>
                <span>Pause floor visible</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Metric icon={<ShieldCheck size={15} />} label="Gates" value="Enforced" tone="long" />
              <Metric icon={<Activity size={15} />} label="Copy state" value="Explicit" tone="long" />
              <Metric icon={<LockKeyhole size={15} />} label="Billing" value="Checked" tone="muted" />
              <Metric icon={<BarChart3 size={15} />} label="PnL" value="Tracked" tone="muted" />
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--hairline)] bg-[var(--panel)]/45">
        <div className="max-w-[1180px] mx-auto px-6 py-12 grid lg:grid-cols-[360px_1fr] gap-10">
          <div>
            <span className="eyebrow">Plain truth</span>
            <h2 className="font-display text-3xl font-semibold mt-3">This is for disciplined followers only.</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {truths.map((truth) => (
              <div key={truth} className="panel p-4 flex gap-3">
                <CheckCircle2 size={16} className="mt-0.5 text-[var(--long)] shrink-0" />
                <p className="text-sm text-[var(--muted)] leading-relaxed">{truth}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-[1180px] mx-auto px-6 py-16">
        <div className="flex items-end justify-between gap-6 flex-wrap mb-8">
          <div>
            <span className="eyebrow">How it works</span>
            <h2 className="font-display text-3xl font-semibold mt-3">A controlled path before live copying.</h2>
          </div>
          <div className="text-xs font-mono text-[var(--muted)] max-w-sm">No hidden auto-start. No silent account state. No promise that losses cannot happen.</div>
        </div>
        <div className="grid md:grid-cols-3 gap-px bg-[var(--hairline)]">
          {workflow.map((item, index) => (
            <article key={item.title} className="panel p-6 min-h-48">
              <span className="text-xs font-mono text-[var(--long)]">0{index + 1}</span>
              <h3 className="font-display text-xl font-semibold mt-5">{item.title}</h3>
              <p className="text-sm text-[var(--muted)] leading-relaxed mt-3">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="max-w-[1180px] mx-auto px-6 pb-20">
        <div className="panel-raised p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <span className="eyebrow">Before joining</span>
            <h2 className="font-display text-2xl font-semibold mt-2">Only proceed if you can tolerate drawdowns and understand leverage risk.</h2>
          </div>
          <Link href="/app/signup" className="inline-flex justify-center bg-[var(--long)] text-[var(--bg)] font-display font-semibold px-5 py-3 min-w-44">
            Create follower account
          </Link>
        </div>
      </section>
      {showRisk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-labelledby="riskSummaryTitle">
          <div className="panel-raised max-w-xl w-full p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--hairline)] pb-4">
              <div>
                <span className="eyebrow">Risk summary</span>
                <h2 id="riskSummaryTitle" className="font-display text-2xl font-semibold mt-2">Know what you are opting into.</h2>
              </div>
              <button ref={closeButtonRef} type="button" onClick={() => setShowRisk(false)} aria-label="Close risk summary" className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="py-5 space-y-3">
              {riskTerms.map((term) => (
                <div key={term} className="flex gap-3 text-sm text-[var(--muted)] leading-relaxed">
                  <AlertTriangle size={15} className="text-[var(--warn)] shrink-0 mt-0.5" />
                  <p>{term}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 pt-4 border-t border-[var(--hairline)]">
              <Link href="/risk-disclosure" className="bg-[var(--text)] text-[var(--bg)] font-display font-semibold px-4 py-2.5">
                Open full disclosure
              </Link>
              <button type="button" onClick={() => setShowRisk(false)} className="border border-[var(--hairline-bright)] text-[var(--muted)] hover:text-[var(--text)] font-display font-semibold px-4 py-2.5">
                Stay on page
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: "long" | "muted" }) {
  return (
    <div className="border border-[var(--hairline)] bg-[var(--panel)] p-3">
      <div className="flex items-center gap-2 text-[var(--muted)] text-xs font-mono">{icon}<span>{label}</span></div>
      <div className="font-display font-semibold mt-2" style={{ color: tone === "long" ? "var(--long)" : "var(--text)" }}>{value}</div>
    </div>
  );
}

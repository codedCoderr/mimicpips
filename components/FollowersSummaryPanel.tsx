"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import type { FollowerSummary } from "@/app/api/saas/followers/summary/route";

function fmtNgn(n: number): string {
  return `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "long" | "short" | "warn" | "neutral";
}) {
  const color =
    accent === "long"
      ? "var(--long)"
      : accent === "short"
        ? "var(--short)"
        : accent === "warn"
          ? "var(--warn)"
          : "var(--text)";

  return (
    <div className="panel p-4 flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      <span className="font-display font-semibold text-2xl tabular" style={{ color }}>
        {value}
      </span>
      {sub && <span className="font-mono text-[11px] text-[var(--muted)]">{sub}</span>}
    </div>
  );
}

export function FollowersSummaryPanel() {
  const router = useRouter();
  const [summary, setSummary] = useState<FollowerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/saas/followers/summary")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to load follower summary.");
        setSummary(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (error) return null; // quiet failure — this is a supplementary tile, not core dashboard data

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Followers</span>
        <button
          onClick={() => router.push("/dashboard/followers")}
          className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
        >
          <Users size={12} />
          Manage →
        </button>
      </div>

      {loading || !summary ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-[var(--hairline)]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="panel p-4 h-[76px] bg-[var(--panel)] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--hairline)]">
          <Tile label="Total Followers" value={String(summary.totalFollowers)} />
          <Tile
            label="Copy Trading Active"
            value={String(summary.copyTradingActive)}
            sub={`${summary.exchangeConnected} exchange-connected`}
            accent={summary.copyTradingActive > 0 ? "long" : "neutral"}
          />
          <Tile
            label="Active Subscriptions"
            value={String(summary.activeSubscriptions)}
            sub={summary.pastDueSubscriptions > 0 ? `${summary.pastDueSubscriptions} past due` : undefined}
            accent={summary.pastDueSubscriptions > 0 ? "warn" : "long"}
          />
          <Tile
            label="Pending Invoices"
            value={String(summary.pendingInvoices)}
            sub={summary.pendingInvoices > 0 ? fmtNgn(summary.pendingInvoiceTotalNGN) : undefined}
            accent={summary.pendingInvoices > 0 ? "warn" : "neutral"}
          />
          <Tile
            label="Follower Health"
            value={`${summary.averageHealthScore}/100`}
            sub={`${summary.atRiskFollowers} high risk, ${summary.anxiousFollowers} anxious`}
            accent={summary.atRiskFollowers > 0 || summary.anxiousFollowers > 0 ? "warn" : "long"}
          />
        </div>
      )}
    </div>
  );
}
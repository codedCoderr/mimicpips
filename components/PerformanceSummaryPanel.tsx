"use client";

import { useEffect, useState, useCallback } from "react";
import type { Session } from "@/lib/session";
import { fetchPerformanceSummary, ApiError } from "@/lib/api";
import type { PerformanceSummary } from "@/lib/types";

function fmtUsd(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

const RANGE_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "6mo", days: 180 },
  { label: "1yr", days: 365 },
  { label: "All time", days: 3650 },
];

export function PerformanceSummaryPanel({ session }: { session: Session }) {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<PerformanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetchPerformanceSummary(session, days)
      .then((result) => {
        setStats(result);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Failed to load performance stats.");
      })
      .finally(() => setLoading(false));
  }, [session, days]);

  useEffect(() => {
    load();
  }, [load]);

  const winRateNum = stats ? parseFloat(stats.winRate) : null;
  const netPnlPositive = stats ? stats.netPnL > 0 : false;
  const netPnlNegative = stats ? stats.netPnL < 0 : false;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="eyebrow">Performance</span>
        <div className="flex items-center gap-1 panel p-1 flex-wrap">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setDays(opt.days)}
              className="px-2.5 py-1 text-[11px] font-mono transition-colors whitespace-nowrap"
              style={{
                background: days === opt.days ? "var(--panel-raised)" : "transparent",
                color: days === opt.days ? "var(--text)" : "var(--muted)",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-xs font-mono text-[var(--short)] border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
          {error}
        </div>
      )}

      {!error && (loading || !stats) && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-px bg-[var(--hairline)]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="panel p-4 h-[76px] bg-[var(--panel)] animate-pulse" />
          ))}
        </div>
      )}

      {!error && !loading && stats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-px bg-[var(--hairline)]">
          <Tile
            label="Win Rate"
            value={stats.winRate}
            sub={`${stats.totalTrades} trades`}
            accent={
              winRateNum === null ? "neutral" : winRateNum >= 50 ? "long" : "short"
            }
          />
          <Tile
            label="Net PnL"
            value={`${netPnlPositive ? "+" : ""}${fmtUsd(stats.netPnL)}`}
            accent={netPnlPositive ? "long" : netPnlNegative ? "short" : "neutral"}
          />
          <Tile
            label="Profit Factor"
            value={stats.profitFactor?.toFixed(2)}
            accent={stats.profitFactor >= 1 ? "long" : "short"}
          />
          <Tile label="Sharpe" value={stats.sharpeRatio.toFixed(2)} />
          <Tile label="Max Drawdown" value={stats.maxDrawdown} accent="warn" />
          <Tile
            label="Avg Win:Loss"
            value={stats.avgRR === null ? "—" : `${stats.avgRR.toFixed(2)}R`}
            sub={stats.avgRR === null ? "no losses yet" : undefined}
            accent={
              stats.avgRR === null ? "neutral" : stats.avgRR >= 1 ? "long" : "short"
            }
          />
        </div>
      )}
    </div>
  );
}
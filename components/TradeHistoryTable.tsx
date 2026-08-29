"use client";

import { useEffect, useRef } from "react";
import type { RecentTradeRow } from "@/lib/types";

function fmtUsd(n: number, decimals = 2) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function timeAgo(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const ms = Math.max(0, now - then);
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

export function TradeHistoryTable({
  trades,
  loading,
  error,
  onLoadMore,
  hasMore,
}: {
  trades: RecentTradeRow[] | null;
  loading: boolean;
  error: string | null;
  onLoadMore: () => void;
  hasMore: boolean;
}) {
  const now = Date.now();
  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          onLoadMore();
        }
      },
      { threshold: 1.0 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  return (
    <div className="panel overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--hairline)] flex items-center justify-between">
        <span className="eyebrow">Recent Trades</span>
        <a
          href="/dashboard/ledger"
          className="text-[11px] font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
        >
          Full ledger →
        </a>
      </div>

      {error && (
        <div className="p-4">
          <p className="text-xs font-mono text-[var(--short)]">{error}</p>
        </div>
      )}

      {!error && !loading && trades && trades.length === 0 && (
        <div className="p-8 flex flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-[var(--muted)] font-mono">
            No closed trades yet.
          </p>
        </div>
      )}

      {!error && trades && trades.length > 0 && (
        <div className="overflow-x-auto max-h-[400px]"> {/* Added max-h for scrolling */}
          <table className="w-full text-sm relative">
            <thead className="sticky top-0 bg-[var(--background)] z-10">
              <tr className="border-b border-[var(--hairline)]">
                {["Symbol", "Side", "Entry", "Exit", "Held", "PnL", "Closed", "Reason"].map(
                  (h) => (
                    <th
                      key={h}
                      className="eyebrow text-left px-4 py-2.5 font-normal whitespace-nowrap"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="font-mono">
              {trades.map((t) => {
                const pnlPositive = t.pnl >= 0;
                return (
                  <tr
                    key={t.id}
                    className="border-b border-[var(--hairline)] last:border-b-0 hover:bg-[var(--panel-raised)] transition-colors"
                  >
                    <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                      {t.symbol}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5"
                        style={{
                          color: t.side === "LONG" ? "var(--long)" : "var(--short)",
                          border: `1px solid ${
                            t.side === "LONG" ? "var(--long-dim)" : "var(--short-dim)"
                          }`,
                        }}
                      >
                        {t.side}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular text-[var(--muted)]">
                      {fmtUsd(t.entryPrice, 4)}
                    </td>
                    <td className="px-4 py-2.5 tabular">{fmtUsd(t.exitPrice, 4)}</td>
                    <td className="px-4 py-2.5 tabular text-[var(--muted)] whitespace-nowrap">
                      {t.holdDuration}
                    </td>
                    <td
                      className="px-4 py-2.5 tabular font-semibold whitespace-nowrap"
                      style={{ color: pnlPositive ? "var(--long)" : "var(--short)" }}
                    >
                      {pnlPositive ? "+" : ""}
                      {fmtUsd(t.pnl)}
                    </td>
                    <td className="px-4 py-2.5 tabular text-[var(--muted)] whitespace-nowrap">
                      {timeAgo(t.exitTime, now)}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--muted)] whitespace-nowrap">
                      {t.closeReason || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Scroll Target */}
          <div ref={observerTarget} className="h-4 w-full" />
          {loading && (
             <div className="p-4 text-center">
                <p className="text-xs font-mono text-[var(--muted)]">Loading more trades...</p>
             </div>
          )}
        </div>
      )}
    </div>
  );
}
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Target, TrendingDown, RotateCw, ShieldCheck } from "lucide-react";
import type { RecentTradeRow } from "@/lib/types";
import type { Session } from "@/lib/session";
import { ApiError, repairTradeAccounting } from "@/lib/api";

function fmtUsd(n: number, decimals = 2) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
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

/**
 * Renders the close reason as a styled badge instead of plain text —
 * TP hits (which TP specifically), SL hits, ST flips, and breakeven
 * exits each get a distinct color/icon so the outcome is scannable at a
 * glance rather than read word-by-word. Falls back to plain text for any
 * reason string the bot reports that isn't one of the known shapes.
 */
function CloseReasonBadge({ reason }: { reason: string }) {
  if (!reason) return <span className="text-[var(--muted)]">—</span>;

  const upper = reason.toUpperCase();

  if (upper.includes("TP")) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5"
        style={{ color: "var(--long)", border: "1px solid var(--long-dim)" }}
      >
        <Target size={10} />
        {reason}
      </span>
    );
  }
  if (upper.includes("SL")) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5"
        style={{ color: "var(--short)", border: "1px solid var(--short-dim)" }}
      >
        <TrendingDown size={10} />
        {reason}
      </span>
    );
  }
  if (upper.includes("FLIP")) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5"
        style={{ color: "var(--warn)", border: "1px solid var(--warn)" }}
      >
        <RotateCw size={10} />
        {reason}
      </span>
    );
  }
  if (upper.includes("BREAKEVEN")) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5"
        style={{ color: "var(--muted)", border: "1px solid var(--hairline-bright)" }}
      >
        <ShieldCheck size={10} />
        {reason}
      </span>
    );
  }
  return <span className="text-[var(--muted)] text-xs">{reason}</span>;
}

export function TradeHistoryTable({
  session,
  trades,
  loading,
  error,
  onLoadMore,
  hasMore,
  onRepaired,
}: {
  session: Session;
  trades: RecentTradeRow[] | null;
  loading: boolean;
  error: string | null;
  onLoadMore: () => void;
  hasMore: boolean;
  onRepaired: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [symbolFilter, setSymbolFilter] = useState<string>("ALL");
  const [repairingSymbol, setRepairingSymbol] = useState<string | null>(null);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Callback ref (not a plain useRef + useEffect) — this fires exactly
  // when the sentinel div actually mounts/unmounts in the DOM, which is
  // what we need here: the sentinel is conditionally rendered (only
  // when filteredTrades has content AND symbolFilter === "ALL"), and a
  // plain useEffect observing a ref set before the div ever existed
  // would silently attach to nothing and never re-attach on later
  // renders — that was the actual bug that broke this. A callback ref
  // re-fires on every mount, so it can't go stale the same way.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      if (!node) return;

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !loading) {
            onLoadMore();
          }
        },
        { threshold: 1.0 }
      );
      observerRef.current.observe(node);
    },
    [hasMore, loading, onLoadMore]
  );

  const symbols = useMemo(() => {
    if (!trades) return [];
    return Array.from(new Set(trades.map((t) => t.symbol))).sort();
  }, [trades]);

  const filteredTrades = useMemo(() => {
    if (!trades) return trades;
    if (symbolFilter === "ALL") return trades;
    return trades.filter((t) => t.symbol === symbolFilter);
  }, [trades, symbolFilter]);

  return (
    <div className="panel overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--hairline)] flex items-center justify-between gap-3">
        <span className="eyebrow">Recent Trades</span>
        <div className="flex items-center gap-3">
          {symbols.length > 1 && (
            <select
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              className="bg-[var(--panel-raised)] border border-[var(--hairline)] text-[11px] font-mono
                         text-[var(--muted)] px-2 py-1 focus:outline-none focus:border-[var(--long)] transition-colors"
            >
              <option value="ALL">All symbols</option>
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <a
            href="/dashboard/ledger"
            className="text-[11px] font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors whitespace-nowrap"
          >
            Full ledger →
          </a>
        </div>
      </div>

      {error && (
        <div className="p-4">
          <p className="text-xs font-mono text-[var(--short)]">{error}</p>
        </div>
      )}

      {!error && !loading && filteredTrades && filteredTrades.length === 0 && (
        <div className="p-8 flex flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-[var(--muted)] font-mono">
            {symbolFilter === "ALL" ? "No closed trades yet." : `No closed trades for ${symbolFilter}.`}
          </p>
        </div>
      )}

      {!error && filteredTrades && filteredTrades.length > 0 && (
        <div className="overflow-x-auto max-h-[400px]">
          <table className="w-full text-sm relative">
            <thead className="sticky top-0 bg-[var(--panel)] z-10">
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
              {filteredTrades.map((t) => {
                const pnlPositive = t.pnl > 0;
                const pnlNegative = t.pnl < 0;
                const canRepair = Math.abs(t.pnl) < 0.000001;
                async function handleRepair() {
                  if (repairingSymbol) return;
                  setRepairingSymbol(t.symbol);
                  setRepairMessage(null);
                  try {
                    const result = await repairTradeAccounting(session, t.symbol);
                    if (!result.repaired) {
                      setRepairMessage(result.reason ?? "Accounting repair did not complete.");
                      return;
                    }
                    onRepaired();
                  } catch (err) {
                    setRepairMessage(err instanceof ApiError ? err.message : "Accounting repair failed.");
                  } finally {
                    setRepairingSymbol(null);
                  }
                }
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
                      style={{ color: pnlPositive ? "var(--long)" : pnlNegative ? "var(--short)" : "var(--muted)" }}
                    >
                      {pnlPositive ? "+" : ""}
                      {fmtUsd(t.pnl)}
                      {canRepair && (
                        <div className="mt-1 flex flex-col items-start gap-1">
                          <button
                            type="button"
                            onClick={handleRepair}
                            disabled={repairingSymbol !== null}
                            className="text-[10px] font-semibold px-1.5 py-0.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{ color: "var(--warn)", border: "1px solid var(--warn-dim)" }}
                            title="Fetch exchange fills and recalculate this row"
                          >
                            {repairingSymbol === t.symbol ? "Repairing" : "Repair PnL"}
                          </button>
                          {repairMessage && repairingSymbol !== t.symbol && (
                            <span className="text-[10px] text-[var(--warn)] max-w-[180px] leading-tight">
                              {repairMessage}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular text-[var(--muted)] whitespace-nowrap">
                      {timeAgo(t.exitTime, now)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <CloseReasonBadge reason={t.closeReason} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Scroll Target — only meaningful when not filtering, since
              filtering is done client-side over already-loaded trades */}
          {symbolFilter === "ALL" && <div ref={sentinelCallbackRef} className="h-4 w-full" />}
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

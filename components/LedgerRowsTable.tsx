"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import type { LedgerRow } from "@/lib/types";

const PAGE_SIZE = 20;

function fmtUsd(n: number | null, decimals = 2) {
  if (n === null) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function LedgerRowsTable({ rows, loading }: { rows: LedgerRow[] | null; loading: boolean }) {
  const [symbolFilter, setSymbolFilter] = useState<string>("ALL");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const symbols = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => r.symbol))).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    if (symbolFilter === "ALL") return rows;
    return rows.filter((r) => r.symbol === symbolFilter);
  }, [rows, symbolFilter]);

  // Reset pagination whenever the filter (or the underlying data set)
  // changes — otherwise switching symbols could leave visibleCount
  // pointing past the end of a much shorter filtered list.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [symbolFilter, rows]);

  const visibleRows = filteredRows.slice(0, visibleCount);
  const hasMore = visibleCount < filteredRows.length;

  const loadMore = useCallback(() => {
    if (!hasMore) return;
    setVisibleCount((c) => c + PAGE_SIZE);
  }, [hasMore]);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      if (!node) return;
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) loadMore();
        },
        { threshold: 1.0, rootMargin: "200px" }
      );
      observerRef.current.observe(node);
    },
    [loadMore]
  );

  return (
    <div className="panel overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--hairline)] flex items-center justify-between gap-3">
        <span className="eyebrow">
          All trades {rows ? `(${filteredRows.length})` : ""}
        </span>
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
      </div>

      {loading && (
        <div className="p-8 flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-[var(--muted)]" />
        </div>
      )}

      {!loading && rows && filteredRows.length === 0 && (
        <div className="p-8 text-center">
          <p className="text-sm text-[var(--muted)] font-mono">
            {symbolFilter === "ALL" ? "No trades in this range." : `No trades for ${symbolFilter}.`}
          </p>
        </div>
      )}

      {!loading && visibleRows.length > 0 && (
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--panel)] z-10">
              <tr className="border-b border-[var(--hairline)]">
                {[
                  "Symbol",
                  "Side",
                  "Entry",
                  "Exit",
                  "Held",
                  "Gross PnL",
                  "Fees",
                  "Net PnL",
                  "Reason",
                ].map((h) => (
                  <th key={h} className="eyebrow text-left px-4 py-2.5 font-normal whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {visibleRows.map((r) => {
                const netPositive = r.netPnl !== null && r.netPnl > 0;
                const netNegative = r.netPnl !== null && r.netPnl < 0;
                const totalFees =
                  r.tradingFees !== null && r.fundingFees !== null
                    ? r.tradingFees + r.fundingFees
                    : null;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-[var(--hairline)] last:border-b-0 hover:bg-[var(--panel-raised)] transition-colors"
                  >
                    <td className="px-4 py-2.5 font-semibold whitespace-nowrap">{r.symbol}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5"
                        style={{
                          color: r.side === "LONG" ? "var(--long)" : "var(--short)",
                          border: `1px solid ${
                            r.side === "LONG" ? "var(--long-dim)" : "var(--short-dim)"
                          }`,
                        }}
                      >
                        {r.side}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular text-[var(--muted)]">
                      {fmtUsd(r.entryPrice, 4)}
                    </td>
                    <td className="px-4 py-2.5 tabular">{fmtUsd(r.exitPrice, 4)}</td>
                    <td className="px-4 py-2.5 tabular text-[var(--muted)] whitespace-nowrap">
                      {r.holdDuration}
                    </td>
                    <td className="px-4 py-2.5 tabular">{fmtUsd(r.grossPnl)}</td>
                    <td className="px-4 py-2.5 tabular text-[var(--muted)]">
                      {r.feesIncluded ? fmtUsd(totalFees) : "—"}
                    </td>
                    <td
                      className="px-4 py-2.5 tabular font-semibold"
                      style={{
                        color: netPositive ? "var(--long)" : netNegative ? "var(--short)" : "var(--muted)",
                      }}
                    >
                      {r.netPnl !== null ? fmtUsd(r.netPnl) : "incomplete"}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--muted)] whitespace-nowrap">
                      {r.closeReason || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {hasMore && <div ref={sentinelCallbackRef} className="h-px" />}
          {hasMore && (
            <div className="flex items-center justify-center py-3">
              <Loader2 size={14} className="animate-spin text-[var(--muted)]" />
            </div>
          )}
          {!hasMore && filteredRows.length > 0 && (
            <div className="text-center py-3">
              <span className="text-[11px] font-mono text-[var(--muted-dim)]">No more trades</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
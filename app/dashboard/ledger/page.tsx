"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, TriangleAlert } from "lucide-react";
import { OperatorHeader } from "@/components/OperatorHeader";
import { loadVerifiedSession, type Session } from "@/lib/session";
import {
  fetchLedgerSummary,
  fetchLedger,
  downloadLedgerCsv,
  downloadLedgerSummaryCsv,
  ApiError,
} from "@/lib/api";
import type { LedgerSummaryRow, LedgerRow } from "@/lib/types";
import { LedgerRowsTable } from "@/components/LedgerRowsTable";

const RANGE_OPTIONS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
  { label: "All time", days: 3650 },
];

function fmtUsd(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function LedgerPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [days, setDays] = useState(90);
  const [groupBy, setGroupBy] = useState<"month" | "symbol">("month");
  const [rows, setRows] = useState<LedgerSummaryRow[] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[] | null>(null);
  const [ledgerRowsLoading, setLedgerRowsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadVerifiedSession().then((existing) => {
      if (cancelled) return;
      if (!existing) {
        router.replace("/setup");
        return;
      }
      setSession(existing);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLedgerSummary(session, days, groupBy);
      setRows(result.summary);
      setWarning(result.feeDataWarning);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load ledger.");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [session, days, groupBy]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!session) return;
    setLedgerRowsLoading(true);
    fetchLedger(session, days)
      .then((result) => setLedgerRows(result.rows))
      .catch(() => setLedgerRows(null))
      .finally(() => setLedgerRowsLoading(false));
  }, [session, days]);

  async function handleDownload(kind: "rows" | "summary") {
    if (!session) return;
    setDownloading(kind);
    try {
      if (kind === "rows") {
        await downloadLedgerCsv(session, days);
      } else {
        await downloadLedgerSummaryCsv(session, days, groupBy);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Download failed.");
    } finally {
      setDownloading(null);
    }
  }

  if (!session) return null;

  const totals = rows?.reduce(
    (acc, r) => ({
      trades: acc.trades + r.trades,
      grossPnl: acc.grossPnl + r.grossPnl,
      tradingFees: acc.tradingFees + r.tradingFees,
      fundingFees: acc.fundingFees + r.fundingFees,
      netPnl: acc.netPnl + r.netPnl,
      incompleteRows: acc.incompleteRows + r.incompleteRows,
    }),
    { trades: 0, grossPnl: 0, tradingFees: 0, fundingFees: 0, netPnl: 0, incompleteRows: 0 }
  );

  return (
    <main className="min-h-screen flex flex-col">
      <OperatorHeader
        status={ <span className="eyebrow">Ledger and exports</span> }
      />

      <div className="flex-1 p-6">
        <div className="max-w-[1100px] mx-auto space-y-6">
          {/* Controls */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-1 panel p-1">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setDays(opt.days)}
                  className="px-3 py-1.5 text-xs font-mono transition-colors"
                  style={{
                    background: days === opt.days ? "var(--panel-raised)" : "transparent",
                    color: days === opt.days ? "var(--text)" : "var(--muted)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 panel p-1">
              {(["month", "symbol"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGroupBy(g)}
                  className="px-3 py-1.5 text-xs font-mono capitalize transition-colors"
                  style={{
                    background: groupBy === g ? "var(--panel-raised)" : "transparent",
                    color: groupBy === g ? "var(--text)" : "var(--muted)",
                  }}
                >
                  By {g}
                </button>
              ))}
            </div>
          </div>

          {/* Download actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => void handleDownload("rows")}
              disabled={downloading !== null}
              className="flex items-center gap-2 text-xs font-mono px-3 py-2 border border-[var(--hairline-bright)]
                         hover:border-[var(--long)] hover:text-[var(--long)] transition-colors disabled:opacity-50"
            >
              {downloading === "rows" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Download size={13} />
              )}
              Download full ledger (CSV)
            </button>
            <button
              onClick={() => void handleDownload("summary")}
              disabled={downloading !== null}
              className="flex items-center gap-2 text-xs font-mono px-3 py-2 border border-[var(--hairline-bright)]
                         hover:border-[var(--long)] hover:text-[var(--long)] transition-colors disabled:opacity-50"
            >
              {downloading === "summary" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Download size={13} />
              )}
              Download summary (CSV)
            </button>
          </div>

          {warning && (
            <div className="flex items-start gap-2 text-xs font-mono text-[var(--warn)] border border-[var(--warn)]/40 bg-[var(--warn)]/5 px-3 py-2.5">
              <TriangleAlert size={14} className="shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          )}

          {error && (
            <div className="text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
              {error}
            </div>
          )}

          {/* Summary table */}
          <div className="panel overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--hairline)] flex items-center justify-between">
              <span className="eyebrow">
                {groupBy === "month" ? "By month" : "By symbol"}
              </span>
              {loading && <Loader2 size={14} className="animate-spin text-[var(--muted)]" />}
            </div>

            {!loading && rows && rows.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-sm text-[var(--muted)] font-mono">
                  No closed trades in this range.
                </p>
              </div>
            )}

            {rows && rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--hairline)]">
                      {[
                        groupBy === "month" ? "Month" : "Symbol",
                        "Trades",
                        "Gross PnL",
                        "Trading fees",
                        "Funding fees",
                        "Net PnL",
                        "Fee data",
                      ].map((h) => (
                        <th
                          key={h}
                          className="eyebrow text-left px-4 py-2.5 font-normal whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {rows.map((r) => {
                      const netPositive = r.netPnl >= 0;
                      const hasGaps = r.incompleteRows > 0;
                      return (
                        <tr
                          key={r.period}
                          className="border-b border-[var(--hairline)] last:border-b-0 hover:bg-[var(--panel-raised)] transition-colors"
                        >
                          <td className="px-4 py-3 font-semibold whitespace-nowrap">
                            {r.period}
                          </td>
                          <td className="px-4 py-3 tabular text-[var(--muted)]">{r.trades}</td>
                          <td className="px-4 py-3 tabular">{fmtUsd(r.grossPnl)}</td>
                          <td className="px-4 py-3 tabular text-[var(--muted)]">
                            {fmtUsd(r.tradingFees)}
                          </td>
                          <td className="px-4 py-3 tabular text-[var(--muted)]">
                            {fmtUsd(r.fundingFees)}
                          </td>
                          <td
                            className="px-4 py-3 tabular font-semibold"
                            style={{ color: netPositive ? "var(--long)" : "var(--short)" }}
                          >
                            {fmtUsd(r.netPnl)}
                          </td>
                          <td className="px-4 py-3">
                            {hasGaps ? (
                              <span
                                className="text-[10px] font-semibold px-1.5 py-0.5"
                                style={{ color: "var(--warn)", border: "1px solid var(--warn)" }}
                                title={`${r.incompleteRows} trade(s) missing exchange fee data — net PnL for those falls back to gross`}
                              >
                                {r.incompleteRows} incomplete
                              </span>
                            ) : (
                              <span
                                className="text-[10px] font-semibold px-1.5 py-0.5"
                                style={{ color: "var(--long)", border: "1px solid var(--long-dim)" }}
                              >
                                complete
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {totals && (
                    <tfoot>
                      <tr className="border-t-2 border-[var(--hairline-bright)]">
                        <td className="px-4 py-3 font-semibold">Total</td>
                        <td className="px-4 py-3 tabular text-[var(--muted)]">{totals.trades}</td>
                        <td className="px-4 py-3 tabular font-semibold">
                          {fmtUsd(totals.grossPnl)}
                        </td>
                        <td className="px-4 py-3 tabular text-[var(--muted)]">
                          {fmtUsd(totals.tradingFees)}
                        </td>
                        <td className="px-4 py-3 tabular text-[var(--muted)]">
                          {fmtUsd(totals.fundingFees)}
                        </td>
                        <td
                          className="px-4 py-3 tabular font-semibold"
                          style={{ color: totals.netPnl >= 0 ? "var(--long)" : "var(--short)" }}
                        >
                          {fmtUsd(totals.netPnl)}
                        </td>
                        <td className="px-4 py-3 tabular text-[var(--muted)]">
                          {totals.incompleteRows > 0 ? `${totals.incompleteRows} incomplete` : "—"}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>

          <LedgerRowsTable rows={ledgerRows} loading={ledgerRowsLoading} />

          <p className="text-xs text-[var(--muted-dim)] font-mono leading-relaxed">
            Trading and funding fees are pulled live from the exchange at
            generation time and are not stored anywhere — this isn&apos;t tax
            advice, and figures should be checked against your exchange&apos;s
            own statements before filing.
          </p>
        </div>
      </div>
    </main>
  );
}

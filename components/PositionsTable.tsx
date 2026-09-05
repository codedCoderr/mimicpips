"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Target, AlertTriangle } from "lucide-react";
import type { DashboardPosition } from "@/lib/types";
import type { Session } from "@/lib/session";
import { closePosition, forceStopLossClose, reconcileTakeProfit, ApiError } from "@/lib/api";

function fmtUsd(n: number, decimals = 2) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function fmtPrice(n: number | null | undefined) {
  const value = Number(n ?? 0);
  const abs = Math.abs(value);
  const decimals = abs === 0 ? 2 : abs < 0.001 ? 8 : abs < 0.01 ? 6 : abs < 1 ? 4 : 2;
  return fmtUsd(value, decimals);
}

function riskColor(level: DashboardPosition["riskLevel"]) {
  switch (level) {
    case "LOW":
      return "var(--long)";
    case "MEDIUM":
      return "var(--warn)";
    case "HIGH":
      return "var(--short)";
    case "CRITICAL":
      return "var(--kill-bright)";
  }
}

function formatDuration(openedAt: string, now: number): string {
  const opened = new Date(openedAt).getTime();
  if (isNaN(opened)) return "—";
  const ms = Math.max(0, now - opened);
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

function nextTpLabel(position: DashboardPosition): string | null {
  const targets = position.takeProfits;
  if (!targets) return null;

  if (position.tp2PriceReached && !position.tp2Filled && targets.tp2 > 0) {
    return `Awaiting TP2 fill ${fmtPrice(targets.tp2)}`;
  }
  if (position.tp1PriceReached && !position.tp1Filled && targets.tp1 > 0) {
    return `Awaiting TP1 fill ${fmtPrice(targets.tp1)}`;
  }
  if (position.tp2Filled && targets.tp3 > 0) return `TP3 ${fmtPrice(targets.tp3)}`;
  if (position.tp1Filled && targets.tp2 > 0) return `TP2 ${fmtPrice(targets.tp2)}`;
  if (targets.tp1 > 0) return `TP1 ${fmtPrice(targets.tp1)}`;
  return null;
}

/** Renders duration on a live 30s tick so open trades visibly age without a page refresh. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function CloseButton({
  session,
  symbol,
  onClosed,
}: {
  session: Session;
  symbol: string;
  onClosed: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-cancel the confirm state after a few seconds so a stray click
  // hours later doesn't land on an armed button.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(id);
  }, [confirming]);

  async function handleClick() {
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      setError(null);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await closePosition(session, symbol);
      if (!result.closed) {
        setError(result.reason ?? "Close did not complete.");
        setConfirming(false);
        return;
      }
      onClosed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Close failed.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title={confirming ? "Click again to confirm" : "Close this position"}
        className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          color: confirming ? "#fff" : "var(--short)",
          background: confirming ? "var(--short)" : "transparent",
          border: `1px solid ${confirming ? "var(--short)" : "var(--short-dim)"}`,
        }}
      >
        {busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <X size={12} strokeWidth={2.5} />
        )}
        {busy ? "Closing…" : confirming ? "Confirm" : "Close"}
      </button>
      {error && (
        <span className="text-[10px] text-[var(--short)] font-mono max-w-[160px] text-right leading-tight">
          {error}
        </span>
      )}
    </div>
  );
}

function ReconcileTpButton({
  session,
  symbol,
  onReconciled,
}: {
  session: Session;
  symbol: string;
  onReconciled: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await reconcileTakeProfit(session, symbol);
      if (!result.reconciled) {
        setMessage(result.reason ?? "No confirmed TP fill found.");
        return;
      }
      onReconciled();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "TP sync failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title="Verify exchange size and recover the TP status if a fill is confirmed"
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ color: "var(--warn)", border: "1px solid var(--warn-dim)" }}
      >
        {busy ? <Loader2 size={10} className="animate-spin" /> : <Target size={10} />}
        Sync TP
      </button>
      {message && (
        <span className="text-[10px] text-[var(--warn)] max-w-[180px] leading-tight">
          {message}
        </span>
      )}
    </div>
  );
}

function ForceStopLossButton({
  session,
  symbol,
  onClosed,
}: {
  session: Session;
  symbol: string;
  onClosed: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(id);
  }, [confirming]);

  async function handleClick() {
    if (busy) return;
    if (!confirming) {
      setConfirming(true);
      setMessage(null);
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const result = await forceStopLossClose(session, symbol);
      if (!result.closed) {
        setMessage(result.reason ?? "Force close did not complete.");
        setConfirming(false);
        return;
      }
      onClosed();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Force close failed.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title={confirming ? "Click again to force close at market" : "Force close and record as SL hit"}
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          color: confirming ? "#fff" : "var(--short)",
          background: confirming ? "var(--short)" : "transparent",
          border: "1px solid var(--short-dim)",
        }}
      >
        {busy ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
        {busy ? "Closing" : confirming ? "Confirm SL" : "Force SL"}
      </button>
      {message && (
        <span className="text-[10px] text-[var(--short)] max-w-[180px] leading-tight">
          {message}
        </span>
      )}
    </div>
  );
}

export function PositionsTable({
  positions,
  session,
  onPositionClosed,
}: {
  positions: DashboardPosition[];
  session: Session;
  onPositionClosed: () => void;
}) {
  const now = useNow(30_000);

  if (positions.length === 0) {
    return (
      <div className="panel p-8 flex flex-col items-center justify-center gap-2 text-center">
        <span className="eyebrow">Positions</span>
        <p className="text-sm text-[var(--muted)] font-mono mt-1">
          No open positions. The bot is scanning for entries.
        </p>
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--hairline)]">
        <span className="eyebrow">Open Positions ({positions.length})</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--hairline)]">
              {[
                "Symbol",
                "Side",
                "Entry",
                "Mark",
                "Size",
                "Lev",
                "PnL",
                "Open for",
                "SL",
                "Liq. dist.",
                "Progress",
                "Risk",
                "",
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
            {positions.map((p) => {
              const pnlPositive = p.unrealizedPnl > 0;
              const pnlNegative = p.unrealizedPnl < 0;
              const nextTarget = nextTpLabel(p);
              return (
                <tr
                  key={p.fullSymbol}
                  className="border-b border-[var(--hairline)] last:border-b-0 hover:bg-[var(--panel-raised)] transition-colors"
                >
                  <td className="px-4 py-3 font-semibold whitespace-nowrap">
                    {p.symbol}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-[11px] font-semibold px-1.5 py-0.5"
                      style={{
                        color: p.side === "LONG" ? "var(--long)" : "var(--short)",
                        border: `1px solid ${
                          p.side === "LONG" ? "var(--long-dim)" : "var(--short-dim)"
                        }`,
                      }}
                    >
                      {p.side}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular text-[var(--muted)]">
                    {fmtPrice(p.entryPrice)}
                  </td>
                  <td className="px-4 py-3 tabular">{fmtPrice(p.currentPrice)}</td>
                  <td className="px-4 py-3 tabular text-[var(--muted)]">
                    {p.amount.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-4 py-3 tabular text-[var(--muted)]">{p.leverage}x</td>
                  <td
                    className="px-4 py-3 tabular font-semibold whitespace-nowrap"
                    style={{ color: pnlPositive ? "var(--long)" : pnlNegative ? "var(--short)" : "var(--muted)" }}
                  >
                    {pnlPositive ? "+" : ""}
                    {fmtUsd(p.unrealizedPnl)}
                    <span className="text-[10px] opacity-70 ml-1">
                      ({pnlPositive ? "+" : ""}
                      {p.unrealizedPnlPct.toFixed(1)}%)
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular text-[var(--muted)] whitespace-nowrap">
                    {formatDuration(p.openedAt, now)}
                  </td>
                  <td className="px-4 py-3 tabular">
                    <div className="flex flex-col items-start gap-1">
                      <span
                        className={
                          p.stopLossPriceReached
                            ? "text-[var(--short)] font-semibold"
                            : "text-[var(--muted)]"
                        }
                      >
                        {p.stopLoss && p.stopLoss > 0 ? fmtPrice(p.stopLoss) : "—"}
                      </span>
                      {p.stopLossWarning && (
                        <>
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5"
                            style={{ color: "var(--short)", border: "1px solid var(--short-dim)" }}
                            title={p.stopLossWarning}
                          >
                            <AlertTriangle size={10} />
                            SL TOUCHED
                          </span>
                          <ForceStopLossButton
                            session={session}
                            symbol={p.fullSymbol}
                            onClosed={onPositionClosed}
                          />
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular">
                    {p.liquidationDistancePct.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 min-w-[128px]">
                    <div className="flex flex-col items-start gap-1">
                      {p.tpStatus ? (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5"
                          style={{ color: "var(--long)", border: "1px solid var(--long-dim)" }}
                          title={
                            p.tpStatus === "TP2 HIT"
                              ? "TP1 and TP2 filled; running toward TP3"
                              : "TP1 filled; running toward TP2"
                          }
                        >
                          <Target size={10} />
                          {p.tpStatus}
                        </span>
                      ) : p.tpWarning ? (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5"
                          style={{ color: "var(--warn)", border: "1px solid var(--warn-dim)" }}
                          title={p.tpWarning}
                        >
                          <AlertTriangle size={10} />
                          TP TOUCHED
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--muted-dim)]">—</span>
                      )}
                      {nextTarget && (
                        <span className="text-[10px] text-[var(--muted-dim)] whitespace-nowrap">
                          {p.tpWarning ? nextTarget : `Next ${nextTarget}`}
                        </span>
                      )}
                      {p.tpWarning && (
                        <ReconcileTpButton
                          session={session}
                          symbol={p.fullSymbol}
                          onReconciled={onPositionClosed}
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5"
                      style={{
                        color: riskColor(p.riskLevel),
                        border: `1px solid ${riskColor(p.riskLevel)}`,
                      }}
                    >
                      {p.riskLevel}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <CloseButton
                      session={session}
                      symbol={p.fullSymbol}
                      onClosed={onPositionClosed}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import type {
  PerformanceSummary,
  PropFirmRiskDashboard,
  PropFirmTelemetryBucket,
  RecentTradeRow,
  RiskSeverity,
} from "@/lib/types";

function fmtUsd(value: number) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function fmtR(value: number | null) {
  return value === null ? "-" : `${value.toFixed(2)}R`;
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePct(value: unknown, fallback = 0) {
  if (typeof value === "string") {
    return num(value.replace("%", ""), fallback);
  }
  return num(value, fallback);
}

function severityColor(severity: RiskSeverity) {
  if (severity === "BREACHED") return "var(--kill-bright)";
  if (severity === "WARNING") return "var(--short)";
  if (severity === "WATCH") return "var(--warn)";
  return "var(--long)";
}

function severityRank(severity: RiskSeverity) {
  if (severity === "BREACHED") return 3;
  if (severity === "WARNING") return 2;
  if (severity === "WATCH") return 1;
  return 0;
}

function maxSeverity(values: RiskSeverity[]): RiskSeverity {
  return values.reduce<RiskSeverity>(
    (highest, current) =>
      severityRank(current) > severityRank(highest) ? current : highest,
    "OK"
  );
}

function buildBuckets(
  trades: RecentTradeRow[] | null | undefined,
  keyForTrade: (trade: RecentTradeRow) => string
): PropFirmTelemetryBucket[] {
  const groups = new Map<
    string,
    {
      trades: number;
      wins: number;
      losses: number;
      pnl: number;
    }
  >();

  for (const trade of trades ?? []) {
    const key = keyForTrade(trade);
    if (!key) continue;
    const current = groups.get(key) ?? {
      trades: 0,
      wins: 0,
      losses: 0,
      pnl: 0,
    };
    current.trades += 1;
    current.pnl += num(trade.pnl);
    if (trade.pnl > 0) current.wins += 1;
    if (trade.pnl < 0) current.losses += 1;
    groups.set(key, current);
  }

  return Array.from(groups.entries()).map(([key, row]) => ({
    key,
    trades: row.trades,
    wins: row.wins,
    losses: row.losses,
    winRate: row.trades > 0 ? (row.wins / row.trades) * 100 : 0,
    pnl: row.pnl,
    avgR: null,
    profitFactor: null,
  }));
}

function Metric({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "long" | "short" | "warn" | "neutral";
}) {
  const color =
    tone === "long"
      ? "var(--long)"
      : tone === "short"
      ? "var(--short)"
      : tone === "warn"
      ? "var(--warn)"
      : "var(--text)";

  return (
    <div className='border border-[var(--hairline)] bg-[var(--panel-raised)] p-3 min-h-[92px]'>
      <span className='eyebrow'>{label}</span>
      <p
        className='font-display text-2xl font-semibold tabular mt-1'
        style={{ color }}>
        {value}
      </p>
      {sub && (
        <p className='font-mono text-[11px] text-[var(--muted)] leading-relaxed mt-1'>
          {sub}
        </p>
      )}
    </div>
  );
}

function ProgressBar({
  value,
  limitLabel,
  severity,
}: {
  value: number;
  limitLabel: string;
  severity: RiskSeverity;
}) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between gap-3'>
        <span className='font-mono text-[11px] text-[var(--muted)]'>
          {limitLabel}
        </span>
        <span
          className='font-mono text-[11px] tabular'
          style={{ color: severityColor(severity) }}>
          {fmtPct(value)}
        </span>
      </div>
      <div className='h-1.5 bg-[var(--hairline)] overflow-hidden'>
        <div
          className='h-full'
          style={{ width: `${width}%`, background: severityColor(severity) }}
        />
      </div>
    </div>
  );
}

function BucketTable({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: PropFirmTelemetryBucket[];
  empty: string;
}) {
  return (
    <div className='border border-[var(--hairline)] bg-[var(--panel-raised)] min-w-0'>
      <div className='px-3 py-2 border-b border-[var(--hairline)]'>
        <span className='eyebrow'>{title}</span>
      </div>
      {rows.length === 0 ? (
        <p className='font-mono text-xs text-[var(--muted)] px-3 py-4'>
          {empty}
        </p>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full text-left text-xs font-mono'>
            <thead className='text-[10px] uppercase text-[var(--muted)]'>
              <tr>
                <th className='px-3 py-2 font-semibold'>Key</th>
                <th className='px-3 py-2 font-semibold text-right'>Trades</th>
                <th className='px-3 py-2 font-semibold text-right'>PnL</th>
                <th className='px-3 py-2 font-semibold text-right'>Avg R</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 4).map((row) => (
                <tr key={row.key} className='border-t border-[var(--hairline)]'>
                  <td className='px-3 py-2 font-semibold text-[var(--text)] whitespace-nowrap'>
                    {row.key}
                  </td>
                  <td className='px-3 py-2 text-right tabular text-[var(--muted-dim)]'>
                    {row.trades}
                  </td>
                  <td
                    className='px-3 py-2 text-right tabular font-semibold'
                    style={{
                      color: row.pnl >= 0 ? "var(--long)" : "var(--short)",
                    }}>
                    {row.pnl >= 0 ? "+" : ""}
                    {fmtUsd(row.pnl)}
                  </td>
                  <td className='px-3 py-2 text-right tabular text-[var(--muted-dim)]'>
                    {fmtR(row.avgR)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PropFirmRiskPanel({
  risk,
  performanceSummary,
  recentTrades,
  onAfterAction,
  maxPositions,
}: {
  risk: Partial<PropFirmRiskDashboard> | null;
  /** Live max-entry limit from snapshot.account; used when risk.rules is absent. */
  maxPositions?: number | null;
  performanceSummary?: PerformanceSummary | null;
  recentTrades?: RecentTradeRow[] | null;
  onAfterAction?: () => void;
}) {
  const [actionBusy, setActionBusy] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!risk) {
    return (
      <section className='panel p-5'>
        <div className='flex flex-col gap-2'>
          <span className='eyebrow'>Prop firm risk control</span>
          <h2 className='font-display text-xl font-semibold'>
            Risk analytics pending
          </h2>
          <p className='text-sm text-[var(--muted)] leading-relaxed max-w-3xl'>
            The dashboard is ready for prop-firm telemetry. Deploy or restart
            the bot version that exposes{" "}
            <span className='font-mono'>propFirmRisk</span> in the live snapshot
            to populate drawdown, exposure, and trading-behavior signals.
          </p>
        </div>
      </section>
    );
  }

  const rules = {
    dailyDrawdownLimitPct: num(risk.rules?.dailyDrawdownLimitPct, 3),
    warningThresholdPct: num(risk.rules?.warningThresholdPct, 0.75),
    maxPositions: num(risk.rules?.maxPositions, num(maxPositions, 5)),
    maxAccountExposurePct: num(risk.rules?.maxAccountExposurePct, 20),
    minFidelityScore: num(risk.rules?.minFidelityScore, 85),
  };
  const account = {
    currentEquity: num(risk.account?.currentEquity),
    estimatedDayStartEquity: num(risk.account?.estimatedDayStartEquity),
    dailyPnl: num(risk.account?.dailyPnl),
    dailyDrawdownPct: num(risk.account?.dailyDrawdownPct),
    drawdownUsagePct: num(risk.account?.drawdownUsagePct),
    status: risk.account?.status ?? ("OK" as RiskSeverity),
  };
  const openRisk = {
    positions: num(risk.openRisk?.positions),
    entryPositions: num(risk.openRisk?.entryPositions),
    runners: num(risk.openRisk?.runners),
    totalNotional: num(risk.openRisk?.totalNotional),
    accountExposurePct: num(risk.openRisk?.accountExposurePct),
    largestSymbolExposurePct: num(risk.openRisk?.largestSymbolExposurePct),
    largestSymbol: risk.openRisk?.largestSymbol ?? null,
  };
  const telemetry = {
    trades: num(risk.telemetry?.trades),
    wins: num(risk.telemetry?.wins),
    losses: num(risk.telemetry?.losses),
    winRate: num(risk.telemetry?.winRate),
    netPnl: num(risk.telemetry?.netPnl),
    avgR: risk.telemetry?.avgR ?? null,
    expectancyR: risk.telemetry?.expectancyR ?? null,
    profitFactor: risk.telemetry?.profitFactor ?? null,
    maxClosedTradeLoss: num(risk.telemetry?.maxClosedTradeLoss),
    bestSymbols: risk.telemetry?.bestSymbols ?? [],
    worstSymbols: risk.telemetry?.worstSymbols ?? [],
    bySession: risk.telemetry?.bySession ?? [],
    topExitLeaks: risk.telemetry?.topExitLeaks ?? [],
  };
  const hasSnapshotTelemetry = telemetry.trades > 0;
  const derivedSymbolBuckets = buildBuckets(
    recentTrades,
    (trade) => trade.symbol
  );
  const derivedBestSymbols = derivedSymbolBuckets
    .filter((row) => row.pnl > 0)
    .sort((a, b) => b.pnl - a.pnl);
  const derivedWorstSymbols = derivedSymbolBuckets
    .filter((row) => row.pnl < 0)
    .sort((a, b) => a.pnl - b.pnl);
  const derivedExitLeaks = buildBuckets(recentTrades, (trade) =>
    trade.closeReason || "Unknown"
  )
    .filter((row) => row.pnl < 0)
    .sort((a, b) => a.pnl - b.pnl);
  const bestSymbols =
    telemetry.bestSymbols.length > 0 ? telemetry.bestSymbols : derivedBestSymbols;
  const worstSymbols =
    telemetry.worstSymbols.length > 0
      ? telemetry.worstSymbols
      : derivedWorstSymbols;
  const topExitLeaks =
    telemetry.topExitLeaks.length > 0
      ? telemetry.topExitLeaks
      : derivedExitLeaks;
  const windowStats = hasSnapshotTelemetry
    ? telemetry
    : {
        ...telemetry,
        trades: num(performanceSummary?.totalTrades),
        winRate: parsePct(performanceSummary?.winRate),
        netPnl: num(performanceSummary?.netPnL),
        avgR: performanceSummary?.avgRR ?? null,
        profitFactor:
          performanceSummary?.profitFactor === undefined
            ? null
            : performanceSummary.profitFactor,
      };
  const hasWindowTrades = windowStats.trades > 0;
  const alerts = risk.alerts ?? [];
  const recommendations = risk.recommendations ?? [];
  const windowDays = num(risk.windowDays, 30);

  const accountTone =
    account.status === "OK"
      ? "long"
      : account.status === "WATCH"
      ? "warn"
      : "short";
  const exposureSeverity: RiskSeverity =
    openRisk.accountExposurePct >= rules.maxAccountExposurePct
      ? "BREACHED"
      : openRisk.accountExposurePct >=
        rules.maxAccountExposurePct * rules.warningThresholdPct
      ? "WATCH"
      : "OK";
  const panelStatus = maxSeverity([
    account.status,
    exposureSeverity,
    ...alerts.map((alert) => alert.severity),
  ]);
  const canPauseForExposure =
    exposureSeverity === "BREACHED" || exposureSeverity === "WATCH";

  async function applyExposureGuard() {
    setActionBusy(true);
    setActionResult(null);
    setActionError(null);
    try {
      const res = await fetch("/api/operator/bot/api/trading/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? `Pause request failed (${res.status}).`);
      }
      setActionResult(
        "Exposure guard applied: trading is paused for new entries until you resume it."
      );
      onAfterAction?.();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Could not apply exposure guard."
      );
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <section className='panel'>
      <div className='p-5 border-b border-[var(--hairline)] flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4'>
        <div>
          <span className='eyebrow'>Prop firm risk control</span>
          <h2 className='font-display text-xl font-semibold mt-1'>
            Automated risk desk
          </h2>
          <p className='text-sm text-[var(--muted)] mt-1'>
            Daily loss guard, exposure limits, and leak detection from the last{" "}
            {windowDays} days.
          </p>
        </div>
        <div
          className='inline-flex items-center self-start border px-2.5 py-1 font-mono text-xs font-semibold tabular'
          style={{
            color: severityColor(panelStatus),
            borderColor: severityColor(panelStatus),
          }}>
          {panelStatus}
        </div>
      </div>

      <div className='p-5 space-y-5'>
        <div className='grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-px bg-[var(--hairline)]'>
          <Metric
            label='Daily drawdown used'
            value={fmtPct(account.drawdownUsagePct)}
            sub={`${fmtPct(account.dailyDrawdownPct)} of ${fmtPct(
              rules.dailyDrawdownLimitPct
            )} limit`}
            tone={accountTone}
          />
          <Metric
            label='Today PnL'
            value={`${account.dailyPnl >= 0 ? "+" : ""}${fmtUsd(
              account.dailyPnl
            )}`}
            sub={`Day start ${fmtUsd(account.estimatedDayStartEquity)}`}
            tone={account.dailyPnl >= 0 ? "long" : "short"}
          />
          <Metric
            label='Open exposure'
            value={fmtPct(openRisk.accountExposurePct)}
            sub={`${fmtUsd(openRisk.totalNotional)} notional`}
            tone={
              exposureSeverity === "OK"
                ? "long"
                : exposureSeverity === "WATCH"
                ? "warn"
                : "short"
            }
          />
          <Metric
            label='Entry slots'
            value={`${openRisk.entryPositions}/${rules.maxPositions}`}
            sub={`${openRisk.runners} runner${
              openRisk.runners === 1 ? "" : "s"
            } protected`}
            tone={
              openRisk.entryPositions >= rules.maxPositions ? "warn" : "neutral"
            }
          />
        </div>

        <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
          <ProgressBar
            value={account.drawdownUsagePct}
            severity={account.status}
            limitLabel='Daily drawdown budget'
          />
          <ProgressBar
            value={
              rules.maxAccountExposurePct > 0
                ? (openRisk.accountExposurePct / rules.maxAccountExposurePct) *
                  100
                : 0
            }
            severity={exposureSeverity}
            limitLabel={`Exposure cap ${fmtPct(rules.maxAccountExposurePct)}`}
          />
        </div>

        <div className='grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4'>
          <div className='border border-[var(--hairline)] bg-[var(--panel-raised)] p-3'>
            <div className='flex items-center justify-between gap-3 mb-3'>
              <span className='eyebrow'>Alerts</span>
              <span className='font-mono text-[11px] text-[var(--muted)]'>
                Largest exposure: {openRisk.largestSymbol ?? "-"}{" "}
                {fmtPct(openRisk.largestSymbolExposurePct)}
              </span>
            </div>
            {alerts.length === 0 ? (
              <p className='font-mono text-xs text-[var(--long)]'>
                No prop-firm rules are currently breached.
              </p>
            ) : (
              <div className='space-y-2'>
                {alerts.slice(0, 4).map((alert) => (
                  <div
                    key={`${alert.code}-${alert.message}`}
                    className='flex gap-2'>
                    <span
                      className='font-mono text-[10px] font-semibold border px-1.5 py-0.5 self-start'
                      style={{
                        color: severityColor(alert.severity),
                        borderColor: severityColor(alert.severity),
                      }}>
                      {alert.severity}
                    </span>
                    <p className='text-xs text-[var(--muted-dim)] leading-relaxed'>
                      {alert.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {canPauseForExposure && (
              <button
                type='button'
                onClick={() => void applyExposureGuard()}
                disabled={actionBusy}
                className='mt-4 inline-flex items-center justify-center border border-[var(--warn)] px-3 py-2 font-mono text-xs text-[var(--warn)] hover:text-[var(--text)] disabled:opacity-50'>
                {actionBusy ? "Applying guard..." : "Pause new entries"}
              </button>
            )}
          </div>

          <div className='border border-[var(--hairline)] bg-[var(--panel-raised)] p-3'>
            <span className='eyebrow'>Recommended actions</span>
            {recommendations.length === 0 ? (
              <p className='font-mono text-xs text-[var(--muted)] mt-3'>
                No action required for the current risk state.
              </p>
            ) : (
              <ul className='space-y-2 mt-3'>
                {recommendations.slice(0, 4).map((item) => (
                  <li
                    key={item}
                    className='text-xs text-[var(--muted-dim)] leading-relaxed border-l border-[var(--warn)] pl-2'>
                    {item}
                  </li>
                ))}
              </ul>
            )}
            {canPauseForExposure && (
              <div className='mt-4 border border-[var(--hairline)] bg-[var(--panel)] p-3'>
                <p className='font-mono text-[11px] text-[var(--muted-dim)] leading-relaxed'>
                  Safe automatic action available: pause new entries while
                  exposure is above the configured cap. This does not close
                  existing positions.
                </p>
              </div>
            )}
          </div>
        </div>

        {(actionResult || actionError) && (
          <div
            className='border px-3 py-2 font-mono text-xs'
            style={{
              color: actionError ? "var(--short)" : "var(--long)",
              borderColor: actionError ? "var(--short-dim)" : "var(--long-dim)",
              background: actionError
                ? "rgba(240, 73, 92, 0.08)"
                : "rgba(61, 214, 140, 0.08)",
            }}>
            {actionError ?? actionResult}
          </div>
        )}

        <div className='grid grid-cols-2 lg:grid-cols-5 gap-px bg-[var(--hairline)]'>
          <Metric
            label='Window win rate'
            value={hasWindowTrades ? fmtPct(windowStats.winRate) : "-"}
            sub={`${windowStats.trades} closed trades`}
            tone={
              !hasWindowTrades
                ? "neutral"
                : windowStats.winRate >= 50
                ? "long"
                : "short"
            }
          />
          <Metric
            label='Window net PnL'
            value={`${windowStats.netPnl >= 0 ? "+" : ""}${fmtUsd(
              windowStats.netPnl
            )}`}
            tone={windowStats.netPnl >= 0 ? "long" : "short"}
          />
          <Metric label='Avg R' value={fmtR(windowStats.avgR)} />
          <Metric label='Expectancy' value={fmtR(windowStats.expectancyR)} />
          <Metric
            label='Profit factor'
            value={
              windowStats.profitFactor === null
                ? "-"
                : windowStats.profitFactor.toFixed(2)
            }
            sub={
              hasSnapshotTelemetry
                ? `Worst loss ${fmtUsd(windowStats.maxClosedTradeLoss)}`
                : "Worst loss needs risk telemetry"
            }
            tone={
              windowStats.profitFactor === null
                ? "neutral"
                : windowStats.profitFactor >= 1
                ? "long"
                : "short"
            }
          />
        </div>

        <div className='grid grid-cols-1 xl:grid-cols-3 gap-4'>
          <BucketTable
            title='Best symbols'
            rows={bestSymbols}
            empty={
              recentTrades === null
                ? "Loading symbol performance."
                : "No winning symbols in this window."
            }
          />
          <BucketTable
            title='Worst symbols'
            rows={worstSymbols}
            empty={
              recentTrades === null
                ? "Loading symbol performance."
                : "No losing symbols in this window."
            }
          />
          <BucketTable
            title='Exit leaks'
            rows={topExitLeaks}
            empty={
              recentTrades === null
                ? "Loading exit patterns."
                : "No repeated exit leaks detected."
            }
          />
        </div>

        <BucketTable
          title='Session quality'
          rows={telemetry.bySession}
          empty={
            hasSnapshotTelemetry
              ? "No session data in this window."
              : "Session tags are not available for these trades yet."
          }
        />
      </div>
    </section>
  );
}

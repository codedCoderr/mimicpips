"use client";

import type {
  PropFirmRiskDashboard,
  PropFirmTelemetryBucket,
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

function severityColor(severity: RiskSeverity) {
  if (severity === "BREACHED") return "var(--kill-bright)";
  if (severity === "WARNING") return "var(--short)";
  if (severity === "WATCH") return "var(--warn)";
  return "var(--long)";
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
    <div className="border border-[var(--hairline)] bg-[var(--panel-raised)] p-3 min-h-[92px]">
      <span className="eyebrow">{label}</span>
      <p className="font-display text-2xl font-semibold tabular mt-1" style={{ color }}>
        {value}
      </p>
      {sub && (
        <p className="font-mono text-[11px] text-[var(--muted)] leading-relaxed mt-1">
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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] text-[var(--muted)]">{limitLabel}</span>
        <span className="font-mono text-[11px] tabular" style={{ color: severityColor(severity) }}>
          {fmtPct(value)}
        </span>
      </div>
      <div className="h-1.5 bg-[var(--hairline)] overflow-hidden">
        <div
          className="h-full"
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
    <div className="border border-[var(--hairline)] bg-[var(--panel-raised)] min-w-0">
      <div className="px-3 py-2 border-b border-[var(--hairline)]">
        <span className="eyebrow">{title}</span>
      </div>
      {rows.length === 0 ? (
        <p className="font-mono text-xs text-[var(--muted)] px-3 py-4">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="text-[10px] uppercase text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Key</th>
                <th className="px-3 py-2 font-semibold text-right">Trades</th>
                <th className="px-3 py-2 font-semibold text-right">PnL</th>
                <th className="px-3 py-2 font-semibold text-right">Avg R</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 4).map((row) => (
                <tr key={row.key} className="border-t border-[var(--hairline)]">
                  <td className="px-3 py-2 font-semibold text-[var(--text)] whitespace-nowrap">
                    {row.key}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-[var(--muted-dim)]">
                    {row.trades}
                  </td>
                  <td
                    className="px-3 py-2 text-right tabular font-semibold"
                    style={{ color: row.pnl >= 0 ? "var(--long)" : "var(--short)" }}
                  >
                    {row.pnl >= 0 ? "+" : ""}
                    {fmtUsd(row.pnl)}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-[var(--muted-dim)]">
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
}: {
  risk: PropFirmRiskDashboard | null;
}) {
  if (!risk) {
    return (
      <section className="panel p-5">
        <div className="flex flex-col gap-2">
          <span className="eyebrow">Prop firm risk control</span>
          <h2 className="font-display text-xl font-semibold">Risk analytics pending</h2>
          <p className="text-sm text-[var(--muted)] leading-relaxed max-w-3xl">
            The dashboard is ready for prop-firm telemetry. Deploy or restart the bot
            version that exposes <span className="font-mono">propFirmRisk</span> in the
            live snapshot to populate drawdown, exposure, and trading-behavior signals.
          </p>
        </div>
      </section>
    );
  }

  const accountTone =
    risk.account.status === "OK"
      ? "long"
      : risk.account.status === "WATCH"
        ? "warn"
        : "short";
  const exposureSeverity: RiskSeverity =
    risk.openRisk.accountExposurePct >= risk.rules.maxAccountExposurePct
      ? "BREACHED"
      : risk.openRisk.accountExposurePct >= risk.rules.maxAccountExposurePct * risk.rules.warningThresholdPct
        ? "WATCH"
        : "OK";

  return (
    <section className="panel">
      <div className="p-5 border-b border-[var(--hairline)] flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <span className="eyebrow">Prop firm risk control</span>
          <h2 className="font-display text-xl font-semibold mt-1">
            Automated risk desk
          </h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            Daily loss guard, exposure limits, and leak detection from the last{" "}
            {risk.windowDays} days.
          </p>
        </div>
        <div
          className="inline-flex items-center self-start border px-2.5 py-1 font-mono text-xs font-semibold tabular"
          style={{
            color: severityColor(risk.account.status),
            borderColor: severityColor(risk.account.status),
          }}
        >
          {risk.account.status}
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-px bg-[var(--hairline)]">
          <Metric
            label="Daily drawdown used"
            value={fmtPct(risk.account.drawdownUsagePct)}
            sub={`${fmtPct(risk.account.dailyDrawdownPct)} of ${fmtPct(
              risk.rules.dailyDrawdownLimitPct
            )} limit`}
            tone={accountTone}
          />
          <Metric
            label="Today PnL"
            value={`${risk.account.dailyPnl >= 0 ? "+" : ""}${fmtUsd(risk.account.dailyPnl)}`}
            sub={`Day start ${fmtUsd(risk.account.estimatedDayStartEquity)}`}
            tone={risk.account.dailyPnl >= 0 ? "long" : "short"}
          />
          <Metric
            label="Open exposure"
            value={fmtPct(risk.openRisk.accountExposurePct)}
            sub={`${fmtUsd(risk.openRisk.totalNotional)} notional`}
            tone={exposureSeverity === "OK" ? "long" : exposureSeverity === "WATCH" ? "warn" : "short"}
          />
          <Metric
            label="Entry slots"
            value={`${risk.openRisk.entryPositions}/${risk.rules.maxPositions}`}
            sub={`${risk.openRisk.runners} runner${risk.openRisk.runners === 1 ? "" : "s"} protected`}
            tone={risk.openRisk.entryPositions >= risk.rules.maxPositions ? "warn" : "neutral"}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ProgressBar
            value={risk.account.drawdownUsagePct}
            severity={risk.account.status}
            limitLabel="Daily drawdown budget"
          />
          <ProgressBar
            value={
              risk.rules.maxAccountExposurePct > 0
                ? (risk.openRisk.accountExposurePct / risk.rules.maxAccountExposurePct) * 100
                : 0
            }
            severity={exposureSeverity}
            limitLabel={`Exposure cap ${fmtPct(risk.rules.maxAccountExposurePct)}`}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4">
          <div className="border border-[var(--hairline)] bg-[var(--panel-raised)] p-3">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="eyebrow">Alerts</span>
              <span className="font-mono text-[11px] text-[var(--muted)]">
                Largest exposure: {risk.openRisk.largestSymbol ?? "-"}{" "}
                {fmtPct(risk.openRisk.largestSymbolExposurePct)}
              </span>
            </div>
            {risk.alerts.length === 0 ? (
              <p className="font-mono text-xs text-[var(--long)]">
                No prop-firm rules are currently breached.
              </p>
            ) : (
              <div className="space-y-2">
                {risk.alerts.slice(0, 4).map((alert) => (
                  <div key={`${alert.code}-${alert.message}`} className="flex gap-2">
                    <span
                      className="font-mono text-[10px] font-semibold border px-1.5 py-0.5 self-start"
                      style={{
                        color: severityColor(alert.severity),
                        borderColor: severityColor(alert.severity),
                      }}
                    >
                      {alert.severity}
                    </span>
                    <p className="text-xs text-[var(--muted-dim)] leading-relaxed">
                      {alert.message}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-[var(--hairline)] bg-[var(--panel-raised)] p-3">
            <span className="eyebrow">Recommended actions</span>
            {risk.recommendations.length === 0 ? (
              <p className="font-mono text-xs text-[var(--muted)] mt-3">
                No action required for the current risk state.
              </p>
            ) : (
              <ul className="space-y-2 mt-3">
                {risk.recommendations.slice(0, 4).map((item) => (
                  <li
                    key={item}
                    className="text-xs text-[var(--muted-dim)] leading-relaxed border-l border-[var(--warn)] pl-2"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-px bg-[var(--hairline)]">
          <Metric
            label="Window win rate"
            value={fmtPct(risk.telemetry.winRate)}
            sub={`${risk.telemetry.trades} closed trades`}
            tone={risk.telemetry.winRate >= 50 ? "long" : "short"}
          />
          <Metric
            label="Window net PnL"
            value={`${risk.telemetry.netPnl >= 0 ? "+" : ""}${fmtUsd(risk.telemetry.netPnl)}`}
            tone={risk.telemetry.netPnl >= 0 ? "long" : "short"}
          />
          <Metric label="Avg R" value={fmtR(risk.telemetry.avgR)} />
          <Metric label="Expectancy" value={fmtR(risk.telemetry.expectancyR)} />
          <Metric
            label="Profit factor"
            value={risk.telemetry.profitFactor === null ? "-" : risk.telemetry.profitFactor.toFixed(2)}
            sub={`Worst loss ${fmtUsd(risk.telemetry.maxClosedTradeLoss)}`}
            tone={(risk.telemetry.profitFactor ?? 0) >= 1 ? "long" : "short"}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <BucketTable
            title="Best symbols"
            rows={risk.telemetry.bestSymbols}
            empty="No winning symbols in this window."
          />
          <BucketTable
            title="Worst symbols"
            rows={risk.telemetry.worstSymbols}
            empty="No losing symbols in this window."
          />
          <BucketTable
            title="Exit leaks"
            rows={risk.telemetry.topExitLeaks}
            empty="No repeated exit leaks detected."
          />
        </div>

        <BucketTable
          title="Session quality"
          rows={risk.telemetry.bySession}
          empty="No session data in this window."
        />
      </div>
    </section>
  );
}

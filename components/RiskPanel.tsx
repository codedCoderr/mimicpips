"use client";

import type { RiskStatus } from "@/lib/types";

function Flag({ label, tripped }: { label: string; tripped: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--hairline)] last:border-b-0">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span
        className="font-mono text-[10px] font-semibold px-1.5 py-0.5"
        style={{
          color: tripped ? "var(--kill-bright)" : "var(--long)",
          border: `1px solid ${tripped ? "var(--kill)" : "var(--long-dim)"}`,
        }}
      >
        {tripped ? "TRIPPED" : "CLEAR"}
      </span>
    </div>
  );
}

export function RiskPanel({ risk }: { risk: RiskStatus }) {
  return (
    <div className="panel p-5">
      <span className="eyebrow block mb-3">Risk State</span>
      <Flag label="Kill switch" tripped={risk.killSwitch} />
      <Flag label="Daily loss limit" tripped={risk.dailyLimit} />
      <Flag label="Trading paused" tripped={risk.tradingPaused} />
      <Flag label="Trading halted" tripped={risk.tradingHalted} />

      <div className="mt-4 pt-4 border-t border-[var(--hairline)] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)] font-mono">Drawdown</span>
          <span className="text-xs font-mono tabular text-[var(--text)]">
            {(risk.drawdownPct * 100).toFixed(2)}%
          </span>
        </div>
        <div className="w-full h-1.5 bg-[var(--hairline)] overflow-hidden">
          <div
            className="h-full"
            style={{
              width: `${Math.min(100, risk.drawdownPct * 100 * 4)}%`,
              background:
                risk.drawdownPct > 0.04
                  ? "var(--kill-bright)"
                  : risk.drawdownPct > 0.02
                    ? "var(--warn)"
                    : "var(--long)",
            }}
          />
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-[var(--muted)] font-mono">Peak balance</span>
          <span className="text-xs font-mono tabular text-[var(--text)]">
            ${risk.peakBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>
    </div>
  );
}

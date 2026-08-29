"use client";

import type { DashboardSnapshot } from "@/lib/types";

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
      <span
        className="font-display font-semibold text-2xl tabular"
        style={{ color }}
      >
        {value}
      </span>
      {sub && <span className="font-mono text-[11px] text-[var(--muted)]">{sub}</span>}
    </div>
  );
}

export function AccountSummary({ snapshot }: { snapshot: DashboardSnapshot }) {
  const { account } = snapshot;
  const returnPositive = account.accountReturnPct > 0;
  const returnNegative = account.accountReturnPct < 0;
  const pnlPositive = account.unrealizedPnl > 0;
  const pnlNegative = account.unrealizedPnl < 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--hairline)]">
      <Tile
        label="Total Balance"
        value={fmtUsd(account.totalBalance)}
        sub={`Available ${fmtUsd(account.availableBalance)}`}
      />
      <Tile
        label="Account Return"
        value={`${returnPositive ? "+" : ""}${account.accountReturnPct.toFixed(2)}%`}
        sub={`from ${fmtUsd(account.startingBalance)}`}
        accent={returnPositive ? "long" : returnNegative ? "short" : "neutral"}
      />
      <Tile
        label="Unrealized PnL"
        value={`${pnlPositive ? "+" : ""}${fmtUsd(account.unrealizedPnl)}`}
        sub={`${account.openPositions}/${account.maxPositions} positions open`}
        accent={pnlPositive ? "long" : pnlNegative ? "short" : "neutral"}
      />
      <Tile
        label="Margin Usage"
        value={`${account.marginUsagePct.toFixed(1)}%`}
        sub={`${account.effectiveLeverage.toFixed(2)}x effective leverage`}
        accent={
          account.marginUsagePct > 70
            ? "short"
            : account.marginUsagePct > 40
              ? "warn"
              : "neutral"
        }
      />
    </div>
  );
}

"use client";

import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import type { EquityPoint } from "@/lib/types";

export function EquityChart({ data }: { data: EquityPoint[] }) {
  const positive =
    data.length > 1 ? data[data.length - 1].balance >= data[0].balance : true;
  const color = positive ? "var(--long)" : "var(--short)";

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="eyebrow">Equity — live session</span>
        {data.length > 0 && (
          <span className="font-mono text-xs text-[var(--muted)]">
            {data.length} sample{data.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {data.length < 2 ? (
        <div className="h-[220px] flex items-center justify-center">
          <p className="font-mono text-xs text-[var(--muted)]">
            Gathering samples…
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="t"
              tickFormatter={(t) =>
                new Date(t).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }
              stroke="var(--muted-dim)"
              fontSize={10}
              fontFamily="var(--font-mono)"
              tickLine={false}
              axisLine={{ stroke: "var(--hairline)" }}
              minTickGap={40}
            />
            <YAxis
              domain={["auto", "auto"]}
              stroke="var(--muted-dim)"
              fontSize={10}
              fontFamily="var(--font-mono)"
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              width={70}
            />
            <Tooltip
              contentStyle={{
                background: "var(--panel-raised)",
                border: "1px solid var(--hairline-bright)",
                borderRadius: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
              }}
              labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString()}
              formatter={(v) => [
                `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                "Balance",
              ]}
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke={color}
              strokeWidth={1.75}
              fill="url(#equityFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
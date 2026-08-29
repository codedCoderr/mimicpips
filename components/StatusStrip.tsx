"use client";

import type { DashboardSnapshot } from "@/lib/types";
import type { ConnState } from "@/lib/useLiveSnapshot";
import clsx from "clsx";

function systemColor(status: DashboardSnapshot["systemStatus"]) {
  if (status === "ACTIVE") return "var(--long)";
  if (status === "PAUSED") return "var(--warn)";
  return "var(--kill-bright)";
}

function healthColor(status: string) {
  if (status === "healthy") return "text-[var(--long)]";
  if (status === "degraded") return "text-[var(--warn)]";
  return "text-[var(--short)]";
}

function connLabel(state: ConnState) {
  switch (state) {
    case "live":
      return { text: "LIVE", color: "var(--long)" };
    case "connecting":
      return { text: "CONNECTING", color: "var(--warn)" };
    case "reconnecting":
      return { text: "RECONNECTING", color: "var(--warn)" };
    case "offline":
      return { text: "OFFLINE", color: "var(--short)" };
  }
}

export function StatusStrip({
  snapshot,
  connState,
}: {
  snapshot: DashboardSnapshot | null;
  connState: ConnState;
}) {
  const conn = connLabel(connState);

  // Safely resolve health status string whether snapshot.health is a string or an object
  const healthStatus = snapshot?.health
    ? typeof snapshot.health === "string"
      ? snapshot.health
      : snapshot.health.status
    : "unhealthy";

  return (
    <div className="panel border-x-0 border-t-0 px-6 py-3 flex items-center justify-between flex-wrap gap-y-2">
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full pulse-dot"
            style={{ background: conn.color }}
          />
          <span className="eyebrow" style={{ color: conn.color }}>
            {conn.text}
          </span>
        </div>

        {snapshot && (
          <>
            <div className="w-px h-4 bg-[var(--hairline)]" />
            <div className="flex items-center gap-2">
              <span className="eyebrow">System</span>
              <span
                className="font-mono text-xs font-semibold px-2 py-0.5"
                style={{
                  color: systemColor(snapshot.systemStatus),
                  border: `1px solid ${systemColor(snapshot.systemStatus)}`,
                }}
              >
                {snapshot.systemStatus}
              </span>
            </div>

            <div className="w-px h-4 bg-[var(--hairline)]" />
            <div className="flex items-center gap-2">
              <span className="eyebrow">Mode</span>
              <span className="font-mono text-xs text-[var(--text)]">
                {snapshot.tradingMode}
              </span>
            </div>

            <div className="w-px h-4 bg-[var(--hairline)]" />
            <div className="flex items-center gap-2">
              <span className="eyebrow">Telegram</span>
              <span
                className={clsx(
                  "font-mono text-xs",
                  snapshot.telegram.online
                    ? "text-[var(--long)]"
                    : "text-[var(--muted)]"
                )}
              >
                {snapshot.telegram.online
                  ? snapshot.telegram.botUsername || "online"
                  : snapshot.telegram.state}
              </span>
            </div>

            <div className="w-px h-4 bg-[var(--hairline)]" />
            <div className="flex items-center gap-2">
              <span className="eyebrow">Health</span>
              <span
                className={clsx(
                  "font-mono text-xs font-semibold",
                  healthColor(healthStatus)
                )}
              >
                {healthStatus}
              </span>
            </div>
          </>
        )}
      </div>

      {snapshot && (
        <span className="eyebrow tabular">
          {new Date(snapshot.timestamp).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
"use client";

import { WifiOff } from "lucide-react";

function formatRelativeTime(timestamp: number, now: number): string {
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

export function StaleDataBanner({
  lastUpdatedAt,
  now,
}: {
  lastUpdatedAt: number | null;
  now: number;
}) {
  return (
    <div className="flex items-center gap-2 text-xs font-mono text-[var(--warn)] border-b border-[var(--warn)]/40 bg-[var(--warn)]/5 px-6 py-2">
      <WifiOff size={13} className="shrink-0" />
      <span>
        Showing the last data received
        {lastUpdatedAt ? ` — ${formatRelativeTime(lastUpdatedAt, now)}` : ""}.
        Reconnecting…
      </span>
    </div>
  );
}
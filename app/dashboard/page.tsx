"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Receipt, FlaskConical, Clock } from "lucide-react";
import { loadSession, clearSession, type Session } from "@/lib/session";
import { useLiveSnapshot } from "@/lib/useLiveSnapshot";
import { fetchRecentTrades, ApiError } from "@/lib/api";
import type { RecentTradeRow, DashboardSnapshot } from "@/lib/types";
import { StatusStrip } from "@/components/StatusStrip";
import { AccountSummary } from "@/components/AccountSummary";
import { PositionsTable } from "@/components/PositionsTable";
import { TradeHistoryTable } from "@/components/TradeHistoryTable";
import { PerformanceSummaryPanel } from "@/components/PerformanceSummaryPanel";
import { EquityChart } from "@/components/EquityChart";
import { RiskPanel } from "@/components/RiskPanel";
import { KillSwitch } from "@/components/KillSwitch";

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const existing = loadSession();
    if (!existing) {
      router.replace("/setup");
      return;
    }
    setSession(existing);
    setReady(true);
  }, [router]);

  const { snapshot, connState, equityCurve, refreshSnapshot } = useLiveSnapshot(session);

  // --- Snapshot Caching & Last Refreshed Time ---
  const [cachedSnapshot, setCachedSnapshot] = useState<DashboardSnapshot | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  useEffect(() => {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("last_valid_snapshot");
    if (saved) {
      try { setCachedSnapshot(JSON.parse(saved)); } catch {}
    }
  }
}, []);

useEffect(() => {
  if (snapshot && snapshot.account?.totalBalance > 0 && snapshot.health as any !== "unhealthy") {
    setCachedSnapshot(snapshot);
    localStorage.setItem("last_valid_snapshot", JSON.stringify(snapshot));
  }
}, [snapshot]);

// 1. Resolve live health status string
const liveHealthStatus = snapshot?.health
  ? typeof snapshot.health === "string"
    ? snapshot.health
    : snapshot.health.status
  : "unhealthy";

// 2. Check if live feed is degraded or failing
const isLiveDegraded =
  !snapshot ||
  liveHealthStatus === "unhealthy" ||
  snapshot.account?.totalBalance === 0;

// 3. Fallback to cache for balance data, BUT enforce real-time health status
const displaySnapshot:any =
  isLiveDegraded && cachedSnapshot
    ? {
        ...cachedSnapshot,
        health: liveHealthStatus === "healthy" ? "degraded" : liveHealthStatus,
      }
    : snapshot;
    
  // --- Trade History Pagination State ---
  const [trades, setTrades] = useState<RecentTradeRow[] | null>(null);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesError, setTradesError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMoreTrades, setHasMoreTrades] = useState(true);

  const loadTrades = useCallback(
    async (pageNum: number, isInitial = false) => {
      if (!session) return;
      setTradesLoading(true);

      try {
        const limit = 10;
        const offset = (pageNum - 1) * limit;
        const result = await fetchRecentTrades(session, limit, offset);

        setTrades((prev) => (isInitial || !prev ? result : [...prev, ...result]));
        setHasMoreTrades(result.length === limit);
        setTradesError(null);
      } catch (err) {
        setTradesError(
          err instanceof ApiError ? err.message : "Failed to load trade history."
        );
      } finally {
        setTradesLoading(false);
      }
    },
    [session]
  );

  useEffect(() => {
    if (session) {
      setPage(1);
      loadTrades(1, true);
    }
  }, [session, loadTrades]);

  const handleLoadMore = useCallback(() => {
    if (tradesLoading || !hasMoreTrades) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadTrades(nextPage, false);
  }, [tradesLoading, hasMoreTrades, page, loadTrades]);

  const refetch = useCallback(() => {
    if (!session) return;
    if (refreshSnapshot) {
      refreshSnapshot();
    }
    setPage(1);
    loadTrades(1, true);
  }, [session, loadTrades, refreshSnapshot]);

  async function handleDisconnect() {
    clearSession();
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  }

  if (!ready || !session) return null;

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
  <div className="flex items-center gap-3">
    <div className="w-2.5 h-2.5 rounded-full bg-[var(--long)]" />
    <span className="font-display font-semibold text-lg">Control Room</span>
  </div>

  <div className="flex items-center gap-3">
    {/* Trigger badge if socket is disconnected OR backend health is unhealthy */}
    {(connState !== "live" || snapshot?.health as any === "unhealthy") && (
      <span className="text-xs font-mono text-[var(--short)] border border-[var(--short-dim)] px-2 py-0.5 rounded mr-2">
        {snapshot?.health as any === "unhealthy"
          ? "EXCHANGE UNHEALTHY (DISPLAYING CACHED)"
          : connState === "reconnecting"
          ? "RECONNECTING (DISPLAYING CACHED)"
          : "OFFLINE (DISPLAYING CACHED)"}
      </span>
    )}

    <button
      onClick={() => router.push("/dashboard/ledger")}
      className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
    >
      <Receipt size={13} />
      Ledger
    </button>
    <button
      onClick={() => router.push("/dashboard/backtest")}
      className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
    >
      <FlaskConical size={13} />
      Backtest
    </button>
    <div className="w-px h-4 bg-[var(--hairline)]" />
    <button
      onClick={() => void handleDisconnect()}
      className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
    >
      <LogOut size={13} />
      Sign out
    </button>
  </div>
</header>

      <StatusStrip snapshot={displaySnapshot} connState={connState} />

      <div className="flex-1 p-6">
        {!displaySnapshot ? (
          <div className="h-[60vh] flex items-center justify-center">
            <p className="font-mono text-sm text-[var(--muted)]">
              Waiting for data from the bot…
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 max-w-[1400px] mx-auto">
            <div className="space-y-6 min-w-0">
              <AccountSummary snapshot={displaySnapshot} />
              <PerformanceSummaryPanel session={session} />
              <PositionsTable
                positions={displaySnapshot.positions}
                session={session}
                onPositionClosed={refetch}
              />
              <TradeHistoryTable
                trades={trades}
                loading={tradesLoading}
                error={tradesError}
                onLoadMore={handleLoadMore}
                hasMore={hasMoreTrades}
              />
              <EquityChart data={equityCurve} />
            </div>

            <div className="space-y-6">
              <KillSwitch session={session} snapshot={displaySnapshot} onAfterAction={refetch} />
              <RiskPanel risk={displaySnapshot.risk} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
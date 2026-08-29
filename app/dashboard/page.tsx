"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Receipt, FlaskConical, Users } from "lucide-react";
import { loadSession, clearSession, type Session } from "@/lib/session";
import { useLiveSnapshot } from "@/lib/useLiveSnapshot";
import { fetchRecentTrades, ApiError } from "@/lib/api";
import type { RecentTradeRow, DashboardSnapshot } from "@/lib/types";
import { StatusStrip } from "@/components/StatusStrip";
import { AccountSummary } from "@/components/AccountSummary";
import { PositionsTable } from "@/components/PositionsTable";
import { TradeHistoryTable } from "@/components/TradeHistoryTable";
import { PerformanceSummaryPanel } from "@/components/PerformanceSummaryPanel";
import { FollowersSummaryPanel } from "@/components/FollowersSummaryPanel";
import { EquityChart } from "@/components/EquityChart";
import { RiskPanel } from "@/components/RiskPanel";
import { KillSwitch } from "@/components/KillSwitch";
import { BrandMark } from "@/components/BrandMark";

export default function DashboardPage () {
  const router = useRouter();
  const [ session, setSession ] = useState<Session | null>( null );
  const [ ready, setReady ] = useState( false );

  useEffect( () => {
    const existing = loadSession();
    if ( !existing ) {
      router.replace( "/setup" );
      return;
    }
    setSession( existing );
    setReady( true );
  }, [ router ] );

  const handleBotEventRef = useRef<( event: import( "@/lib/types" ).BotEvent ) => void>( () => { } );
  const handleBotEvent = useCallback( ( event: import( "@/lib/types" ).BotEvent ) => {
    handleBotEventRef.current( event );
  }, [] );

  const { snapshot, connState, equityCurve, refreshSnapshot } = useLiveSnapshot( session, handleBotEvent );

  const displaySnapshot: DashboardSnapshot | null = snapshot;

  // --- Trade History Pagination State ---
  const [ trades, setTrades ] = useState<RecentTradeRow[] | null>( null );
  const [ tradesLoading, setTradesLoading ] = useState( true );
  const [ tradesError, setTradesError ] = useState<string | null>( null );
  const [ page, setPage ] = useState( 1 );
  const [ hasMoreTrades, setHasMoreTrades ] = useState( true );
  const previousOpenSymbolsRef = useRef<Set<string> | null>( null );

  const loadTrades = useCallback(
    async ( pageNum: number, isInitial = false ) => {
      if ( !session ) return;
      setTradesLoading( true );

      try {
        const limit = 10;
        const offset = ( pageNum - 1 ) * limit;
        const { trades: page, hasMore } = await fetchRecentTrades( session, limit, offset );

        setTrades( ( prev ) => ( isInitial || !prev ? page : [ ...prev, ...page ] ) );
        setHasMoreTrades( hasMore );
        setTradesError( null );
      } catch ( err ) {
        setTradesError(
          err instanceof ApiError ? err.message : "Failed to load trade history."
        );
      } finally {
        setTradesLoading( false );
      }
    },
    [ session ]
  );

  useEffect( () => {
    if ( session ) {
      setPage( 1 );
      loadTrades( 1, true );
    }
  }, [ session, loadTrades ] );

  const handleLoadMore = useCallback( () => {
    if ( tradesLoading || !hasMoreTrades ) return;
    const nextPage = page + 1;
    setPage( nextPage );
    loadTrades( nextPage, false );
  }, [ tradesLoading, hasMoreTrades, page, loadTrades ] );

  const refetch = useCallback( () => {
    if ( !session ) return;
    if ( refreshSnapshot ) {
      refreshSnapshot();
    }
    setPage( 1 );
    loadTrades( 1, true );
  }, [ session, loadTrades, refreshSnapshot ] );

  useEffect( () => {
    handleBotEventRef.current = ( event ) => {
      if ( event.type === "position.closed" || event.type === "snapshot.updated" ) {
        refetch();
      }
    };
  }, [ refetch ] );

  useEffect( () => {
    if ( !displaySnapshot ) return;

    const currentOpenSymbols = new Set(
      displaySnapshot.positions.map( ( position ) => position.fullSymbol || position.symbol )
    );
    const previousOpenSymbols = previousOpenSymbolsRef.current;
    previousOpenSymbolsRef.current = currentOpenSymbols;

    if ( !previousOpenSymbols ) return;

    for ( const symbol of previousOpenSymbols ) {
      if ( !currentOpenSymbols.has( symbol ) ) {
        refetch();
        break;
      }
    }
  }, [ displaySnapshot, refetch ] );

  useEffect( () => {
    if ( !session ) return;
    const id = setInterval( () => {
      void loadTrades( 1, true );
    }, 30_000 );
    return () => clearInterval( id );
  }, [ session, loadTrades ] );

  async function handleDisconnect () {
    clearSession();
    await fetch( "/api/operator/bot-session", { method: "DELETE" } ).catch( () => { } );
    await fetch( "/api/logout", { method: "POST" } ).catch( () => { } );
    router.push( "/login" );
  }

  if ( !ready || !session ) return null;

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
        <BrandMark label="Mimic Pips" />

        <div className="flex items-center gap-3">
          {/* Trigger badge if socket is disconnected OR backend health is unhealthy */ }
          { ( connState !== "live" || snapshot?.health?.status === "unhealthy" ) && (
            <span className="text-xs font-mono text-[var(--short)] border border-[var(--short-dim)] px-2 py-0.5 rounded mr-2">
              { snapshot?.health?.status === "unhealthy"
                ? "EXCHANGE UNHEALTHY (DISPLAYING CACHED)"
                : connState === "reconnecting"
                  ? "RECONNECTING (DISPLAYING CACHED)"
                  : "OFFLINE (DISPLAYING CACHED)" }
            </span>
          ) }

          <button
            onClick={ () => router.push( "/dashboard/ledger" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <Receipt size={ 13 } />
            Ledger
          </button>
          <button
            onClick={ () => router.push( "/dashboard/backtest" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <FlaskConical size={ 13 } />
            Backtest
          </button>
          <button
            onClick={ () => router.push( "/dashboard/followers" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <Users size={ 13 } />
            Followers
          </button>
          <div className="w-px h-4 bg-[var(--hairline)]" />
          <button
            onClick={ () => void handleDisconnect() }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <LogOut size={ 13 } />
            Sign out
          </button>
        </div>
      </header>

      <StatusStrip snapshot={ displaySnapshot } connState={ connState } />

      <div className="flex-1 p-6">
        { !displaySnapshot ? (
          <div className="h-[60vh] flex items-center justify-center">
            <p className="font-mono text-sm text-[var(--muted)]">
              Waiting for data from the bot…
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 max-w-[1400px] mx-auto">
            <div className="space-y-6 min-w-0">
              <AccountSummary snapshot={ displaySnapshot } />
              <PerformanceSummaryPanel session={ session } />
              <FollowersSummaryPanel />
              <PositionsTable
                positions={ displaySnapshot.positions }
                session={ session }
                onPositionClosed={ refetch }
              />
              <TradeHistoryTable
                trades={ trades }
                loading={ tradesLoading }
                error={ tradesError }
                onLoadMore={ handleLoadMore }
                hasMore={ hasMoreTrades }
              />
              <EquityChart data={ equityCurve } />
            </div>

            <div className="space-y-6">
              <KillSwitch session={ session } snapshot={ displaySnapshot } onAfterAction={ refetch } />
              <RiskPanel risk={ displaySnapshot.risk } />
            </div>
          </div>
        ) }
      </div>
    </main>
  );
}

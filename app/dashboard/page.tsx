"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { loadSession, type Session } from "@/lib/session";
import { useLiveSnapshot } from "@/lib/useLiveSnapshot";
import { fetchRecentTrades, ApiError } from "@/lib/api";
import type { RecentTradeRow, DashboardSnapshot } from "@/lib/types";
import { StatusStrip } from "@/components/StatusStrip";
import { AccountSummary } from "@/components/AccountSummary";
import { PerformanceSummaryPanel } from "@/components/PerformanceSummaryPanel";
import { OperatorHeader } from "@/components/OperatorHeader";

// Dynamically import heavy UI panels to eliminate layout shift and reduce initial JS bundle size
const FollowersSummaryPanel = dynamic(
  () => import( "@/components/FollowersSummaryPanel" ).then( ( mod ) => mod.FollowersSummaryPanel ),
  { ssr: false, loading: () => <div className="h-24 panel animate-pulse" /> }
);

const PositionsTable = dynamic(
  () => import( "@/components/PositionsTable" ).then( ( mod ) => mod.PositionsTable ),
  { ssr: false, loading: () => <div className="h-48 panel animate-pulse" /> }
);

const TradeHistoryTable = dynamic(
  () => import( "@/components/TradeHistoryTable" ).then( ( mod ) => mod.TradeHistoryTable ),
  { ssr: false, loading: () => <div className="h-64 panel animate-pulse" /> }
);

const EquityChart = dynamic(
  () => import( "@/components/EquityChart" ).then( ( mod ) => mod.EquityChart ),
  { ssr: false, loading: () => <div className="h-[300px] panel animate-pulse" /> }
);

const KillSwitch = dynamic(
  () => import( "@/components/KillSwitch" ).then( ( mod ) => mod.KillSwitch ),
  { ssr: false, loading: () => <div className="h-32 panel animate-pulse" /> }
);

const RiskPanel = dynamic(
  () => import( "@/components/RiskPanel" ).then( ( mod ) => mod.RiskPanel ),
  { ssr: false, loading: () => <div className="h-48 panel animate-pulse" /> }
);

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

  if ( !ready || !session ) {
    return (
      <main className="min-h-screen flex flex-col bg-[var(--bg)]">
        <div className="h-16 border-b border-[var(--hairline)] animate-pulse" />
        <div className="flex-1 p-6 max-w-[1400px] mx-auto w-full space-y-6">
          <div className="h-32 panel animate-pulse" />
          <div className="h-64 panel animate-pulse" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col">
      <OperatorHeader
        status={ ( connState !== "live" || snapshot?.health?.status === "unhealthy" ) ? (
          <span className="text-xs font-mono text-[var(--short)] border border-[var(--short-dim)] px-2 py-0.5 rounded">
            { snapshot?.health?.status === "unhealthy"
              ? "EXCHANGE UNHEALTHY (DISPLAYING CACHED)"
              : connState === "reconnecting"
                ? "RECONNECTING (DISPLAYING CACHED)"
                : "OFFLINE (DISPLAYING CACHED)" }
          </span>
        ) : null }
      />

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
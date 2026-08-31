"use client";

import { useEffect, useState, useCallback } from "react";
import { Crosshair, TrendingUp, BarChart3, Activity } from "lucide-react";
import { FollowerHeader } from "@/components/FollowerHeader";

type DurationFilter = "7D" | "1M" | "3M" | "1Y" | "ALL";

interface LeaderStats {
  winRate: number;
  totalProfitPercent: number;
  totalTrades: number;
  pnl: number;
}

interface TradeRecord {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  roiPercentage: number;
  closedAt: string;
}

function fmtUsd ( n: number | null ): string {
  if ( n === null ) return "—";
  return `$${ n.toLocaleString( "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) }`;
}

export function PerformanceClient () {
  const [ filter, setFilter ] = useState<DurationFilter>( "1M" );
  const [ stats, setStats ] = useState<LeaderStats | null>( null );
  const [ trades, setTrades ] = useState<TradeRecord[]>( [] );
  const [ loading, setLoading ] = useState( true );

  const loadData = useCallback( () => {
    setLoading( true );
    fetch( `/api/saas/leader-history?filter=${ filter }` )
      .then( ( res ) => res.json() )
      .then( ( data ) => {
        setStats( data.stats );
        setTrades( data.trades );
      } )
      .catch( () => {
        setStats( null );
        setTrades( [] );
      } )
      .finally( () => setLoading( false ) );
  }, [ filter ] );

  useEffect( () => {
    loadData();
  }, [ loadData ] );

  useEffect( () => {
    fetch( "/api/saas/behaviour-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify( { type: "performance_view", metadata: { surface: "performance", filter } } ),
    } ).catch( () => {} );
  }, [ filter ] );

  const durations: DurationFilter[] = [ "7D", "1M", "3M", "1Y", "ALL" ];
  return (
    <main className="min-h-screen flex flex-col">
      <FollowerHeader />

      <div className="flex-1 p-6">
        <div className="max-w-[900px] mx-auto space-y-6">

          {/* Header & Filters */ }
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <span className="eyebrow">Leader Performance</span>
              <h1 className="font-display text-2xl font-semibold mt-1">Trading History</h1>
            </div>

            <div className="flex items-center border border-[var(--hairline)] p-0.5" style={ { background: "var(--panel-raised)" } }>
              { durations.map( ( d ) => (
                <button
                  key={ d }
                  onClick={ () => setFilter( d ) }
                  className="text-xs font-mono px-3 py-1.5 transition-colors"
                  style={ {
                    background: filter === d ? "var(--text)" : "transparent",
                    color: filter === d ? "var(--bg)" : "var(--muted)",
                  } }
                >
                  { d }
                </button>
              ) ) }
            </div>
          </div>

          {/* Stats Grid */ }
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="panel p-5 space-y-1">
              <span className="eyebrow flex items-center gap-1.5"><Crosshair size={ 12 } /> Win Rate</span>
              <p className="font-display text-2xl font-semibold mt-1">
                { loading || !stats ? "—" : `${ stats.winRate }%` }
              </p>
            </div>
            <div className="panel p-5 space-y-1">
              <span className="eyebrow flex items-center gap-1.5"><TrendingUp size={ 12 } /> Total Profit</span>
              <p className="font-display text-2xl font-semibold mt-1" style={ { color: stats?.totalProfitPercent && stats.totalProfitPercent > 0 ? "var(--long)" : "inherit" } }>
                { loading || !stats ? "—" : `${ stats.totalProfitPercent > 0 ? '+' : '' }${ stats.totalProfitPercent }%` }
              </p>
            </div>
            <div className="panel p-5 space-y-1">
              <span className="eyebrow flex items-center gap-1.5"><BarChart3 size={ 12 } /> PnL (USDT)</span>
              <p className="font-display text-2xl font-semibold mt-1" style={ { color: stats?.pnl && stats.pnl >= 0 ? "var(--long)" : "var(--short)" } }>
                { loading || !stats ? "—" : fmtUsd( stats.pnl ) }
              </p>
            </div>
            <div className="panel p-5 space-y-1">
              <span className="eyebrow flex items-center gap-1.5"><Activity size={ 12 } /> Total Trades</span>
              <p className="font-display text-2xl font-semibold mt-1">
                { loading || !stats ? "—" : stats.totalTrades }
              </p>
            </div>
          </div>

          {/* Trade Table */ }
          <div className="panel overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--hairline)]">
              <span className="eyebrow">Closed Positions ({ filter })</span>
            </div>

            { loading ? (
              <div className="divide-y divide-[var(--hairline)]">
                { Array.from( { length: 6 } ).map( ( _, i ) => (
                  <div key={ i } className="px-4 py-3 flex items-center gap-4">
                    <div className="h-3 w-14 bg-[var(--panel-raised)] animate-pulse" />
                    <div className="h-3 w-10 bg-[var(--panel-raised)] animate-pulse" />
                    <div className="h-3 w-20 bg-[var(--panel-raised)] animate-pulse" />
                    <div className="h-3 w-20 bg-[var(--panel-raised)] animate-pulse" />
                    <div className="h-3 w-12 bg-[var(--panel-raised)] animate-pulse ml-auto" />
                  </div>
                ) ) }
              </div>
            ) : trades.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-[var(--muted)] font-mono">No trades found for this period.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--hairline)]">
                      { [ "Symbol", "Side", "Entry Price", "Exit Price", "ROI", "Closed At" ].map( ( h ) => (
                        <th key={ h } className="eyebrow text-left px-4 py-2.5 font-normal whitespace-nowrap">
                          { h }
                        </th>
                      ) ) }
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    { trades
                      .sort( ( a, b ) => new Date( b.closedAt ).getTime() - new Date( a.closedAt ).getTime() )
                      .map( ( t ) => (
                        <tr
                          key={ t.id }
                          className="border-b border-[var(--hairline)] last:border-b-0 hover:bg-[var(--panel-raised)] transition-colors"
                        >
                          <td className="px-4 py-2.5 font-semibold whitespace-nowrap">{ t.symbol }</td>
                          <td className="px-4 py-2.5">
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.5"
                              style={ {
                                color: t.side === "LONG" ? "var(--long)" : "var(--short)",
                                border: `1px solid ${ t.side === "LONG" ? "var(--long-dim)" : "var(--short-dim)" }`,
                              } }
                            >
                              { t.side }
                            </span>
                          </td>
                          <td className="px-4 py-2.5 tabular">{ fmtUsd( t.entryPrice ) }</td>
                          <td className="px-4 py-2.5 tabular">{ fmtUsd( t.exitPrice ) }</td>
                          <td className="px-4 py-2.5 font-semibold" style={ { color: t.roiPercentage >= 0 ? "var(--long)" : "var(--short)" } }>
                            { t.roiPercentage >= 0 ? "+" : "" }{ t.roiPercentage }%
                          </td>
                          <td className="px-4 py-2.5 text-[var(--muted)] whitespace-nowrap">
                            { new Date( t.closedAt ).toLocaleDateString() }
                          </td>
                        </tr>
                      ) ) }
                  </tbody>
                </table>
              </div>
            ) }
          </div>

        </div>
      </div>
    </main>
  );
}
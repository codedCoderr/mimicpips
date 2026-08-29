"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  User,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  ZapOff,
  TrendingUp,
  Activity,
  Target
} from "lucide-react";

interface GateStatus {
  emailVerified: boolean;
  exchangeConnected: boolean;
  subscriptionActive: boolean;
  noPendingInvoice: boolean;
  allGatesMet: boolean;
}

interface CopyTradeLogEntry {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  marginAllocated: number;
  realizedPnl: number;
  roiPercentage: number;
  status: string;
  executedAt: string;
  createdAt: string;
}

function fmtUsd ( n: number | null ): string {
  if ( n === null ) return "—";
  return `$${ n?.toLocaleString( "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) }`;
}

function GateRow ( { label, met }: { label: string; met: boolean } ) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--hairline)] last:border-b-0">
      <span className="text-sm text-[var(--muted)]">{ label }</span>
      { met ? (
        <span className="flex items-center gap-1 text-xs font-mono" style={ { color: "var(--long)" } }>
          <CheckCircle2 size={ 13 } />
          Met
        </span>
      ) : (
        <span className="flex items-center gap-1 text-xs font-mono" style={ { color: "var(--muted)" } }>
          <XCircle size={ 13 } />
          Not yet
        </span>
      ) }
    </div>
  );
}

function statusColor ( status: string ): string {
  if ( status === "executed" || status === "SUCCESS" ) return "var(--long)";
  if ( status === "failed" ) return "var(--short)";
  return "var(--muted)";
}

export function CopyTradingDashboardClient ( {
  displayName,
  copyTradingEnabled: initialEnabled,
}: {
  displayName: string;
  copyTradingEnabled: boolean;
} ) {
  const router = useRouter();
  const [ enabled, setEnabled ] = useState( initialEnabled );
  const [ gates, setGates ] = useState<GateStatus | null>( null );
  const [ toggling, setToggling ] = useState( false );
  const [ toggleError, setToggleError ] = useState<string | null>( null );
  const [ logEntries, setLogEntries ] = useState<CopyTradeLogEntry[] | null>( null );
  const [ logLoading, setLogLoading ] = useState( true );

  const loadGates = useCallback( () => {
    fetch( "/api/saas/copy-trading" )
      .then( ( res ) => res.json() )
      .then( ( data ) => {
        setEnabled( data.copyTradingEnabled );
        setGates( data.gates );
      } )
      .catch( () => { } );
  }, [] );

  useEffect( () => {
    loadGates();
  }, [ loadGates ] );

  useEffect( () => {
    setLogLoading( true );
    fetch( "/api/saas/copy-trade-log?limit=20" )
      .then( ( res ) => res.json() )
      .then( ( data ) => setLogEntries( data.entries ) )
      .catch( () => setLogEntries( null ) )
      .finally( () => setLogLoading( false ) );
  }, [ enabled ] );

  async function handleToggle () {
    setToggling( true );
    setToggleError( null );
    try {
      const res = await fetch( "/api/saas/copy-trading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify( { enabled: !enabled } ),
      } );
      const data = await res.json();
      if ( !res.ok ) {
        setToggleError( data?.error ?? "Could not update copy trading status." );
        if ( data?.gates ) setGates( data.gates );
        return;
      }
      setEnabled( data.copyTradingEnabled );
      loadGates();
    } catch {
      setToggleError( "Could not reach the server." );
    } finally {
      setToggling( false );
    }
  }

  async function handleSignOut () {
    await fetch( "/api/saas/logout", { method: "POST" } ).catch( () => { } );
    router.push( "/app/login" );
  }

  // --- Derived Statistics Calculations ---
  const totalTrades = logEntries?.length || 0;
  const netPnl = logEntries?.reduce( ( sum, e ) => sum + ( e.realizedPnl || 0 ), 0 ) || 0;
  const winningTrades = logEntries?.filter( e => ( e.realizedPnl || 0 ) > 0 ).length || 0;
  const winRate = totalTrades > 0 ? ( winningTrades / totalTrades ) * 100 : 0;

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
        <div className="flex items-center gap-3">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={ { background: enabled ? "var(--long)" : "var(--muted-dim)" } }
          />
          <span className="font-display font-semibold text-lg">Copy Trading</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={ () => router.push( "/app/profile" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <User size={ 13 } />
            Profile
          </button>
          <div className="w-px h-4 bg-[var(--hairline)]" />

          <button
            onClick={ () => router.push( "/app/billing" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <User size={ 13 } />
            Billing
          </button>
          <div className="w-px h-4 bg-[var(--hairline)]" />

          <button
            onClick={ () => router.push( "/app/performance" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <User size={ 13 } />
            Performance
          </button>

          <div className="w-px h-4 bg-[var(--hairline)]" />
          <button
            onClick={ () => void handleSignOut() }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <LogOut size={ 13 } />
            Sign out
          </button>
        </div>
      </header>

      <div className="flex-1 p-6">
        <div className="max-w-[700px] mx-auto space-y-6">
          <div>
            <span className="eyebrow">Welcome back</span>
            <h1 className="font-display text-2xl font-semibold mt-1">{ displayName }</h1>
          </div>

          <div className="panel p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Copy trading status</span>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5"
                style={ {
                  color: enabled ? "var(--long)" : "var(--muted)",
                  border: `1px solid ${ enabled ? "var(--long-dim)" : "var(--hairline-bright)" }`,
                } }
              >
                { enabled ? "ACTIVE" : "INACTIVE" }
              </span>
            </div>

            { gates && (
              <div>
                <GateRow label="Email verified" met={ gates.emailVerified } />
                <GateRow label="Exchange connected" met={ gates.exchangeConnected } />
                <GateRow label="Subscription active" met={ gates.subscriptionActive } />
                <GateRow label="No unpaid invoices" met={ gates.noPendingInvoice } />
              </div>
            ) }

            { toggleError && (
              <p className="text-xs font-mono text-[var(--short)] border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
                { toggleError }
              </p>
            ) }

            <button
              onClick={ () => void handleToggle() }
              disabled={ toggling || ( !enabled && gates !== null && !gates?.allGatesMet ) }
              className="w-full flex items-center justify-center gap-2 font-display font-semibold text-sm py-2.5
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={ {
                background: enabled ? "transparent" : "var(--text)",
                color: enabled ? "var(--short)" : "var(--bg)",
                border: enabled ? "1px solid var(--short-dim)" : "none",
              } }
            >
              { toggling ? (
                <Loader2 size={ 15 } className="animate-spin" />
              ) : enabled ? (
                <ZapOff size={ 15 } />
              ) : (
                <Zap size={ 15 } />
              ) }
              { toggling ? "Updating…" : enabled ? "Turn off copy trading" : "Turn on copy trading" }
            </button>

            { !enabled && gates && !gates.allGatesMet && (
              <p className="text-xs font-mono text-[var(--muted-dim)]">
                Complete every requirement above to enable copy trading.
                Manage your exchange key and billing from your{ " " }
                <button
                  onClick={ () => router.push( "/app/profile" ) }
                  className="underline hover:text-[var(--text)]"
                >
                  profile
                </button>
                .
              </p>
            ) }
          </div>

          {/* --- New Performance Overview Grid --- */ }
          { !logLoading && logEntries && logEntries.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="panel p-4 flex flex-col gap-1 hover:bg-[var(--panel-raised)] transition-colors">
                <div className="flex items-center gap-1.5 text-[var(--muted)]">
                  <TrendingUp size={ 14 } />
                  <span className="text-xs font-mono">Net PnL (Recent)</span>
                </div>
                <span
                  className="font-display text-xl font-semibold"
                  style={ { color: netPnl >= 0 ? "var(--long)" : "var(--short)" } }
                >
                  { netPnl >= 0 ? "+" : "" }{ fmtUsd( netPnl ) }
                </span>
              </div>

              <div className="panel p-4 flex flex-col gap-1 hover:bg-[var(--panel-raised)] transition-colors">
                <div className="flex items-center gap-1.5 text-[var(--muted)]">
                  <Target size={ 14 } />
                  <span className="text-xs font-mono">Win Rate</span>
                </div>
                <span className="font-display text-xl font-semibold">
                  { winRate.toFixed( 1 ) }%
                </span>
              </div>

              <div className="panel p-4 flex flex-col gap-1 hover:bg-[var(--panel-raised)] transition-colors">
                <div className="flex items-center gap-1.5 text-[var(--muted)]">
                  <Activity size={ 14 } />
                  <span className="text-xs font-mono">Copied Trades</span>
                </div>
                <span className="font-display text-xl font-semibold">
                  { totalTrades }
                </span>
              </div>
            </div>
          ) }

          <div className="panel overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--hairline)]">
              <span className="eyebrow">Recent copy-trade activity</span>
            </div>

            { logLoading && (
              <div className="p-8 flex items-center justify-center">
                <Loader2 size={ 16 } className="animate-spin text-[var(--muted)]" />
              </div>
            ) }

            { !logLoading && ( !logEntries || logEntries.length === 0 ) && (
              <div className="p-8 text-center">
                <p className="text-sm text-[var(--muted)] font-mono">
                  { enabled
                    ? "No copy-trade activity yet — this fills in the next time the leader opens a position."
                    : "Nothing to show yet. Turn on copy trading above once you're ready." }
                </p>
              </div>
            ) }

            { !logLoading && logEntries && logEntries.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--hairline)]">
                      { [ "Symbol", "Side", "Entry / Exit", "Your Size", "PnL & ROI", "Status", "When" ].map( ( h ) => (
                        <th key={ h } className="eyebrow text-left px-4 py-2.5 font-normal whitespace-nowrap">
                          { h }
                        </th>
                      ) ) }
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    { logEntries.map( ( e: any ) => (
                      <tr
                        key={ e.id }
                        className="border-b border-[var(--hairline)] last:border-b-0 hover:bg-[var(--panel-raised)] transition-colors text-xs"
                      >
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                          { ( e.symbol || "UNKNOWN" ).split( ":" )[ 0 ] }
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                            style={ {
                              color: e.side === "LONG" ? "var(--long)" : "var(--short)",
                              border: `1px solid ${ e.side === "LONG" ? "var(--long-dim)" : "var(--short-dim)" }`,
                            } }
                          >
                            { e.side || "LONG" }
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[var(--muted)] whitespace-nowrap">
                          <div>In: { fmtUsd( e.entryPrice ?? 0 ) }</div>
                          <div>Out: { ( e.exitPrice ?? 0 ) > 0 ? fmtUsd( e.exitPrice ) : "Active" }</div>
                        </td>
                        <td className="px-4 py-2.5 tabular text-[var(--text)]">
                          { fmtUsd( e.marginAllocated ?? 0 ) }
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div
                            className="font-semibold"
                            style={ { color: ( e.realizedPnl ?? 0 ) >= 0 ? "var(--long)" : "var(--short)" } }
                          >
                            { ( e.realizedPnl ?? 0 ) >= 0 ? "+" : "" }{ fmtUsd( e.realizedPnl ?? 0 ) } ({ ( e.roiPercentage ?? 0 ) >= 0 ? "+" : "" }{ Number( e.roiPercentage ?? 0 ).toFixed( 2 ) }%)
                          </div>
                        </td>
                        <td className="px-4 py-2.5" style={ { color: statusColor( e.status ) } }>
                          { e.status || "SUCCESS" }
                        </td>
                        <td className="px-4 py-2.5 text-[var(--muted)] whitespace-nowrap">
                          { new Date( e.executedAt || e.createdAt ).toLocaleString() }
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
"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  ZapOff,
  TrendingUp,
  Activity,
  Target,
  HelpCircle,
  ShieldCheck,
  HeartPulse,
  AlertTriangle,
  Download
} from "lucide-react";
import { FollowerHeader } from "@/components/FollowerHeader";

interface GateStatus {
  emailVerified: boolean;
  exchangeConnected: boolean;
  minimumBalanceMet: boolean;
  minCopyTradeNotionalUSDT: number;
  minActivationBalanceUSDT?: number;
  warnBalanceUSDT?: number;
  pauseBalanceUSDT?: number;
  subscriptionActive: boolean;
  noPendingInvoice: boolean;
  allGatesMet: boolean;
}

interface FollowerHealth {
  score: number;
  band: "healthy" | "watching" | "anxious" | "likely_to_churn";
  label: string;
  drivers: string[];
  recommendedAction: string;
  recentDashboardViews: number;
  recentRiskActions: number;
  losingTrades30d: number;
  netPnl30d: number;
  daysUntilRenewal: number | null;
}

interface UnifiedTrade {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  stopLossPrice: number | null;
  stopLossType: "ATR" | "manual" | "unknown" | null;
  atrPeriod: number | null;
  atrMultiplier: number | null;
  marginAllocated: number;
  realizedPnl: number;
  roiPercentage: number;
  status: string;
  detail: string | null;
  executedAt: string;
  isOpen: boolean;
}

interface CopyTradeLogEntry {
  id: string;
  leaderTradeId?: string;
  action: "OPEN" | "CLOSE";
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  stopLossPrice?: number | null;
  stopLossType?: "ATR" | "manual" | "unknown" | null;
  atrPeriod?: number | null;
  atrMultiplier?: number | null;
  marginAllocated: number;
  realizedPnl: number;
  roiPercentage: number;
  status: string;
  detail: string | null;
  executedAt: string;
  createdAt: string;
}

function fmtUsd ( n: number | null ): string {
  if ( n === null ) return "—";
  return `$${ n?.toLocaleString( "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) }`;
}

interface GateRowProps {
  label: string;
  met: boolean;
  tip?: string;
  actionUrl?: string;
  onNavigate?: ( url: string ) => void;
}

function GateRow ( { label, met, tip, actionUrl, onNavigate }: GateRowProps ) {
  return (
    <div className="group relative flex items-center justify-between py-2 border-b border-[var(--hairline)] last:border-b-0">
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-[var(--muted)]">{ label }</span>
        { !met && tip && (
          <div className="relative flex items-center">
            <HelpCircle size={ 13 } className="text-[var(--muted-dim)] group-hover:text-[var(--text)] transition-colors cursor-help" />
          </div>
        ) }
      </div>

      <div className="flex items-center gap-2">
        { met ? (
          <span className="flex items-center gap-1 text-xs font-mono" style={ { color: "var(--long)" } }>
            <CheckCircle2 size={ 13 } />
            Met
          </span>
        ) : (
          <div className="relative flex items-center">
            <button
              onClick={ () => actionUrl && onNavigate?.( actionUrl ) }
              disabled={ !actionUrl }
              className="flex items-center gap-1 text-xs font-mono hover:underline disabled:no-underline cursor-pointer disabled:cursor-default"
              style={ { color: "var(--muted)" } }
            >
              <XCircle size={ 13 } />
              Not yet
            </button>
          </div>
        ) }
      </div>

      {/* Hover Tooltip Popup */ }
      { !met && tip && (
        <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block z-30 w-64 pointer-events-none">
          <div className="bg-[var(--panel-raised)] border border-[var(--hairline-bright)] text-[var(--text)] text-[11px] font-mono p-2.5 shadow-2xl rounded-none">
            <p className="text-[var(--text)] leading-relaxed">{ tip }</p>
            { actionUrl && (
              <span className="text-[10px] text-[var(--long)] mt-1.5 block font-semibold tracking-wide">
                Click Not yet or visit section to resolve →
              </span>
            ) }
          </div>
        </div>
      ) }
    </div>
  );
}

function GateRowSkeleton () {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--hairline)] last:border-b-0">
      <div className="h-3 w-32 bg-[var(--panel-raised)] animate-pulse" />
      <div className="h-3 w-12 bg-[var(--panel-raised)] animate-pulse" />
    </div>
  );
}

function statusColor ( status: string ): string {
  if ( status === "executed" || status === "closed" || status === "SUCCESS" ) return "var(--long)";
  if ( status === "failed" ) return "var(--short)";
  if ( status.startsWith( "skipped_" ) ) return "var(--warn)";
  return "var(--muted)";
}

function statusLabel ( status: string ): string {
  if ( status === "executed" ) return "Copied";
  if ( status === "closed" ) return "Closed";
  if ( status === "failed" ) return "Needs attention";
  if ( status === "skipped_duplicate" ) return "Already handled";
  if ( status.startsWith( "skipped_" ) ) return "Skipped";
  if ( status === "SUCCESS" ) return "Copied";
  return status;
}

function stopLossLabel ( trade: UnifiedTrade ): string {
  if ( !trade.isOpen ) return "Closed";
  if ( !trade.stopLossPrice ) return "Pending";
  if ( trade.stopLossType === "ATR" ) return "ATR stop active";
  if ( trade.stopLossType === "manual" ) return "Stop active";
  return "Stop tracked";
}

function stopDistancePct ( trade: UnifiedTrade ): number | null {
  const entryPrice = Number( trade.entryPrice ?? 0 );
  const stopLossPrice = Number( trade.stopLossPrice ?? 0 );
  const roi = Number( trade.roiPercentage ?? 0 );
  if ( !trade.isOpen || !entryPrice || !stopLossPrice || !Number.isFinite( roi ) ) return null;

  const direction = trade.side === "SHORT" ? -1 : 1;
  const markPrice = entryPrice * ( 1 + ( roi / 100 ) * direction );
  if ( markPrice <= 0 ) return null;

  const distance = trade.side === "SHORT"
    ? ( ( stopLossPrice - markPrice ) / markPrice ) * 100
    : ( ( markPrice - stopLossPrice ) / markPrice ) * 100;

  return Number.isFinite( distance ) ? distance : null;
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
  const [ logError, setLogError ] = useState<string | null>( null );
  const [ health, setHealth ] = useState<FollowerHealth | null>( null );
  const [ cardGenerating, setCardGenerating ] = useState( false );
  const [ cardNotice, setCardNotice ] = useState<string | null>( null );

  const loadLogs = useCallback( ( showLoading = false ) => {
    if ( showLoading ) setLogLoading( true );
    fetch( "/api/saas/copy-trade-log?limit=20", { cache: "no-store" } )
      .then( async ( res ) => {
        const data = await res.json().catch( () => null );
        if ( !res.ok ) {
          throw new Error( data?.error ?? "Copy-trade activity is temporarily unavailable." );
        }
        setLogEntries( data.entries );
        setLogError( null );
      } )
      .catch( () => {
        setLogError( "Copy-trade activity is temporarily unavailable. Showing the latest loaded rows." );
      } )
      .finally( () => {
        if ( showLoading ) setLogLoading( false );
      } );
  }, [] );

  const loadGates = useCallback( () => {
    fetch( "/api/saas/copy-trading" )
      .then( ( res ) => res.json() )
      .then( ( data ) => {
        setEnabled( data.copyTradingEnabled );
        setGates( data.gates );
      } )
      .catch( () => { } );
  }, [] );

  const loadHealth = useCallback( () => {
    fetch( "/api/saas/follower-health", { cache: "no-store" } )
      .then( async ( res ) => {
        const data = await res.json().catch( () => null );
        if ( res.ok ) setHealth( data.health );
      } )
      .catch( () => {} );
  }, [] );

  useEffect( () => {
    loadGates();
    loadHealth();
    fetch( "/api/saas/behaviour-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify( { type: "dashboard_view", metadata: { surface: "copy_trading_dashboard" } } ),
    } ).catch( () => {} );
  }, [ loadGates, loadHealth ] );

  useEffect( () => {
    loadLogs( true );
  }, [ enabled, loadLogs ] );

  useEffect( () => {
    const refresh = () => {
      if ( document.visibilityState === "visible" ) loadLogs( false );
    };
    const id = window.setInterval( refresh, 5_000 );
    window.addEventListener( "focus", refresh );
    document.addEventListener( "visibilitychange", refresh );
    return () => {
      window.clearInterval( id );
      window.removeEventListener( "focus", refresh );
      document.removeEventListener( "visibilitychange", refresh );
    };
  }, [ loadLogs ] );

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
      loadHealth();
    } catch {
      setToggleError( "Could not reach the server." );
    } finally {
      setToggling( false );
    }
  }


  async function handleGeneratePnlCard () {
    setCardGenerating( true );
    setCardNotice( null );

    try {
      const canvas = document.createElement( "canvas" );
      canvas.width = 1200;
      canvas.height = 1500;
      const ctx = canvas.getContext( "2d" );
      if ( !ctx ) throw new Error( "Could not create card." );

      const positive = netPnl >= 0;
      const accent = positive ? "#16a34a" : "#dc2626";
      const muted = "#8b949e";

      ctx.fillStyle = "#07111f";
      ctx.fillRect( 0, 0, canvas.width, canvas.height );
      ctx.fillStyle = "#0d1b2f";
      ctx.fillRect( 70, 70, 1060, 1360 );
      ctx.strokeStyle = "#203148";
      ctx.lineWidth = 2;
      ctx.strokeRect( 70, 70, 1060, 1360 );

      ctx.fillStyle = muted;
      ctx.font = "700 34px Arial";
      ctx.fillText( "MIMIC PIPS", 120, 165 );
      ctx.fillStyle = "#e6edf3";
      ctx.font = "700 76px Arial";
      ctx.fillText( "Copied Performance", 120, 275 );

      ctx.fillStyle = accent;
      ctx.font = "800 138px Arial";
      ctx.fillText( `${ positive ? "+" : "" }${ fmtUsd( netPnl ) }`, 120, 470 );

      ctx.fillStyle = muted;
      ctx.font = "36px Arial";
      ctx.fillText( "Recent realized copied PnL", 120, 535 );

      const stats = [
        [ "Win rate", `${ winRate.toFixed( 1 ) }%` ],
        [ "Copied trades", String( totalCopiedTrades ) ],
        [ "Active trades", String( activeTradesCount ) ],
        [ "Risk Guard", health ? `${ health.label } ${ health.score }/100` : enabled ? "Active" : "Standing by" ],
      ];

      stats.forEach( ( [ label, value ], index ) => {
        const x = 120 + ( index % 2 ) * 480;
        const y = 710 + Math.floor( index / 2 ) * 230;
        ctx.fillStyle = "#111f34";
        ctx.fillRect( x, y, 420, 150 );
        ctx.strokeStyle = "#263852";
        ctx.strokeRect( x, y, 420, 150 );
        ctx.fillStyle = muted;
        ctx.font = "700 28px Arial";
        ctx.fillText( label.toUpperCase(), x + 34, y + 52 );
        ctx.fillStyle = "#f8fafc";
        ctx.font = "800 48px Arial";
        ctx.fillText( value, x + 34, y + 112 );
      } );

      ctx.fillStyle = "#16263d";
      ctx.fillRect( 120, 1200, 960, 2 );
      ctx.fillStyle = muted;
      ctx.font = "30px Arial";
      ctx.fillText( "Risk Guard: Active  •  Copy Engine: Monitoring  •  Futures trading carries risk.", 120, 1285 );
      ctx.fillText( "Not financial advice. Results vary by follower account, exchange execution, and sizing.", 120, 1340 );

      const url = canvas.toDataURL( "image/png" );
      const link = document.createElement( "a" );
      link.href = url;
      link.download = `mimic-pips-pnl-${ new Date().toISOString().slice( 0, 10 ) }.png`;
      link.click();

      await fetch( "/api/saas/behaviour-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify( {
          type: "pnl_card_generated",
          metadata: {
            netPnl,
            winRate: Number( winRate.toFixed( 2 ) ),
            copiedTrades: totalCopiedTrades,
            activeTrades: activeTradesCount,
          },
        } ),
      } ).catch( () => {} );

      setCardNotice( "PnL card downloaded. Share the win with the risk context intact." );
    } catch {
      setCardNotice( "Could not generate the PnL card in this browser." );
    } finally {
      setCardGenerating( false );
    }
  }

  // --- Derived Statistics & Deduplication ---
  // --- Derived Statistics & Deduplication ---
  const unifiedTrades = ( () => {
    if ( !logEntries ) return [];
    const map = new Map<string, UnifiedTrade>();

    for ( const entry of logEntries ) {
      const tradeKey = entry.leaderTradeId || entry.id;

      if ( !map.has( tradeKey ) ) {
        map.set( tradeKey, {
          id: entry.id,
          symbol: entry.symbol,
          side: entry.side,
          entryPrice: entry.action === "OPEN" ? entry.entryPrice : 0,
          exitPrice: entry.action === "CLOSE" ? entry.exitPrice : 0,
          stopLossPrice: entry.stopLossPrice ?? null,
          stopLossType: entry.stopLossType ?? null,
          atrPeriod: entry.atrPeriod ?? null,
          atrMultiplier: entry.atrMultiplier ?? null,
          marginAllocated: entry.marginAllocated,
          realizedPnl: entry.realizedPnl,
          roiPercentage: entry.roiPercentage,
          status: entry.status,
          detail: entry.detail,
          executedAt: entry.executedAt || entry.createdAt,
          isOpen: entry.action === "OPEN",
        } );
      }

      const row = map.get( tradeKey )!;
      if ( entry.action === "OPEN" ) {
        row.entryPrice = entry.entryPrice || row.entryPrice;
        row.stopLossPrice = entry.stopLossPrice ?? row.stopLossPrice;
        row.stopLossType = entry.stopLossType ?? row.stopLossType;
        row.atrPeriod = entry.atrPeriod ?? row.atrPeriod;
        row.atrMultiplier = entry.atrMultiplier ?? row.atrMultiplier;
        row.marginAllocated = entry.marginAllocated || row.marginAllocated;
      } else if ( entry.action === "CLOSE" || ( entry.exitPrice ?? 0 ) > 0 ) {
        row.exitPrice = entry.exitPrice || row.exitPrice;
        row.realizedPnl = entry.realizedPnl;
        row.roiPercentage = entry.roiPercentage;
        row.status = entry.status;
        row.detail = entry.detail || row.detail;
        row.isOpen = false;
      }
    }
    return Array.from( map.values() );
  } )();

  const totalCopiedTrades = unifiedTrades.length;
  const activeTradesCount = unifiedTrades.filter( e => e.isOpen ).length;
  const protectedActiveTrades = unifiedTrades.filter( e => e.isOpen && e.stopLossPrice ).length;
  const closedTrades = unifiedTrades.filter( e => !e.isOpen );
  const netPnl = closedTrades.reduce( ( sum, e ) => sum + ( e.realizedPnl || 0 ), 0 );
  const winningTrades = closedTrades.filter( e => ( e.realizedPnl || 0 ) > 0 ).length;
  const winRate = closedTrades.length > 0 ? ( winningTrades / closedTrades.length ) * 100 : 0;

  return (
    <main className="min-h-screen flex flex-col">
      <FollowerHeader />

      <div className="flex-1 p-6">
        <div className="max-w-[700px] mx-auto space-y-6">
          <div>
            <span className="eyebrow">Welcome back</span>
            <h1 className="font-display text-2xl font-semibold mt-1">{ displayName }</h1>
          </div>

          <div className="panel p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="eyebrow">Risk confidence</span>
                <div className="mt-2 flex items-center gap-3">
                  <span
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border"
                    style={ { borderColor: health?.band === "likely_to_churn" || health?.band === "anxious" ? "var(--warn)" : "var(--long-dim)", color: health?.band === "likely_to_churn" || health?.band === "anxious" ? "var(--warn)" : "var(--long)" } }
                  >
                    { health?.band === "likely_to_churn" || health?.band === "anxious" ? <AlertTriangle size={ 20 } /> : <ShieldCheck size={ 20 } /> }
                  </span>
                  <div>
                    <p className="font-display text-xl font-semibold">
                      Risk Guard { enabled ? "active" : "standing by" }
                    </p>
                    <p className="text-xs font-mono text-[var(--muted)] mt-1">
                      { health ? `${ health.label } confidence score: ${ health.score }/100` : "Calculating confidence score..." }
                    </p>
                  </div>
                </div>
              </div>
              <HeartPulse size={ 18 } className="text-[var(--muted)]" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-[var(--hairline)]">
              <div className="bg-[var(--panel-raised)] p-3">
                <span className="eyebrow">30d copied PnL</span>
                <p className="font-display text-lg font-semibold mt-1" style={ { color: Number( health?.netPnl30d ?? 0 ) >= 0 ? "var(--long)" : "var(--short)" } }>
                  { health ? `${ health.netPnl30d >= 0 ? "+" : "" }${ fmtUsd( health.netPnl30d ) }` : "—" }
                </p>
              </div>
              <div className="bg-[var(--panel-raised)] p-3">
                <span className="eyebrow">ATR stop cover</span>
                <p className="font-display text-lg font-semibold mt-1" style={ { color: protectedActiveTrades === activeTradesCount ? "var(--long)" : activeTradesCount > 0 ? "var(--warn)" : "var(--muted)" } }>
                  { activeTradesCount > 0 ? `${ protectedActiveTrades }/${ activeTradesCount }` : "No live trades" }
                </p>
              </div>
              <div className="bg-[var(--panel-raised)] p-3">
                <span className="eyebrow">Renewal window</span>
                <p className="font-display text-lg font-semibold mt-1">
                  { health?.daysUntilRenewal === null || health?.daysUntilRenewal === undefined ? "Not active" : `${ health.daysUntilRenewal }d` }
                </p>
              </div>
            </div>
            { health && (
              <p className="text-xs font-mono text-[var(--muted)] leading-relaxed">
                { health.drivers[0] } { health.band === "healthy" ? "The system is watching execution gates, invoices, and copy status before live entries." : "Mimic Pips is designed to show you the reason behind each risk signal, not just a red number." }
              </p>
            ) }
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

            { gates === null ? (
              <div>
                { Array.from( { length: 5 } ).map( ( _, i ) => <GateRowSkeleton key={ i } /> ) }
              </div>
            ) : (
              <div>
                <GateRow
                  label="Email verified"
                  met={ gates.emailVerified }
                  tip="Visit your Profile page to request or confirm your email verification link."
                  actionUrl="/app/profile"
                  onNavigate={ router.push }
                />
                <GateRow
                  label="Exchange connected"
                  met={ gates.exchangeConnected }
                  tip="Visit Profile/Connect to add your Binance API key with Read and Futures permissions enabled."
                  actionUrl="/app/connect"
                  onNavigate={ router.push }
                />
                <GateRow
                  label="Minimum starting balance"
                  met={ gates.minimumBalanceMet ?? true }
                  tip={ `You need at least $${ Number( gates.minActivationBalanceUSDT ?? gates.minCopyTradeNotionalUSDT ?? 300 ).toFixed( 2 ) } to turn on copy trading. After activation, new entries are only paused below $${ Number( gates.pauseBalanceUSDT ?? 150 ).toFixed( 2 ) }.` }
                  actionUrl="/app/connect"
                  onNavigate={ router.push }
                />
                <GateRow
                  label="Subscription active"
                  met={ gates.subscriptionActive }
                  tip="Visit Billing to activate your copy trading subscription."
                  actionUrl="/app/billing"
                  onNavigate={ router.push }
                />
                <GateRow
                  label="No unpaid invoices"
                  met={ gates.noPendingInvoice }
                  tip="Visit Billing to settle outstanding performance fee invoices before activating trades."
                  actionUrl="/app/billing"
                  onNavigate={ router.push }
                />
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

          {/* --- Performance Overview Grid --- */ }
          { logLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              { Array.from( { length: 4 } ).map( ( _, i ) => (
                <div key={ i } className="panel p-4 flex flex-col gap-2">
                  <div className="h-3 w-20 bg-[var(--panel-raised)] animate-pulse" />
                  <div className="h-5 w-16 bg-[var(--panel-raised)] animate-pulse" />
                </div>
              ) ) }
            </div>
          ) : unifiedTrades.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  { totalCopiedTrades }
                </span>
              </div>

              <div className="panel p-4 flex flex-col gap-1 hover:bg-[var(--panel-raised)] transition-colors">
                <div className="flex items-center gap-1.5 text-[var(--muted)]">
                  <Zap size={ 14 } />
                  <span className="text-xs font-mono">Active Trades</span>
                </div>
                <span className="font-display text-xl font-semibold">
                  { activeTradesCount }
                </span>
              </div>
            </div>
          ) }

          { !logLoading && unifiedTrades.length > 0 && (
            <div className="panel p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <span className="eyebrow">Shareable proof</span>
                  <h2 className="font-display text-lg font-semibold mt-1">Turn your copied result into a PnL card</h2>
                  <p className="text-xs font-mono text-[var(--muted)] mt-1">
                    Includes recent PnL, win rate, copied trades, and Risk Guard context.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={ () => void handleGeneratePnlCard() }
                  disabled={ cardGenerating }
                  className="inline-flex items-center justify-center gap-2 border border-[var(--long-dim)] text-[var(--long)] hover:text-[var(--text)] font-mono text-xs px-3 py-2 disabled:opacity-50"
                >
                  { cardGenerating ? <Loader2 size={ 14 } className="animate-spin" /> : <Download size={ 14 } /> }
                  { cardGenerating ? "Preparing card..." : "Download PnL card" }
                </button>
              </div>
              { cardNotice && (
                <p className="text-xs font-mono text-[var(--muted)] border border-[var(--hairline)] bg-[var(--panel-raised)] px-3 py-2">
                  { cardNotice }
                </p>
              ) }
            </div>
          ) }


          <div className="panel overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--hairline)]">
              <span className="eyebrow">Recent copy-trade activity</span>
            </div>

            { logLoading && (
              <div className="divide-y divide-[var(--hairline)]">
                { Array.from( { length: 6 } ).map( ( _, i ) => (
                  <div key={ i } className="px-4 py-3 flex items-center gap-4">
                    <div className="h-3 w-14 bg-[var(--panel-raised)] animate-pulse" />
                    <div className="h-3 w-10 bg-[var(--panel-raised)] animate-pulse" />
                    <div className="h-3 w-24 bg-[var(--panel-raised)] animate-pulse" />
                    <div className="h-3 w-16 bg-[var(--panel-raised)] animate-pulse ml-auto" />
                  </div>
                ) ) }
              </div>
            ) }

            { !logLoading && logError && (
              <div className="px-5 py-3 border-b border-[var(--hairline)]">
                <p className="text-xs font-mono text-[var(--warn)]">{ logError }</p>
              </div>
            ) }

            { !logLoading && unifiedTrades.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-sm text-[var(--muted)] font-mono">
                  { enabled
                    ? "No copy-trade activity yet — this fills in the next time the leader opens a position."
                    : "Nothing to show yet. Turn on copy trading above once you're ready." }
                </p>
              </div>
            ) }

            { !logLoading && unifiedTrades.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--hairline)]">
                      { [ "Symbol", "Side", "Entry / Exit", "Risk Guard", "Your Size", "PnL & ROI", "Status", "When" ].map( ( h ) => (
                        <th key={ h } className="eyebrow text-left px-4 py-2.5 font-normal whitespace-nowrap">
                          { h }
                        </th>
                      ) ) }
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    { unifiedTrades.map( ( e ) => (
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
                          <div>
                            Out:{ " " }
                            { ( e.exitPrice ?? 0 ) > 0
                              ? fmtUsd( e.exitPrice )
                              : e.isOpen
                                ? "Active"
                            : "Closed" }
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <div
                            className="font-semibold"
                            style={ { color: e.stopLossPrice && e.isOpen ? "var(--long)" : e.isOpen ? "var(--warn)" : "var(--muted)" } }
                          >
                            { stopLossLabel( e ) }
                          </div>
                          { e.stopLossPrice ? (
                            <div className="text-[10px] text-[var(--muted)]">
                              Stop: { fmtUsd( e.stopLossPrice ) }
                              { e.stopLossType === "ATR" && e.atrMultiplier ? ` • ${ e.atrMultiplier }x ATR` : "" }
                              { stopDistancePct( e ) !== null ? ` • ${ Math.max( 0, stopDistancePct( e )! ).toFixed( 1 ) }% away` : "" }
                            </div>
                          ) : (
                            <div className="text-[10px] text-[var(--muted)]">
                              { e.isOpen ? "Waiting for bot stop data" : "No longer live" }
                            </div>
                          ) }
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
                        <td className="px-4 py-2.5" style={ { color: e.isOpen ? "var(--long)" : statusColor( e.status ) } }>
                          <div>{ e.isOpen ? "Active" : statusLabel( e.status || "SUCCESS" ) }</div>
                          { e.detail && (
                            <div className="max-w-[220px] truncate text-[10px] text-[var(--muted)]" title={ e.detail }>
                              { e.detail }
                            </div>
                          ) }
                        </td>
                        <td className="px-4 py-2.5 text-[var(--muted)] whitespace-nowrap">
                          { new Date( e.executedAt ).toLocaleString() }
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

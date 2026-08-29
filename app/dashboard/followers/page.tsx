"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Users, PlayCircle, RefreshCw } from "lucide-react";
import type { FollowerListItem } from "@/app/api/saas/followers/route";

function fmtUsd ( n: number | null ): string {
  if ( n === null ) return "—";
  return `$${ n.toLocaleString( "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) }`;
}

function StatusPill ( { label, active, warn }: { label: string; active: boolean; warn?: boolean } ) {
  const color = active ? "var(--long)" : warn ? "var(--warn)" : "var(--muted)";
  const border = active ? "var(--long-dim)" : warn ? "var(--warn)" : "var(--hairline-bright)";
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 whitespace-nowrap"
      style={ { color, border: `1px solid ${ border }` } }
    >
      { label }
    </span>
  );
}

function CopyTradeToggle ( {
  follower,
  onToggled,
}: {
  follower: FollowerListItem;
  onToggled: ( id: string, enabled: boolean ) => void;
} ) {
  const [ busy, setBusy ] = useState( false );
  const [ error, setError ] = useState<string | null>( null );

  async function handleToggle () {
    setBusy( true );
    setError( null );
    const next = !follower.copyTradingEnabled;
    try {
      const res = await fetch( "/api/saas/followers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify( { userId: follower.id, copyTradingEnabled: next } ),
      } );
      const data = await res.json();
      if ( !res.ok ) {
        setError( data?.error ?? "Failed to update." );
        return;
      }
      onToggled( follower.id, next );
    } catch {
      setError( "Could not reach the server." );
    } finally {
      setBusy( false );
    }
  }

  const allGatesMet =
    follower.emailVerified && follower.exchangeConnected && follower.subscriptionStatus === "ACTIVE" && follower.pendingInvoiceTotalNGN === 0;
  // Turning ON requires all four gates. Turning OFF is always allowed —
  // an operator must be able to disable a follower even if they no
  // longer meet all gates (e.g. a subscription that lapsed after being
  // enabled), so the button never locks someone into a stuck "on" state.
  const toggleDisabled = busy || ( !follower.copyTradingEnabled && !allGatesMet );

  function missingGateReason (): string | undefined {
    if ( follower.copyTradingEnabled || allGatesMet ) return undefined;
    const missing: string[] = [];
    if ( !follower.emailVerified ) missing.push( "email verified" );
    if ( !follower.exchangeConnected ) missing.push( "exchange connected" );
    if ( follower.subscriptionStatus !== "ACTIVE" ) missing.push( "active subscription" );
    if ( follower.pendingInvoiceTotalNGN > 0 ) missing.push( "no due performance payment" );
    return `Requires: ${ missing.join( ", " ) }`;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={ () => void handleToggle() }
        disabled={ toggleDisabled }
        role="switch"
        aria-checked={follower.copyTradingEnabled}
        aria-label={`Toggle copy trading for ${follower.email}`}
        title={ missingGateReason() }
        className="relative w-10 h-5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={ {
          background: follower.copyTradingEnabled ? "var(--long-dim)" : "var(--hairline-bright)",
        } }
      >
        <span
          className="absolute top-0.5 w-4 h-4 transition-transform"
          style={ {
            left: follower.copyTradingEnabled ? "22px" : "2px",
            background: follower.copyTradingEnabled ? "var(--long)" : "var(--muted)",
          } }
        />
      </button>
      { error && <span className="text-[10px] font-mono text-[var(--short)]">{ error }</span> }
    </div>
  );
}

export default function FollowersPage () {
  const router = useRouter();
  const [ followers, setFollowers ] = useState<FollowerListItem[] | null>( null );
  const [ error, setError ] = useState<string | null>( null );
  const [ loading, setLoading ] = useState( true );

  const load = useCallback( () => {
    setLoading( true );
    fetch( "/api/saas/followers" )
      .then( async ( res ) => {
        const data = await res.json();
        if ( !res.ok ) throw new Error( data?.error ?? "Failed to load followers." );
        setFollowers( data.followers );
        setError( null );
      } )
      .catch( ( err ) => setError( err.message ) )
      .finally( () => setLoading( false ) );
  }, [] );

  useEffect( () => {
    load();
  }, [ load ] );

  function handleToggled ( id: string, enabled: boolean ) {
    setFollowers( ( prev ) =>
      prev ? prev.map( ( f ) => ( f.id === id ? { ...f, copyTradingEnabled: enabled } : f ) ) : prev
    );
  }

  const activeCount = followers?.filter( ( f ) => f.copyTradingEnabled ).length ?? 0;

  const [ billingRunning, setBillingRunning ] = useState( false );
  const [ billingResult, setBillingResult ] = useState<{
    performanceFees: { userId: string; outcome: string; detail?: string }[];
    renewals: { userId: string; outcome: string; detail?: string }[];
  } | null>( null );
  const [ billingError, setBillingError ] = useState<string | null>( null );

  const [ refreshingBalances, setRefreshingBalances ] = useState( false );
  const [ refreshError, setRefreshError ] = useState<string | null>( null );

  async function handleRefreshBalances () {
    setRefreshingBalances( true );
    setRefreshError( null );
    try {
      const res = await fetch( "/api/saas/followers/refresh-balances", { method: "POST" } );
      const data = await res.json();
      if ( !res.ok ) {
        setRefreshError( data?.error ?? "Balance refresh failed." );
        return;
      }
      load(); // pull the newly updated balances into the table
    } catch {
      setRefreshError( "Could not reach the server." );
    } finally {
      setRefreshingBalances( false );
    }
  }

  async function handleRunBilling () {
    setBillingRunning( true );
    setBillingError( null );
    setBillingResult( null );
    try {
      const res = await fetch( "/api/saas/billing/run-now", { method: "POST" } );
      const data = await res.json();
      if ( !res.ok ) {
        setBillingError( data?.error ?? "Billing run failed." );
        return;
      }
      setBillingResult( { performanceFees: data.performanceFees, renewals: data.renewals } );
      load(); // refresh the follower list — subscription/invoice status may have changed
    } catch {
      setBillingError( "Could not reach the server." );
    } finally {
      setBillingRunning( false );
    }
  }

  // Helper to resolve user ID to human-readable Name/Email
  function getFollowerDisplayName ( userId: string ) {
    const follower = followers?.find( ( f ) => f.id === userId );
    if ( !follower ) return `${ userId.slice( 0, 10 ) }..`;
    return follower.displayName || follower.email;
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
        <div className="flex items-center gap-3">
          <button
            onClick={ () => router.push( "/dashboard" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <ArrowLeft size={ 13 } />
            Back
          </button>
          <div className="w-px h-4 bg-[var(--hairline)]" />
          <div className="flex items-center gap-2">
            <Users size={ 16 } />
            <span className="font-display font-semibold text-lg">Followers</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={ () => void handleRefreshBalances() }
            disabled={ refreshingBalances }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)]
                       border border-[var(--hairline-bright)] px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            { refreshingBalances ? <Loader2 size={ 13 } className="animate-spin" /> : <RefreshCw size={ 13 } /> }
            { refreshingBalances ? "Refreshing…" : "Refresh balances" }
          </button>
          <button
            onClick={ () => void handleRunBilling() }
            disabled={ billingRunning }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)]
                       border border-[var(--hairline-bright)] px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            { billingRunning ? <Loader2 size={ 13 } className="animate-spin" /> : <PlayCircle size={ 13 } /> }
            { billingRunning ? "Running…" : "Run billing now" }
          </button>
        </div>
      </header>

      <div className="flex-1 p-6">
        <div className="max-w-[1200px] mx-auto space-y-6">
          { billingError && (
            <div className="text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
              { billingError }
            </div>
          ) }

          { refreshError && (
            <div role="alert" className="text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
              { refreshError }
            </div>
          ) }

          { billingResult && (
            <div className="panel p-5 space-y-3">
              <span className="eyebrow">Last billing run</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-mono text-[var(--muted)] mb-2">
                    Performance fees ({ billingResult.performanceFees.length } follower(s) checked)
                  </p>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    { billingResult.performanceFees.map( ( r, i ) => (
                      <div key={ i } className="flex items-center justify-between text-xs font-mono">
                        <span className="text-[var(--muted-dim)] truncate max-w-[160px]" title={ r.userId }>
                          { getFollowerDisplayName( r.userId ) }
                        </span>
                        <span
                          style={ {
                            color:
                              r.outcome === "invoice_created"
                                ? "var(--long)"
                                : r.outcome === "error"
                                  ? "var(--short)"
                                  : r.outcome === "skipped_pending_payment"
                                    ? "var(--warn)"
                                    : "var(--muted)",
                          } }
                        >
                          { r.outcome }
                        </span>
                      </div>
                    ) ) }
                    { billingResult.performanceFees.length === 0 && (
                      <p className="text-xs font-mono text-[var(--muted-dim)]">
                        No followers had copy trading enabled with a verified key.
                      </p>
                    ) }
                  </div>
                </div>
                <div>
                  <p className="text-xs font-mono text-[var(--muted)] mb-2">
                    Subscription renewals ({ billingResult.renewals.length } due)
                  </p>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    { billingResult.renewals.map( ( r, i ) => (
                      <div key={ i } className="flex items-center justify-between text-xs font-mono">
                        <span className="text-[var(--muted-dim)] truncate max-w-[160px]" title={ r.userId }>
                          { getFollowerDisplayName( r.userId ) }
                        </span>
                        <span
                          style={ {
                            color: r.outcome === "charged" ? "var(--long)" : "var(--short)",
                          } }
                        >
                          { r.outcome }
                        </span>
                      </div>
                    ) ) }
                    { billingResult.renewals.length === 0 && (
                      <p className="text-xs font-mono text-[var(--muted-dim)]">
                        No subscriptions were due for renewal.
                      </p>
                    ) }
                  </div>
                </div>
              </div>
              <p className="text-[11px] font-mono text-[var(--muted-dim)] pt-2 border-t border-[var(--hairline)]">
                A follower shows &quot;invoice_created&quot; here if they were ahead of
                their high-water mark — check their Billing page to see and pay it.
                &quot;no_fee_owed&quot; means their balance didn&apos;t exceed their prior peak this cycle.
              </p>
            </div>
          ) }

          { followers && (
            <div className="grid grid-cols-3 gap-px bg-[var(--hairline)]">
              <div className="panel p-4">
                <span className="eyebrow block mb-1">Total followers</span>
                <span className="font-display font-semibold text-2xl tabular">
                  { followers.length }
                </span>
              </div>
              <div className="panel p-4">
                <span className="eyebrow block mb-1">Exchange connected</span>
                <span className="font-display font-semibold text-2xl tabular">
                  { followers.filter( ( f ) => f.exchangeConnected ).length }
                </span>
              </div>
              <div className="panel p-4">
                <span className="eyebrow block mb-1">Copy trading active</span>
                <span
                  className="font-display font-semibold text-2xl tabular"
                  style={ { color: activeCount > 0 ? "var(--long)" : "var(--text)" } }
                >
                  { activeCount }
                </span>
              </div>
            </div>
          ) }

          { error && (
            <div className="text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
              { error }
            </div>
          ) }

          <div className="panel overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--hairline)] flex items-center justify-between">
              <span className="eyebrow">All followers</span>
              { loading && <Loader2 size={ 14 } className="animate-spin text-[var(--muted)]" /> }
            </div>

            { !loading && followers && followers.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-sm text-[var(--muted)] font-mono">No followers yet.</p>
              </div>
            ) }

            { followers && followers.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--hairline)]">
                      { [
                        "Name",
                        "Email",
                        "Joined",
                        "Verified",
                        "Exchange",
                        "Balance",
                        "Subscription",
                        "Payment",
                        "Copy trading",
                      ].map( ( h ) => (
                        <th
                          key={ h }
                          className="eyebrow text-left px-4 py-2.5 font-normal whitespace-nowrap"
                        >
                          { h }
                        </th>
                      ) ) }
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    { followers.map( ( f ) => (
                      <tr
                        key={ f.id }
                        className="border-b border-[var(--hairline)] last:border-b-0 hover:bg-[var(--panel-raised)] transition-colors"
                      >
                        <td className="px-4 py-3 font-semibold whitespace-nowrap">
                          { f.displayName }
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)] whitespace-nowrap">
                          { f.email }
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)] whitespace-nowrap">
                          { new Date( f.createdAt ).toLocaleDateString() }
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill label={ f.emailVerified ? "VERIFIED" : "PENDING" } active={ f.emailVerified } warn={ !f.emailVerified } />
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill label={ f.exchangeConnected ? "CONNECTED" : "NOT CONNECTED" } active={ f.exchangeConnected } />
                        </td>
                        <td className="px-4 py-3 tabular">
                          <div>{ fmtUsd( f.lastKnownBalanceUSDT ) }</div>
                          { f.lastBalanceCheckAt && (
                            <div className="text-[10px] text-[var(--muted-dim)] font-normal">
                              as of { new Date( f.lastBalanceCheckAt ).toLocaleString() }
                            </div>
                          ) }
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill
                            label={ f.subscriptionStatus ?? "NO SUBSCRIPTION" }
                            active={ f.subscriptionStatus === "ACTIVE" }
                            warn={ f.subscriptionStatus === "PAST_DUE" }
                          />
                        </td>
                        <td className="px-4 py-3">
                          { f.pendingInvoiceCount > 0 ? (
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.5 whitespace-nowrap"
                              style={ { color: "var(--warn)", border: "1px solid var(--warn)" } }
                              title={ `${ f.pendingInvoiceCount } unpaid performance fee invoice(s)` }
                            >
                              ₦{ f.pendingInvoiceTotalNGN.toLocaleString( "en-NG", { maximumFractionDigits: 0 } ) } DUE
                            </span>
                          ) : (
                            <span className="text-[10px] text-[var(--muted-dim)]">—</span>
                          ) }
                        </td>
                        <td className="px-4 py-3">
                          <CopyTradeToggle follower={ f } onToggled={ handleToggled } />
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

"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CreditCard, Receipt, CheckCircle2, ChevronLeft, ChevronRight, User, LogOut } from "lucide-react";
import { openPaystackCheckout } from "@/lib/paystackClient";

interface SubscriptionInfo {
  status: string;
  monthlyFeeNGN: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  lastChargedAt: string | null;
}

interface InvoiceItem {
  id: string;
  periodStart: string;
  periodEnd: string;
  endBalanceUSD: number;
  priorPeakBalanceUSD: number;
  profitAboveHighWaterMarkUSD: number;
  feePercent: number;
  feeAmountUSD: number;
  feeAmountNGN: number;
  usdToNgnRateAtInvoice: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

function fmtUsd ( n: number ): string {
  return `$${ n.toLocaleString( "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) }`;
}

function fmtNgn ( n: number ): string {
  return `₦${ n.toLocaleString( "en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) }`;
}

function StatusPill ( { status }: { status: string } ) {
  const map: Record<string, { color: string; label: string }> = {
    PENDING_APPROVAL: { color: "var(--warn)", label: "AWAITING YOUR APPROVAL" },
    APPROVED: { color: "var(--warn)", label: "PAYMENT PENDING" },
    PAID: { color: "var(--long)", label: "PAID" },
    WAIVED: { color: "var(--muted)", label: "WAIVED" },
    EXPIRED: { color: "var(--short)", label: "EXPIRED" },
  };
  const entry = map[ status ] ?? { color: "var(--muted)", label: status };
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 whitespace-nowrap"
      style={ { color: entry.color, border: `1px solid ${ entry.color }` } }
    >
      { entry.label }
    </span>
  );
}

function InvoiceCard ( { invoice, onPay }: { invoice: InvoiceItem; onPay: ( id: string ) => void } ) {
  const [ busy, setBusy ] = useState( false );
  const [ error, setError ] = useState<string | null>( null );

  async function handlePay () {
    setBusy( true );
    setError( null );
    try {
      const res = await fetch( "/api/saas/invoices/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify( { invoiceId: invoice.id } ),
      } );
      const data = await res.json();
      if ( !res.ok ) {
        setError( data?.error ?? "Could not start payment." );
        return;
      }
      await openPaystackCheckout( {
        accessCode: data.accessCode,
        authorizationUrl: data.authorizationUrl,
        onSuccess: () => onPay( invoice.id ),
        onCancel: () => setBusy( false ),
      } );
      return;
    } catch {
      setError( "Could not reach the server." );
    } finally {
      setBusy( false );
    }
  }

  return (
    <div className="panel p-5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-[var(--muted)]">
          { new Date( invoice.periodStart ).toLocaleDateString() } –{ " " }
          { new Date( invoice.periodEnd ).toLocaleDateString() }
        </span>
        <StatusPill status={ invoice.status } />
      </div>

      <div className="space-y-1.5 font-mono text-xs">
        <div className="flex items-center justify-between">
          <span className="text-[var(--muted)]">Balance at period end</span>
          <span className="tabular">{ fmtUsd( invoice.endBalanceUSD ) }</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--muted)]">Your prior high-water mark</span>
          <span className="tabular">{ fmtUsd( invoice.priorPeakBalanceUSD ) }</span>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--hairline)] pt-1.5">
          <span className="text-[var(--muted)]">Profit above high-water mark</span>
          <span className="tabular font-semibold" style={ { color: "var(--long)" } }>
            { fmtUsd( invoice.profitAboveHighWaterMarkUSD ) }
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-[var(--hairline)]">
        <span className="text-sm text-[var(--muted)]">
          Fee ({ ( invoice.feePercent * 100 ).toFixed( 0 ) }% of profit above your peak)
        </span>
        <div className="text-right">
          <span className="font-display font-semibold text-lg block">{ fmtNgn( invoice.feeAmountNGN ) }</span>
          <span className="text-[10px] font-mono text-[var(--muted-dim)]">
            { fmtUsd( invoice.feeAmountUSD ) } converted at ₦{ invoice.usdToNgnRateAtInvoice.toLocaleString( "en-NG" ) }/$1
          </span>
        </div>
      </div>

      { error && (
        <p role="alert" className="text-xs font-mono text-[var(--short)]">{ error }</p>
      ) }

      { invoice.status === "PENDING_APPROVAL" && (
        <button
          onClick={ () => void handlePay() }
          disabled={ busy }
          className="w-full flex items-center justify-center gap-2 bg-[var(--text)] text-[var(--bg)]
                     font-display font-semibold text-sm py-2.5 hover:bg-[var(--long)] transition-colors
                     disabled:opacity-50"
        >
          { busy ? <Loader2 size={ 14 } className="animate-spin" /> : <CreditCard size={ 14 } /> }
          Review and pay { fmtNgn( invoice.feeAmountNGN ) }
        </button>
      ) }
    </div>
  );
}

export default function BillingPage () {
  const router = useRouter();
  const [ invoices, setInvoices ] = useState<InvoiceItem[] | null>( null );
  const [ currentInvoiceIndex, setCurrentInvoiceIndex ] = useState<number>( 0 );
  const [ error, setError ] = useState<string | null>( null );
  const [ subscribing, setSubscribing ] = useState( false );
  const [ subscribeError, setSubscribeError ] = useState<string | null>( null );
  const [ pricing, setPricing ] = useState<{ monthlyFeeUSD: number; monthlyFeeNGN: number } | null>( null );
  const [ subscription, setSubscription ] = useState<SubscriptionInfo | null>( null );
  const [ subLoading, setSubLoading ] = useState( true );

  const loadSubscription = useCallback( () => {
    setSubLoading( true );
    fetch( "/api/saas/billing/status" )
      .then( ( res ) => res.json() )
      .then( ( data ) => setSubscription( data.subscription ) )
      .catch( () => { } )
      .finally( () => setSubLoading( false ) );
  }, [] );

  useEffect( () => {
    loadSubscription();
  }, [ loadSubscription ] );

  useEffect( () => {
    fetch( "/api/saas/billing/pricing" )
      .then( ( res ) => res.json() )
      .then( ( data ) => {
        if ( data.monthlyFeeNGN ) setPricing( data );
      } )
      .catch( () => { } );
  }, [] );

  const loadInvoices = useCallback( () => {
    fetch( "/api/saas/invoices" )
      .then( async ( res ) => {
        const data = await res.json();
        if ( !res.ok ) throw new Error( data?.error ?? "Failed to load invoices." );
        setInvoices( data.invoices );
      } )
      .catch( ( err ) => setError( err.message ) );
  }, [] );

  useEffect( () => {
    loadInvoices();
  }, [ loadInvoices ] );

  useEffect( () => {
    fetch( "/api/saas/behaviour-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify( { type: "billing_view", metadata: { surface: "billing" } } ),
    } ).catch( () => {} );
  }, [] );

  async function handleSubscribe () {
    setSubscribing( true );
    setSubscribeError( null );
    try {
      const res = await fetch( "/api/saas/billing/subscribe", { method: "POST" } );
      const data = await res.json();
      if ( !res.ok ) {
        setSubscribeError( data?.error ?? "Could not start subscription." );
        return;
      }
      await openPaystackCheckout( {
        accessCode: data.accessCode,
        authorizationUrl: data.authorizationUrl,
        onSuccess: () => {
          loadSubscription();
          loadInvoices();
          router.refresh();
        },
        onCancel: () => setSubscribing( false ),
      } );
      return;
    } catch {
      setSubscribeError( "Could not reach the server." );
    } finally {
      setSubscribing( false );
    }
  }

  const handlePrevInvoice = () => {
    setCurrentInvoiceIndex( ( prev ) => Math.max( 0, prev - 1 ) );
  };

  const handleNextInvoice = () => {
    if ( !invoices ) return;
    setCurrentInvoiceIndex( ( prev ) => Math.min( invoices.length - 1, prev + 1 ) );
  };

  const normalizedStatus = subscription?.status?.toUpperCase();
  async function handleSignOut () {
    await fetch( "/api/saas/logout", { method: "POST" } ).catch( () => { } );
    router.push( "/app/login" );
  }
  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
        <div className="flex items-center gap-3">
          <button
            onClick={ () => router.push( "/app/dashboard" ) }
            aria-label="Back to dashboard"
            className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <ArrowLeft size={ 16 } />
          </button>
          <div className="flex items-center gap-2">
            <Receipt size={ 16 } />
            <span className="font-display font-semibold text-lg">Billing</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={ () => router.push( "/app/profile" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <User size={ 13 } />
            Profile
          </button>
          <div className="w-px h-4 bg-[var(--hairline)]" />
          <button
            onClick={ () => router.push( "/app/performance" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            {/* Changed icon to History/FileText to fit Performance better if available, or keep User */ }
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
        <div className="max-w-[560px] mx-auto space-y-6">
          <div className="panel p-5 space-y-3">
            <span className="eyebrow">Subscription</span>

            { subLoading ? (
              <div className="space-y-2 py-1">
                <div className="h-4 w-24 bg-[var(--panel-raised)] animate-pulse" />
                <div className="h-3 w-full bg-[var(--panel-raised)] animate-pulse" />
                <div className="h-3 w-2/3 bg-[var(--panel-raised)] animate-pulse" />
              </div>
            ) : normalizedStatus === "ACTIVE" ? (
              <>
                <div className="flex items-center gap-2 text-sm" style={ { color: "var(--long)" } }>
                  <CheckCircle2 size={ 16 } />
                  <span className="font-semibold">Active</span>
                </div>
                <div className="space-y-1.5 font-mono text-xs text-[var(--muted)]">
                  <div className="flex items-center justify-between">
                    <span>Monthly fee</span>
                    <span className="tabular">{ fmtNgn( subscription?.monthlyFeeNGN ?? pricing?.monthlyFeeNGN ?? 0 ) }</span>
                  </div>
                  { subscription?.currentPeriodEnd && (
                    <div className="flex items-center justify-between">
                      <span>Next charge</span>
                      <span className="tabular">
                        { new Date( subscription.currentPeriodEnd ).toLocaleDateString() }
                      </span>
                    </div>
                  ) }
                </div>
              </>
            ) : normalizedStatus === "PAST_DUE" ? (
              <>
                <p className="text-sm text-[var(--short)] font-semibold">
                  Payment failed — your subscription is past due.
                </p>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  Resubscribe below to update your payment method and
                  restore access.
                </p>
                { subscribeError && (
                  <p role="alert" className="text-xs font-mono text-[var(--short)]">{ subscribeError }</p>
                ) }
                <button
                  onClick={ () => void handleSubscribe() }
                  disabled={ subscribing || !pricing }
                  className="w-full flex items-center justify-center gap-2 bg-[var(--text)] text-[var(--bg)]
                             font-display font-semibold text-sm py-2.5 hover:bg-[var(--long)] transition-colors
                             disabled:opacity-50"
                >
                  { subscribing ? <Loader2 size={ 14 } className="animate-spin" /> : <CreditCard size={ 14 } /> }
                  { subscribing ? "Starting…" : pricing ? `Update payment — ${ fmtNgn( pricing.monthlyFeeNGN ) }/month` : "Loading price…" }
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  { pricing ? fmtNgn( pricing.monthlyFeeNGN ) : "…" }/month, billed
                  automatically. Plus a 30% fee on new profit above your
                  account&apos;s all-time high — only charged when you&apos;re ahead
                  of where you&apos;ve ever been, and only after you review and
                  approve the exact amount.
                </p>
                { subscribeError && (
                  <p role="alert" className="text-xs font-mono text-[var(--short)]">{ subscribeError }</p>
                ) }
                <button
                  onClick={ () => void handleSubscribe() }
                  disabled={ subscribing || !pricing || subLoading }
                  className="w-full flex items-center justify-center gap-2 bg-[var(--text)] text-[var(--bg)]
                             font-display font-semibold text-sm py-2.5 hover:bg-[var(--long)] transition-colors
                             disabled:opacity-50"
                >
                  { subscribing ? <Loader2 size={ 14 } className="animate-spin" /> : <CreditCard size={ 14 } /> }
                  { subscribing ? "Starting…" : pricing ? `Subscribe — ${ fmtNgn( pricing.monthlyFeeNGN ) }/month` : "Loading price…" }
                </button>
              </>
            ) }
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="eyebrow block">Performance fee invoices</span>
              { invoices && invoices.length > 1 && (
                <div className="flex items-center gap-2 text-xs font-mono text-[var(--muted)]">
                  <button
                    onClick={ handlePrevInvoice }
                    disabled={ currentInvoiceIndex === 0 }
                    className="p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-30 disabled:hover:text-[var(--muted)] transition-colors"
                    aria-label="Previous invoice"
                  >
                    <ChevronLeft size={ 16 } />
                  </button>
                  <span className="tabular">
                    { currentInvoiceIndex + 1 } / { invoices.length }
                  </span>
                  <button
                    onClick={ handleNextInvoice }
                    disabled={ currentInvoiceIndex === invoices.length - 1 }
                    className="p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-30 disabled:hover:text-[var(--muted)] transition-colors"
                    aria-label="Next invoice"
                  >
                    <ChevronRight size={ 16 } />
                  </button>
                </div>
              ) }
            </div>

            { error && (
              <p className="text-sm font-mono text-[var(--short)] border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
                { error }
              </p>
            ) }

            { !error && invoices === null && (
              <div className="panel p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="h-3 w-28 bg-[var(--panel-raised)] animate-pulse" />
                  <div className="h-4 w-20 bg-[var(--panel-raised)] animate-pulse" />
                </div>
                <div className="space-y-1.5">
                  <div className="h-3 w-full bg-[var(--panel-raised)] animate-pulse" />
                  <div className="h-3 w-full bg-[var(--panel-raised)] animate-pulse" />
                  <div className="h-3 w-3/4 bg-[var(--panel-raised)] animate-pulse" />
                </div>
                <div className="h-9 w-full bg-[var(--panel-raised)] animate-pulse" />
              </div>
            ) }

            { invoices && invoices.length === 0 && (
              <p className="text-sm text-[var(--muted)] font-mono">
                No performance fee invoices yet — these are generated
                automatically at the end of each billing period, only
                when you&apos;re ahead of your prior high-water mark.
              </p>
            ) }

            { invoices && invoices.length > 0 && (
              <InvoiceCard
                invoice={ invoices[ currentInvoiceIndex ] ?? invoices[ 0 ] }
                onPay={ loadInvoices }
              />
            ) }
          </div>
        </div>
      </div>
    </main>
  );
}

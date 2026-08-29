"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Link2, CreditCard, Mail, Loader2, User, ArrowLeft } from "lucide-react";
import { OnboardingModal } from "@/components/OnboardingModal";

export function ProfilePageClient ( {
  displayName,
  email,
  emailVerified,
  exchangeConnected,
  lastKnownBalanceUSDT,
  hasSeenOnboarding,
}: {
  displayName: string;
  email: string;
  emailVerified: boolean;
  exchangeConnected: boolean;
  lastKnownBalanceUSDT: number | null;
  hasSeenOnboarding: boolean;
} ) {
  const router = useRouter();
  const [ showOnboarding, setShowOnboarding ] = useState(
    !hasSeenOnboarding && !exchangeConnected
  );
  async function handleSignOut () {
    await fetch( "/api/saas/logout", { method: "POST" } ).catch( () => { } );
    router.push( "/app/login" );
  }

  return (
    <main className="min-h-screen flex flex-col">
      { showOnboarding && <OnboardingModal onDismiss={ () => setShowOnboarding( false ) } /> }

      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
        <div className="flex items-center gap-3">
          <button
            onClick={ () => router.push( "/app/dashboard" ) }
            className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <ArrowLeft size={ 16 } />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[var(--long)]" />
            <span className="font-display font-semibold text-lg">Profile</span>
          </div>
        </div>

        <div className="flex items-center gap-4">


          <button
            onClick={ () => router.push( "/app/billing" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <CreditCard size={ 13 } />
            Billing
          </button> <div className="w-px h-4 bg-[var(--hairline)]" /><button
            onClick={ () => router.push( "/app/performance" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            {/* Tip: Use <History size={13} /> or <FileText size={13} /> here if available instead of <User /> */ }
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
            <span className="eyebrow">Welcome</span>
            <h1 className="font-display text-2xl font-semibold mt-1">{ displayName }</h1>
            <p className="text-sm text-[var(--muted)] font-mono mt-1">{ email }</p>
          </div>

          <div className="panel p-5 space-y-3">
            <span className="eyebrow">Account status</span>
            <div className="flex items-center justify-between py-2 border-b border-[var(--hairline)]">
              <span className="text-sm text-[var(--muted)]">Email verification status</span>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5"
                style={ {
                  color: emailVerified ? "var(--long)" : "var(--warn)",
                  border: `1px solid ${ emailVerified ? "var(--long-dim)" : "var(--warn)" }`,
                } }
              >
                { emailVerified ? "VERIFIED" : "PENDING" }
              </span>
            </div>
            { !emailVerified && <ResendVerificationRow /> }
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-[var(--muted)]">Exchange</span>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5"
                style={ {
                  color: exchangeConnected ? "var(--long)" : "var(--muted)",
                  border: `1px solid ${ exchangeConnected ? "var(--long-dim)" : "var(--hairline-bright)" }`,
                } }
              >
                { exchangeConnected ? "CONNECTED" : "NOT CONNECTED" }
              </span>
            </div>
            { exchangeConnected && lastKnownBalanceUSDT !== null && (
              <div className="flex items-center justify-between py-2 border-t border-[var(--hairline)] pt-3">
                <span className="text-sm text-[var(--muted)]">Balance at verification</span>
                <span className="text-sm font-mono tabular">
                  ${ lastKnownBalanceUSDT.toLocaleString( "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) }
                </span>
              </div>
            ) }
          </div>

          { !exchangeConnected && (
            <button
              onClick={ () => router.push( "/app/connect" ) }
              className="flex items-center gap-2 bg-[var(--text)] text-[var(--bg)] font-display font-semibold text-sm
                         px-4 py-2.5 hover:bg-[var(--long)] transition-colors"
            >
              <Link2 size={ 15 } />
              Connect your exchange
            </button>
          ) }

          <div className="text-xs font-mono text-[var(--muted-dim)] border border-[var(--hairline)] px-4 py-3">
            { exchangeConnected
              ? "Your exchange API key is verified. Copy trading is currently inactive—complete all dashboard requirements and toggle it on to begin executing trades."
              : "Subscription inactive. An active monthly plan and verified exchange connection are required before trades can execute." }
          </div>
        </div>
      </div>
    </main>
  );
}

function ResendVerificationRow () {
  const [ busy, setBusy ] = useState( false );
  const [ sent, setSent ] = useState( false );
  const [ error, setError ] = useState<string | null>( null );

  async function handleResend () {
    setBusy( true );
    setError( null );
    try {
      const res = await fetch( "/api/saas/resend-verification", { method: "POST" } );
      const data = await res.json();
      if ( !res.ok ) {
        setError( data?.error ?? "Could not resend verification email." );
        return;
      }
      setSent( true );
    } catch {
      setError( "Could not reach the server." );
    } finally {
      setBusy( false );
    }
  }

  return (
    <div className="py-2 border-b border-[var(--hairline)] space-y-1.5">
      { sent ? (
        <p className="text-xs font-mono text-[var(--long)]">
          Verification email sent — check your inbox.
        </p>
      ) : (
        <button
          onClick={ () => void handleResend() }
          disabled={ busy }
          className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)]
                     transition-colors disabled:opacity-50"
        >
          { busy ? <Loader2 size={ 12 } className="animate-spin" /> : <Mail size={ 12 } /> }
          { busy ? "Sending…" : "Resend verification email" }
        </button>
      ) }
      { error && <p className="text-xs font-mono text-[var(--short)]">{ error }</p> }
    </div>
  );
}

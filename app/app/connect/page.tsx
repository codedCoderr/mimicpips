"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, TriangleAlert, Loader2, ArrowRight, RefreshCcw } from "lucide-react";
import { FollowerHeader } from "@/components/FollowerHeader";

export default function ConnectExchangePage () {
  const router = useRouter();
  const [ apiKey, setApiKey ] = useState( "" );
  const [ apiSecret, setApiSecret ] = useState( "" );
  const [ error, setError ] = useState<string | null>( null );
  const [ success, setSuccess ] = useState<{ balanceUSDT: number | null } | null>( null );
  const [ busy, setBusy ] = useState( false );
  const [ loadingConnection, setLoadingConnection ] = useState( true );
  const [ replacingKey, setReplacingKey ] = useState( false );
  const [ connection, setConnection ] = useState<{
    connected: boolean;
    exchange: string | null;
    balanceUSDT: number | null;
    lastCheckedAt: string | null;
  } | null>( null );
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadConnection() {
      try {
        const res = await fetch( "/api/saas/me", { cache: "no-store" } );
        const data = await res.json().catch( () => null );
        if (cancelled) return;
        setConnection({
          connected: Boolean(data?.user?.exchangeConnected),
          exchange: data?.user?.exchange ?? null,
          balanceUSDT: typeof data?.user?.lastKnownBalanceUSDT === "number" ? data.user.lastKnownBalanceUSDT : null,
          lastCheckedAt: data?.user?.lastBalanceCheckAt ?? null,
        });
      } catch {
        if (!cancelled) setConnection(null);
      } finally {
        if (!cancelled) setLoadingConnection(false);
      }
    }

    loadConnection();

    return () => {
      cancelled = true;
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, []);

  async function handleSubmit ( e: React.FormEvent ) {
    e.preventDefault();
    setError( null );
    setBusy( true );

    try {
      const res = await fetch( "/api/saas/connect-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify( { apiKey, apiSecret } ),
      } );
      const data = await res.json();
      if ( !res.ok ) {
        setError( data?.error ?? "Could not connect this key." );
        return;
      }
      setSuccess( { balanceUSDT: data.balanceUSDT } );
      setConnection({
        connected: true,
        exchange: "binance",
        balanceUSDT: typeof data.balanceUSDT === "number" ? data.balanceUSDT : null,
        lastCheckedAt: new Date().toISOString(),
      });
      setReplacingKey(false);
      setApiKey( "" );
      setApiSecret( "" );
      redirectTimer.current = setTimeout( () => router.push( "/app/dashboard" ), 2000 );
    } catch {
      setError( "Could not reach the server." );
    } finally {
      setBusy( false );
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <FollowerHeader />

      <div className="flex-1 p-6">
        <div className="max-w-[680px] mx-auto space-y-6">
          <div className="space-y-2">
            <p className="eyebrow">Exchange access</p>
            <h1 className="font-display text-3xl font-semibold text-[var(--text)]">Manage your Binance connection</h1>
            <p className="text-sm text-[var(--muted)] max-w-[560px]">
              Mimic Pips only needs read and futures trade access. Withdrawal permission is never required and is rejected.
            </p>
          </div>

          { loadingConnection && (
            <div className="panel p-5 flex items-center gap-2 text-sm text-[var(--muted)] font-mono">
              <Loader2 size={ 15 } className="animate-spin" />
              Checking exchange status...
            </div>
          ) }

          { !loadingConnection && connection?.connected && !replacingKey && (
            <section className="panel p-5 space-y-5" aria-labelledby="exchange-status-title">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 flex items-center justify-center border border-[var(--long-dim)] bg-[var(--long-dim)]/10 text-[var(--long)]">
                  <ShieldCheck size={ 20 } />
                </div>
                <div className="min-w-0">
                  <p id="exchange-status-title" className="font-display text-xl font-semibold text-[var(--text)]">Exchange already connected</p>
                  <p className="text-sm text-[var(--muted)] mt-1">
                    Your verified { connection.exchange ?? "Binance" } key is active. You do not need to reconnect unless you intentionally want to replace it.
                  </p>
                </div>
              </div>

              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="border border-[var(--hairline)] bg-[var(--panel-raised)] p-4">
                  <dt className="eyebrow">Last known balance</dt>
                  <dd className="mt-2 font-display text-2xl text-[var(--text)]">
                    { connection.balanceUSDT === null
                      ? "Unavailable"
                      : `$${ connection.balanceUSDT.toLocaleString( "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) }` }
                  </dd>
                </div>
                <div className="border border-[var(--hairline)] bg-[var(--panel-raised)] p-4">
                  <dt className="eyebrow">Last checked</dt>
                  <dd className="mt-2 font-mono text-sm text-[var(--text)]">
                    { connection.lastCheckedAt ? new Date( connection.lastCheckedAt ).toLocaleString() : "Not recorded" }
                  </dd>
                </div>
              </dl>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={ () => router.push( "/app/dashboard" ) }
                  className="inline-flex items-center justify-center gap-2 bg-[var(--text)] text-[var(--bg)] font-display font-semibold text-sm px-4 py-3 hover:bg-[var(--long)] transition-colors"
                >
                  Go to dashboard
                  <ArrowRight size={ 15 } />
                </button>
                <button
                  type="button"
                  onClick={ () => { setReplacingKey(true); setSuccess(null); setError(null); } }
                  className="inline-flex items-center justify-center gap-2 border border-[var(--hairline)] text-[var(--text)] font-display font-semibold text-sm px-4 py-3 hover:border-[var(--warn)] hover:text-[var(--warn)] transition-colors"
                >
                  <RefreshCcw size={ 15 } />
                  Replace API key
                </button>
              </div>
            </section>
          ) }

          { !loadingConnection && (!connection?.connected || replacingKey) && (
          <>
          <div className="flex items-start gap-2 text-xs font-mono text-[var(--warn)] border border-[var(--warn)]/40 bg-[var(--warn)]/5 px-4 py-3">
            <TriangleAlert size={ 14 } className="shrink-0 mt-0.5" />
            <div className="space-y-1.5">
              <p>
                Create a <strong>new</strong> Binance API key specifically for
                this — don&apos;t reuse a key from another app.
              </p>
              <p>
                On Binance, when creating the key: enable{ " " }
                <strong>Enable Reading</strong> and{ " " }
                <strong>Enable Futures</strong>. Leave{ " " }
                <strong>Enable Withdrawals</strong> OFF. Keys with
                withdrawal permission are rejected automatically — this
                platform never needs it and won&apos;t accept it.
              </p>
            </div>
          </div>

          <form onSubmit={ handleSubmit } className="panel p-5 space-y-4">
            <div>
              <label htmlFor="apiKey" className="eyebrow block mb-2">API Key</label>
              <input
                id="apiKey"
                value={ apiKey }
                onChange={ ( e ) => setApiKey( e.target.value ) }
                autoComplete="off"
                spellCheck={ false }
                className="w-full bg-[var(--panel-raised)] border border-[var(--hairline)] px-3.5 py-2.5 text-sm font-mono
                           text-[var(--text)] placeholder:text-[var(--muted-dim)]
                           focus:outline-none focus:border-[var(--long)] transition-colors"
              />
            </div>
            <div>
              <label htmlFor="apiSecret" className="eyebrow block mb-2">API Secret</label>
              <input
                id="apiSecret"
                type="password"
                value={ apiSecret }
                onChange={ ( e ) => setApiSecret( e.target.value ) }
                autoComplete="off"
                spellCheck={ false }
                className="w-full bg-[var(--panel-raised)] border border-[var(--hairline)] px-3.5 py-2.5 text-sm font-mono
                           text-[var(--text)] placeholder:text-[var(--muted-dim)]
                           focus:outline-none focus:border-[var(--long)] transition-colors"
              />
            </div>

            { error && (
              <div role="alert" className="text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
                { error }
              </div>
            ) }

            { success && (
              <div role="status" className="flex items-start gap-2 text-sm text-[var(--long)] font-mono border border-[var(--long-dim)] bg-[var(--long-dim)]/10 px-3 py-2">
                <ShieldCheck size={ 15 } className="shrink-0 mt-0.5" />
                <span>
                  Key verified and connected.
                  { success.balanceUSDT !== null &&
                    ` Balance: $${ success.balanceUSDT.toLocaleString( "en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    } ) }` }
                  { " " }Taking you back to your dashboard…
                </span>
              </div>
            ) }

            <button
              type="submit"
              disabled={ busy }
              className="w-full flex items-center justify-center gap-2 bg-[var(--text)] text-[var(--bg)]
                         font-display font-semibold text-sm py-3 hover:bg-[var(--long)] transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              { busy && <Loader2 size={ 15 } className="animate-spin" /> }
              { busy ? "Verifying…" : "Connect exchange" }
            </button>
          </form>

          <p className="text-xs text-[var(--muted-dim)] font-mono leading-relaxed">
            Your key is encrypted before it&apos;s stored and is never shown
            again after this step. It is verified against Binance directly —
            trade and read access only, no withdrawal permission.
          </p>
          </>
          ) }
        </div>
      </div>
    </main>
  );
}

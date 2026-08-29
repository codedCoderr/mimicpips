"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck, TriangleAlert, Loader2 } from "lucide-react";

export default function ConnectExchangePage () {
  const router = useRouter();
  const [ apiKey, setApiKey ] = useState( "" );
  const [ apiSecret, setApiSecret ] = useState( "" );
  const [ error, setError ] = useState<string | null>( null );
  const [ success, setSuccess ] = useState<{ balanceUSDT: number | null } | null>( null );
  const [ busy, setBusy ] = useState( false );
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
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
      setApiKey( "" );
      setApiSecret( "" );
      // Give the user a moment to see the confirmation, then take them
      // back to the dashboard rather than leaving them stranded on a
      // form they've already completed.
      redirectTimer.current = setTimeout( () => router.push( "/app/dashboard" ), 2000 );
    } catch {
      setError( "Could not reach the server." );
    } finally {
      setBusy( false );
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
        <div className="flex items-center gap-3">
          <button
            onClick={ () => router.push( "/app/profile" ) }
            className="flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <ArrowLeft size={ 13 } />
            Back
          </button>
          <div className="w-px h-4 bg-[var(--hairline)]" />
          <span className="font-display font-semibold text-lg">Connect Exchange</span>
        </div>
      </header>

      <div className="flex-1 p-6">
        <div className="max-w-[560px] mx-auto space-y-6">
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
        </div>
      </div>
    </main>
  );
}

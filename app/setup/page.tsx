"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadVerifiedSession, saveSession } from "@/lib/session";
import { getErrorMessage } from "@/lib/errorMessage";
import { normalizeBaseUrl } from "@/lib/url";

export default function ConnectPage () {
  const router = useRouter();
  const [ baseUrl, setBaseUrl ] = useState( "" );
  const [ apiKey, setApiKey ] = useState( "" );
  const [ error, setError ] = useState<string | null>( null );
  const [ checking, setChecking ] = useState( false );

  useEffect( () => {
    let cancelled = false;
    loadVerifiedSession().then((existing) => {
      if (!cancelled && existing) router.replace( "/dashboard" );
    });
    return () => {
      cancelled = true;
    };
  }, [ router ] );

  // If someone lands here without a valid auth session, middleware won't
  // have caught it (this route isn't in the matcher), so send them to
  // login first — /dashboard itself is still the protected boundary.

  async function handleConnect ( e: React.FormEvent ) {
    e.preventDefault();
    setError( null );

    const trimmedUrl = normalizeBaseUrl( baseUrl );
    if ( !trimmedUrl ) {
      setError( "Enter the bot's server address." );
      return;
    }
    if ( !apiKey.trim() ) {
      setError( "Enter the dashboard API key." );
      return;
    }

    setChecking( true );
    try {
      const res = await fetch("/api/operator/bot-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: trimmedUrl, apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? "Could not connect.");
      }

      saveSession();
      router.push( "/dashboard" );
    } catch ( err: unknown ) {
      setError( getErrorMessage( err, "Could not connect." ) );
    } finally {
      setChecking( false );
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
      {/* Ambient grid backdrop */ }
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={ {
          backgroundImage:
            "linear-gradient(var(--hairline-bright) 1px, transparent 1px), linear-gradient(90deg, var(--hairline-bright) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        } }
      />

      <div className="w-full max-w-[420px] relative">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--long)] pulse-dot" />
          <span className="eyebrow">Control Room</span>
        </div>

        <h1 className="font-display text-[28px] font-semibold leading-tight mb-2">
          Connect to the bot
        </h1>
        <p className="text-sm text-[var(--muted)] mb-8 leading-relaxed">
          Enter your dashboard server address and API key. Credentials are kept
          in an httpOnly operator session.
        </p>

        <form onSubmit={ handleConnect } className="space-y-4">
          <div>
            <label htmlFor="botServerAddress" className="eyebrow block mb-2">Server address</label>
            <input
              id="botServerAddress"
              type="text"
              value={ baseUrl }
              onChange={ ( e ) => setBaseUrl( e.target.value ) }
              placeholder="https://your-server:3847"
              autoComplete="off"
              className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3.5 py-2.5 text-sm font-mono
                         text-[var(--text)] placeholder:text-[var(--muted-dim)]
                         focus:outline-none focus:border-[var(--long)] transition-colors"
            />
          </div>

          <div>
            <label htmlFor="botApiKey" className="eyebrow block mb-2">API key</label>
            <input
              id="botApiKey"
              type="password"
              value={ apiKey }
              onChange={ ( e ) => setApiKey( e.target.value ) }
              placeholder="••••••••••••••••"
              autoComplete="off"
              className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3.5 py-2.5 text-sm font-mono
                         text-[var(--text)] placeholder:text-[var(--muted-dim)]
                         focus:outline-none focus:border-[var(--long)] transition-colors"
            />
          </div>

          { error && (
            <div role="alert" className="text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
              { error }
            </div>
          ) }

          <button
            type="submit"
            disabled={ checking }
            className="w-full mt-2 bg-[var(--text)] text-[var(--bg)] font-display font-semibold text-sm
                       py-3 hover:bg-[var(--long)] transition-colors disabled:opacity-50
                       disabled:cursor-not-allowed"
          >
            { checking ? "Connecting…" : "Connect" }
          </button>
        </form>

        <p className="text-xs text-[var(--muted-dim)] mt-8 font-mono leading-relaxed">
          This key is verified once here, then sent from server-side proxy
          routes so it is not exposed to browser JavaScript.
        </p>
      </div>
    </main>
  );
}

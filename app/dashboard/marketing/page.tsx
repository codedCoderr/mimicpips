"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Megaphone, Loader2, Sparkles, AlertTriangle, Send } from "lucide-react";

type MarketingEvent = {
  id: string;
  type: string;
  title: string;
  summary: string;
  metricLabel: string;
  metricValue: string;
  audience: string;
  createdAt: string;
};

type RetentionOpportunity = {
  userId: string;
  displayName: string;
  email: string;
  score: number;
  band: string;
  drivers: string[];
  recommendedAction: string;
  suggestedMessage: string;
};

const eventTypes = [
  { value: "monthly_gain_milestone", label: "Monthly gain milestone" },
  { value: "crisis_averted", label: "Crisis averted" },
  { value: "new_equity_high", label: "New equity high" },
  { value: "drawdown_recovery", label: "Drawdown recovery" },
  { value: "risk_guard_triggered", label: "Risk guard triggered" },
  { value: "extended_drawdown", label: "Extended Drawdown" },
  { value: "technical_disruption", label: "Technical Disruption" },
  { value: "retention_followup", label: "Retention Follow-up" },

];

function eventLabel ( type: string ): string {
  return eventTypes.find( ( item ) => item.value === type )?.label ?? type.replace( /_/g, " " );
}

function bandColor ( band: string ): string {
  if ( band === "likely_to_churn" ) return "var(--short)";
  if ( band === "anxious" ) return "var(--warn)";
  if ( band === "watching" ) return "var(--muted)";
  return "var(--long)";
}

function telegramCopy ( event: MarketingEvent ): string {
  const label = event.type.replace( /_/g, " " ).toUpperCase();
  const metric = event.metricValue ? [ "KEY METRIC", `${ event.metricLabel || "Signal" }: ${ event.metricValue }` ].join( "\n" ) : "";

  return [
    "MIMIC PIPS SIGNAL DESK",
    label,
    "",
    event.title,
    "",
    event.summary,
    metric ? `\n${ metric }` : "",
    "",
    "SYSTEM STATUS",
    "Risk Guard: Active",
    "Copy Engine: Monitoring",
    "Execution Rules: Enforced",
    "",
    "This is not financial advice. Futures trading carries risk.",
  ].filter( Boolean ).join( "\n" );
}

class UiRequestError extends Error {
  level: "error" | "warning";

  constructor ( message: string, level: "error" | "warning" = "error" ) {
    super( message );
    this.name = "UiRequestError";
    this.level = level;
  }
}

async function parseApiResponse<T> ( res: Response, fallback: string ): Promise<T> {
  const data = await res.json().catch( () => null );

  if ( !res.ok ) {
    if ( res.status === 429 ) {
      throw new UiRequestError( data?.error ?? "You are doing that too quickly. Please slow down and try again in a moment.", "warning" );
    }

    throw new UiRequestError( data?.error ?? fallback );
  }

  return data as T;
}

function showRequestError ( err: unknown, setError: ( value: string | null ) => void, setWarning: ( value: string | null ) => void, fallback: string ) {
  const message = err instanceof Error ? err.message : fallback;

  if ( err instanceof UiRequestError && err.level === "warning" ) {
    setWarning( message );
    return;
  }

  setError( message );
}

export default function MarketingSignalsPage () {
  const router = useRouter();
  const [ events, setEvents ] = useState<MarketingEvent[]>( [] );
  const [ opportunities, setOpportunities ] = useState<RetentionOpportunity[]>( [] );
  const [ loading, setLoading ] = useState( true );
  const [ saving, setSaving ] = useState( false );
  const [ sendingKey, setSendingKey ] = useState<string | null>( null );
  const [ error, setError ] = useState<string | null>( null );
  const [ warning, setWarning ] = useState<string | null>( null );
  const [ notice, setNotice ] = useState<string | null>( null );
  const [ retentionRunning, setRetentionRunning ] = useState( false );
  const [ automationRunning, setAutomationRunning ] = useState( false );
  const [ form, setForm ] = useState( {
    type: "monthly_gain_milestone",
    title: "",
    summary: "",
    metricLabel: "",
    metricValue: "",
    audience: "public",
  } );

  const load = useCallback( () => {
    setLoading( true );
    fetch( "/api/operator/marketing-events", { cache: "no-store" } )
      .then( async ( res ) => {
        const data = await parseApiResponse<{ events?: MarketingEvent[]; opportunities?: RetentionOpportunity[] }>( res, "Could not load marketing signals." );
        setEvents( data.events ?? [] );
        setOpportunities( data.opportunities ?? [] );
        setError( null );
        setWarning( null );
      } )
      .catch( ( err: unknown ) => showRequestError( err, setError, setWarning, "Could not load marketing signals." ) )
      .finally( () => setLoading( false ) );
  }, [] );

  useEffect( () => {
    load();
  }, [ load ] );

  async function runMarketingAutomation () {
    setAutomationRunning( true );
    setError( null );
    setWarning( null );
    setNotice( null );
    try {
      const res = await fetch( "/api/operator/marketing-automation/run-now", { method: "POST" } );
      const data = await parseApiResponse<{ results?: { outcome: string }[] }>( res, "Could not run marketing automation." );
      const results = Array.isArray( data?.results ) ? data.results : [];
      const created = results.filter( ( result ) => result.outcome === "created" ).length;
      const sent = results.filter( ( result ) => result.outcome === "telegram_sent" ).length;
      const existing = results.filter( ( result ) => result.outcome === "already_exists" ).length;
      const errored = results.filter( ( result ) => result.outcome === "telegram_error" ).length;
      setNotice( `Marketing scan complete: ${ created } created, ${ sent } sent, ${ existing } already existed, ${ errored } Telegram error(s).` );
      load();
    } catch ( err ) {
      showRequestError( err, setError, setWarning, "Could not run marketing automation." );
    } finally {
      setAutomationRunning( false );
    }
  }

  async function runRetentionEmails ( dryRun: boolean ) {
    setRetentionRunning( true );
    setError( null );
    setWarning( null );
    setNotice( null );
    try {
      const res = await fetch( `/api/operator/retention-emails/run-now?dryRun=${ dryRun ? "true" : "false" }`, { method: "POST" } );
      const data = await parseApiResponse<{ results?: { outcome: string }[] }>( res, "Could not run retention emails." );
      const results = Array.isArray( data?.results ) ? data.results : [];
      const sent = results.filter( ( result ) => result.outcome === "sent" ).length;
      const dry = results.filter( ( result ) => result.outcome === "dry_run" ).length;
      const skipped = results.filter( ( result ) => result.outcome === "skipped_already_sent" ).length;
      setNotice( dryRun ? `Dry run found ${ dry } candidate(s), ${ skipped } already sent today.` : `Retention email cycle complete: ${ sent } sent, ${ skipped } skipped.` );
      load();
    } catch ( err ) {
      showRequestError( err, setError, setWarning, "Could not run retention emails." );
    } finally {
      setRetentionRunning( false );
    }
  }

  async function handleSubmit ( e: React.FormEvent<HTMLFormElement> ) {
    e.preventDefault();
    setSaving( true );
    setError( null );
    setWarning( null );
    setNotice( null );
    try {
      const res = await fetch( "/api/operator/marketing-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify( form ),
      } );
      await parseApiResponse<unknown>( res, "Could not save signal." );
      setForm( { type: "monthly_gain_milestone", title: "", summary: "", metricLabel: "", metricValue: "", audience: "public" } );
      setNotice( "Marketing signal saved." );
      load();
    } catch ( err ) {
      showRequestError( err, setError, setWarning, "Could not save signal." );
    } finally {
      setSaving( false );
    }
  }

  function draftFromOpportunity ( opp: RetentionOpportunity ) {
    setForm( {
      type: opp.band === "likely_to_churn" ? "crisis_averted" : "risk_guard_triggered",
      title: `${ opp.displayName } retention follow-up`,
      summary: opp.suggestedMessage,
      metricLabel: "Follower health",
      metricValue: `${ opp.score }/100`,
      audience: "private_retention",
    } );
    window.scrollTo( { top: 0, behavior: "smooth" } );
  }

  async function sendRetentionEmail ( opp: RetentionOpportunity ) {
    setSendingKey( opp.userId );
    setError( null );
    setWarning( null );
    setNotice( null );
    try {
      const res = await fetch( "/api/operator/marketing-events/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify( {
          channel: "email",
          userId: opp.userId,
          subject: "Mimic Pips risk-control update",
          message: opp.suggestedMessage,
        } ),
      } );
      await parseApiResponse<unknown>( res, "Could not send email." );
      setNotice( `Email sent to ${ opp.displayName }.` );
    } catch ( err ) {
      showRequestError( err, setError, setWarning, "Could not send email." );
    } finally {
      setSendingKey( null );
    }
  }

  async function sendTelegramPublic ( event: MarketingEvent ) {
    setSendingKey( event.id );
    setError( null );
    setWarning( null );
    setNotice( null );
    try {
      const message = telegramCopy( event );
      const res = await fetch( "/api/operator/marketing-events/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify( {
          channel: "telegram_public",
          eventId: event.id,
          subject: event.title,
          message,
        } ),
      } );
      await parseApiResponse<unknown>( res, "Could not send Telegram message." );
      setNotice( "Telegram message sent to the public channel." );
      load();
    } catch ( err ) {
      showRequestError( err, setError, setWarning, "Could not send Telegram message." );
    } finally {
      setSendingKey( null );
    }
  }

  async function markTelegramDraft ( event: MarketingEvent ) {
    setSendingKey( event.id );
    setError( null );
    setWarning( null );
    setNotice( null );
    try {
      const message = telegramCopy( event );
      const res = await fetch( "/api/operator/marketing-events/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify( {
          channel: "telegram_draft",
          eventId: event.id,
          subject: event.title,
          message,
        } ),
      } );
      await parseApiResponse<unknown>( res, "Could not create Telegram draft log." );
      await navigator.clipboard?.writeText( message ).catch( () => { } );
      setNotice( "Telegram draft logged and copied to clipboard." );
      load();
    } catch ( err ) {
      showRequestError( err, setError, setWarning, "Could not create Telegram draft." );
    } finally {
      setSendingKey( null );
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
        <div className="flex items-center gap-3">
          <button type="button" onClick={ () => router.push( "/dashboard" ) } aria-label="Back to dashboard" className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            <ArrowLeft size={ 16 } />
          </button>
          <div className="w-px h-4 bg-[var(--hairline)]" />
          <div className="flex items-center gap-2">
            <Megaphone size={ 16 } />
            <span className="font-display font-semibold text-lg">Marketing Signals</span>
          </div>
        </div>
        { loading && <Loader2 size={ 14 } className="animate-spin text-[var(--muted)]" /> }
      </header>

      <div className="flex-1 p-6">
        <div className="max-w-[1200px] mx-auto space-y-6">
          { error && <div role="alert" className="text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">{ error }</div> }
          { warning && <div role="status" className="text-sm text-[var(--warn)] font-mono border border-[var(--warn-dim)] bg-[var(--warn-dim)]/10 px-3 py-2">{ warning }</div> }
          { notice && <div className="text-sm text-[var(--long)] font-mono border border-[var(--long-dim)] bg-[var(--long-dim)]/10 px-3 py-2">{ notice }</div> }

          <form onSubmit={ ( e ) => void handleSubmit( e ) } className="panel p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <span className="eyebrow">Create signal</span>
                <h1 className="font-display text-2xl font-semibold mt-1">Turn trading truth into marketable proof</h1>
                <p className="text-sm text-[var(--muted)] mt-2 max-w-2xl leading-relaxed">Capture moments worth turning into Telegram posts, email updates, win cards, and retention follow-ups.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={retentionRunning || automationRunning} onClick={() => void runMarketingAutomation()} className="border border-[var(--long-dim)] text-[var(--long)] hover:text-[var(--text)] font-mono text-xs px-3 py-2 disabled:opacity-50">Run automation scan</button>
                <button type="button" disabled={retentionRunning} onClick={() => void runRetentionEmails(true)} className="border border-[var(--hairline-bright)] text-[var(--muted)] hover:text-[var(--text)] font-mono text-xs px-3 py-2 disabled:opacity-50">Dry-run emails</button>
                <button type="button" disabled={retentionRunning} onClick={() => void runRetentionEmails(false)} className="border border-[var(--long-dim)] text-[var(--long)] hover:text-[var(--text)] font-mono text-xs px-3 py-2 disabled:opacity-50">Send retention emails</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1.5"><span className="eyebrow">Type</span><select value={ form.type } onChange={ ( e ) => setForm( ( prev ) => ( { ...prev, type: e.target.value } ) ) } className="w-full bg-[var(--panel-raised)] border border-[var(--hairline-bright)] px-3 py-2 text-sm">{ eventTypes.map( ( type ) => <option key={ type.value } value={ type.value }>{ type.label }</option> ) }</select></label>
              <label className="space-y-1.5"><span className="eyebrow">Audience</span><select value={ form.audience } onChange={ ( e ) => setForm( ( prev ) => ( { ...prev, audience: e.target.value } ) ) } className="w-full bg-[var(--panel-raised)] border border-[var(--hairline-bright)] px-3 py-2 text-sm"><option value="public">Public acquisition</option><option value="followers">Existing followers</option><option value="private_retention">Private retention</option></select></label>
              <label className="space-y-1.5 md:col-span-2"><span className="eyebrow">Title</span><input required value={ form.title } onChange={ ( e ) => setForm( ( prev ) => ( { ...prev, title: e.target.value } ) ) } className="w-full bg-[var(--panel-raised)] border border-[var(--hairline-bright)] px-3 py-2 text-sm" placeholder="Risk Guard protected follower capital during volatility" /></label>
              <label className="space-y-1.5"><span className="eyebrow">Metric label</span><input value={ form.metricLabel } onChange={ ( e ) => setForm( ( prev ) => ( { ...prev, metricLabel: e.target.value } ) ) } className="w-full bg-[var(--panel-raised)] border border-[var(--hairline-bright)] px-3 py-2 text-sm" placeholder="Drawdown avoided" /></label>
              <label className="space-y-1.5"><span className="eyebrow">Metric value</span><input value={ form.metricValue } onChange={ ( e ) => setForm( ( prev ) => ( { ...prev, metricValue: e.target.value } ) ) } className="w-full bg-[var(--panel-raised)] border border-[var(--hairline-bright)] px-3 py-2 text-sm" placeholder="-1.2% vs market -8.4%" /></label>
              <label className="space-y-1.5 md:col-span-2"><span className="eyebrow">Campaign copy</span><textarea required value={ form.summary } onChange={ ( e ) => setForm( ( prev ) => ( { ...prev, summary: e.target.value } ) ) } rows={ 4 } className="w-full bg-[var(--panel-raised)] border border-[var(--hairline-bright)] px-3 py-2 text-sm leading-relaxed" placeholder="Write the Telegram/email proof point in plain language." /></label>
            </div>
            <button type="submit" disabled={ saving } className="inline-flex items-center gap-2 bg-[var(--text)] text-[var(--bg)] font-display font-semibold text-sm px-4 py-2 disabled:opacity-50">{ saving ? <Loader2 size={ 15 } className="animate-spin" /> : <Send size={ 15 } /> }{ saving ? "Saving signal..." : "Save marketing signal" }</button>
          </form>

          <section className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
            <div className="panel overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--hairline)] flex items-center justify-between"><span className="eyebrow">Retention opportunities</span><AlertTriangle size={ 14 } className="text-[var(--warn)]" /></div>
              { opportunities.length === 0 ? <div className="p-8 text-center text-sm font-mono text-[var(--muted)]">No urgent retention signals right now.</div> : <div className="divide-y divide-[var(--hairline)]">{ opportunities.map( ( opp ) => <article key={ opp.userId } className="p-5 space-y-3 hover:bg-[var(--panel-raised)] transition-colors"><div className="flex items-start justify-between gap-4"><div><h2 className="font-display font-semibold">{ opp.displayName }</h2><p className="text-xs font-mono text-[var(--muted)]">{ opp.email }</p></div><span className="text-[10px] font-semibold px-1.5 py-0.5 whitespace-nowrap" style={ { color: bandColor( opp.band ), border: `1px solid ${ bandColor( opp.band ) }` } }>{ opp.score }/100 { opp.band.replace( /_/g, " " ).toUpperCase() }</span></div><p className="text-sm text-[var(--muted)] leading-relaxed">{ opp.recommendedAction }</p><div className="text-xs font-mono text-[var(--muted-dim)] space-y-1">{ opp.drivers.slice( 0, 3 ).map( ( driver ) => <p key={ driver }>{ driver }</p> ) }</div><div className="bg-[var(--panel)] border border-[var(--hairline)] p-3 text-xs font-mono text-[var(--muted)] leading-relaxed">{ opp.suggestedMessage }</div><div className="flex flex-wrap gap-3"><button type="button" onClick={ () => draftFromOpportunity( opp ) } className="text-xs font-mono text-[var(--long)] hover:text-[var(--text)] transition-colors">Use as campaign draft</button><button type="button" disabled={ sendingKey === opp.userId } onClick={ () => void sendRetentionEmail( opp ) } className="text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors disabled:opacity-50">{ sendingKey === opp.userId ? "Sending..." : "Send email" }</button></div></article> ) }</div> }
            </div>

            <div className="panel overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--hairline)] flex items-center justify-between"><span className="eyebrow">Saved signals</span><Sparkles size={ 14 } className="text-[var(--long)]" /></div>
              { events.length === 0 ? <div className="p-8 text-center text-sm font-mono text-[var(--muted)]">No saved signals yet.</div> : <div className="divide-y divide-[var(--hairline)] max-h-[720px] overflow-y-auto">{ events.map( ( event ) => <article key={ event.id } className="p-5 space-y-2"><div className="flex items-center justify-between gap-3"><span className="eyebrow">{ eventLabel( event.type ) }</span><span className="text-[10px] font-mono text-[var(--muted-dim)]">{ new Date( event.createdAt ).toLocaleDateString() }</span></div><h2 className="font-display font-semibold">{ event.title }</h2><p className="text-sm text-[var(--muted)] leading-relaxed">{ event.summary }</p>{ event.metricValue && <p className="text-xs font-mono text-[var(--long)]">{ event.metricLabel || "Metric" }: { event.metricValue }</p> }<div className="flex flex-wrap gap-3"><button type="button" disabled={ sendingKey === event.id } onClick={ () => void markTelegramDraft( event ) } className="text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors disabled:opacity-50">{ sendingKey === event.id ? "Preparing..." : "Copy Telegram draft" }</button><button type="button" disabled={ sendingKey === event.id } onClick={ () => void sendTelegramPublic( event ) } className="text-xs font-mono text-[var(--long)] hover:text-[var(--text)] transition-colors disabled:opacity-50">{ sendingKey === event.id ? "Sending..." : "Send to Telegram" }</button></div></article> ) }</div> }
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

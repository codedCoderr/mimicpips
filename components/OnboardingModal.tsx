"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  ShieldCheck,
  ArrowRight,
  KeyRound,
  AlertTriangle,
  Check,
  Percent,
  TrendingUp,
  Activity,
  Loader2,
  FileText,
  Copy,
  ExternalLink,
} from "lucide-react";
import { LEGAL_DOCS } from "@/lib/legalConstants";

type LegalDocType = "risk" | "terms" | "privacy" | null;

interface SystemBaseline {
  days: number;
  totalTrades: number;
  historicalWinRatePct: number | null;
  maxDrawdownPct: number | null;
  riskPerTradePct: number | null;
  maxAccountExposurePct: number | null;
  maxPositions: number | null;
  marginMode: string | null;
  minCopyTradeNotionalUSDT?: number;
  minActivationBalanceUSDT?: number;
  warnBalanceUSDT?: number;
  pauseBalanceUSDT?: number;
  minOrderNotionalUSDT?: number;
}

interface OnboardingModalProps {
  onDismiss: () => void;
  riskDisclosureAccepted?: boolean;
}

const REFERRAL_CODE = "59941578";
const REFERRAL_LINK = `https://accounts.binance.com/register?ref=${ REFERRAL_CODE }`;

const STEPS = [
  {
    title: "Log in or Sign Up on Binance",
    body: `Go to binance.com and sign in to your account. If you need a new account, register using referral code ${ REFERRAL_CODE } to ensure fee discounts and full platform eligibility. Ensure Futures trading is enabled.`,
  },
  {
    title: "Open API Management",
    body: 'Click your profile icon (top right) → "API Management". Or go directly to binance.com/en/my/settings/api-management.',
  },
  {
    title: "Create a new API key",
    body: 'Click "Create API". Choose "System generated". Give it a label you\'ll recognize, e.g. "Copy Trading — Follower". Don\'t reuse a key you already use elsewhere.',
  },
  {
    title: "Complete verification",
    body: "Binance will ask for 2FA (email code, phone code, or authenticator app depending on what you have set up). Complete all verification steps it asks for.",
  },
  {
    title: "Set permissions — this step matters",
    body: 'On the key\'s permission screen, enable "Enable Reading" and "Enable Futures". Leave "Enable Spot & Margin Trading" off unless you know you need it. Leave "Enable Withdrawals" OFF — always. This platform never needs withdrawal access, and keys with it enabled are rejected automatically when you submit them.',
    critical: true,
  },
  {
    title: "(Recommended) Restrict to IP access",
    body: 'Binance lets you restrict the key to specific IP addresses for extra safety. This is optional and can make the key stop working if your server\'s IP changes, so skip it if you\'re not sure — "Unrestricted" is fine to start with.',
  },
  {
    title: "Copy your API Key and Secret Key",
    body: "Binance shows the Secret Key only once. Copy both values somewhere safe right now — you'll paste them into this platform on the next screen. If you lose the secret, you'll need to delete the key and create a new one.",
  },
  {
    title: "Paste them into Connect Exchange",
    body: 'Come back here and go to "Connect your exchange". Paste the API Key and Secret Key exactly as copied. We verify the key works and confirm withdrawal permission is off before saving anything.',
  },
];

function formatPercent ( value: number | null | undefined, fallback: string ): string {
  return typeof value === "number" && Number.isFinite( value )
    ? `${ value.toFixed( 1 ) }%`
    : fallback;
}

function fmtUsd ( value: number ): string {
  return `$${ value.toLocaleString( "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  } ) }`;
}

export function OnboardingModal ( { onDismiss, riskDisclosureAccepted = false }: OnboardingModalProps ) {
  const router = useRouter();
  const modalRef = useRef<HTMLDivElement | null>(null);
  const legalModalRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ modalStep, setModalStep ] = useState<"disclaimer" | "instructions">(
    riskDisclosureAccepted ? "instructions" : "disclaimer"
  );
  const [ activeLegalModal, setActiveLegalModal ] = useState<LegalDocType>( null );
  const [ hasAcceptedRisk, setHasAcceptedRisk ] = useState( riskDisclosureAccepted );
  const [ submitting, setSubmitting ] = useState( false );
  const [ dismissing, setDismissing ] = useState( false );
  const [ errorMsg, setErrorMsg ] = useState<string | null>( null );
  const [ copiedCode, setCopiedCode ] = useState( false );
  const [ baseline, setBaseline ] = useState<SystemBaseline | null>( null );
  const [ baselineLoading, setBaselineLoading ] = useState( true );
  const [ baselineError, setBaselineError ] = useState<string | null>( null );
  const minActivationBalanceUSDT = baseline?.minActivationBalanceUSDT ?? baseline?.minCopyTradeNotionalUSDT ?? 300;
  const warnBalanceUSDT = baseline?.warnBalanceUSDT ?? 250;
  const pauseBalanceUSDT = baseline?.pauseBalanceUSDT ?? 150;
  const minOrderNotionalUSDT = baseline?.minOrderNotionalUSDT ?? 25;

  useEffect(() => {
    previouslyFocused.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    modalRef.current?.focus();

    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      previouslyFocused.current?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadBaseline () {
      setBaselineLoading( true );
      setBaselineError( null );
      try {
        const res = await fetch( "/api/saas/system-baseline?days=180", {
          signal: controller.signal,
          cache: "no-store",
        } );
        if ( !res.ok ) throw new Error( "Failed to load baseline" );
        const data = ( await res.json() ) as SystemBaseline;
        setBaseline( data );
      } catch ( error ) {
        if ( error instanceof DOMException && error.name === "AbortError" ) return;
        setBaselineError( "Current baseline unavailable" );
      } finally {
        if ( !controller.signal.aborted ) setBaselineLoading( false );
      }
    }

    void loadBaseline();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const container = activeLegalModal ? legalModalRef.current : modalRef.current;
    container?.focus();
  }, [activeLegalModal]);

  function keepFocusInside(
    event: React.KeyboardEvent<HTMLDivElement>,
    container: HTMLDivElement | null,
    onEscape: () => void
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== "Tab" || !container) return;

    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function copyReferralCode () {
    navigator.clipboard.writeText( REFERRAL_CODE );
    setCopiedCode( true );
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout( () => {
      setCopiedCode( false );
      copiedTimerRef.current = null;
    }, 2000 );
  }

  async function handleAcceptAndContinue () {
    if ( riskDisclosureAccepted ) {
      setModalStep( "instructions" );
      return;
    }

    setSubmitting( true );
    setErrorMsg( null );
    try {
      const res = await fetch( "/api/saas/accept-risk", { method: "POST" } );
      if ( !res.ok ) {
        throw new Error( "Failed to log acceptance" );
      }
      setModalStep( "instructions" );
    } catch {
      setErrorMsg( "Failed to process acknowledgement. Please try again." );
    } finally {
      setSubmitting( false );
    }
  }

  async function handleDismiss ( navigateToConnect: boolean ) {
    setDismissing( true );
    try {
      await fetch( "/api/saas/dismiss-onboarding", { method: "POST" } ).catch( () => { } );
    } finally {
      onDismiss();
      if ( navigateToConnect ) router.push( "/app/connect" );
    }
  }

  const metricCards = [
    {
      label: "Historical Win Rate",
      value: baselineLoading
        ? "Loading..."
        : baseline && baseline.totalTrades > 0
          ? formatPercent( baseline.historicalWinRatePct, "Not enough data" )
          : "Not enough data",
      sub: baselineLoading
        ? "Reading live bot history"
        : baseline
          ? `${ baseline.totalTrades } closed trade${ baseline.totalTrades === 1 ? "" : "s" } over ${ baseline.days } days`
          : baselineError ?? "Live baseline unavailable",
      icon: TrendingUp,
      color: "var(--long)",
    },
    {
      label: "Risk Per Trade",
      value: baselineLoading
        ? "Loading..."
        : formatPercent( baseline?.riskPerTradePct, "Not configured" ),
      sub: baseline?.maxAccountExposurePct
        ? `${ formatPercent( baseline.maxAccountExposurePct, "N/A" ) } max account exposure`
        : baselineLoading
          ? "Reading active bot config"
          : baselineError ?? "Active config unavailable",
      icon: Percent,
      color: "var(--warn)",
    },
    {
      label: "Max Drawdown",
      value: baselineLoading
        ? "Loading..."
        : baseline && baseline.totalTrades > 0
          ? formatPercent( baseline.maxDrawdownPct, "Not enough data" )
          : "Not enough data",
      sub: baseline?.marginMode
        ? `${ baseline.marginMode } margin, ${ baseline.maxPositions ?? "N/A" } max positions`
        : baselineLoading
          ? "Reading live bot history"
          : baselineError ?? "Live baseline unavailable",
      icon: Activity,
      color: "var(--muted)",
    },
  ];

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-title"
          tabIndex={-1}
          onKeyDown={(event) => keepFocusInside(event, modalRef.current, () => void handleDismiss(false))}
          className="w-full max-w-[640px] max-h-[88vh] panel-raised flex flex-col"
        >
          {/* Header */ }
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)] shrink-0">
            <div className="flex items-center gap-2.5">
              { modalStep === "disclaimer" ? (
                <AlertTriangle color="var(--warn)" size={ 18 } />
              ) : (
                <KeyRound color="var(--long)" size={ 18 } />
              ) }
              <span id="onboarding-title" className="font-display font-semibold text-lg">
                { modalStep === "disclaimer" ? "Risk Disclosure & Performance" : "Set up copy trading" }
              </span>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-xs font-mono text-[var(--muted)]">
                Step { modalStep === "disclaimer" ? "1" : "2" } of 2
              </span>
              <button
                onClick={ () => void handleDismiss( false ) }
                disabled={ dismissing || submitting }
                className="text-[var(--muted)] hover:text-[var(--text)] transition-colors disabled:opacity-50"
                aria-label="Close"
              >
                <X size={ 18 } />
              </button>
            </div>
          </div>

          {/* Body */ }
          <div className="overflow-y-auto px-6 py-5 space-y-6">
            { modalStep === "disclaimer" ? (
              <>
                <div>
                  <p className="text-xs font-mono uppercase tracking-wider text-[var(--muted)] mb-3">
                    System Parameters & Historical Baseline
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    { metricCards.map( ( item, i ) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={ i }
                          className="border border-[var(--hairline-bright)] bg-[var(--bg)] p-3 flex flex-col justify-between"
                        >
                          <div className="flex items-center justify-between text-[var(--muted)] mb-1">
                            <span className="text-[11px] font-mono">{ item.label }</span>
                            <Icon size={ 14 } style={ { color: item.color } } />
                          </div>
                          <span className="font-mono text-base font-bold" style={ { color: item.color } }>
                            { item.value }
                          </span>
                          <span className="text-[10px] text-[var(--muted)] mt-1">{ item.sub }</span>
                        </div>
                      );
                    } ) }
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-mono uppercase tracking-wider text-[var(--muted)]">
                    Important Risk Acknowledgements
                  </p>
                  <div className="border border-[var(--hairline-bright)] bg-[var(--bg)] p-4 space-y-3 text-xs leading-relaxed text-[var(--muted)]">
                    <p>
                      <strong className="text-[var(--text)]">1. Financial Loss Risk:</strong> Cryptocurrency futures trading carries high leverage and significant risk. You can lose a substantial portion or all of your allocated trading balance.
                    </p>
                    <p>
                      <strong className="text-[var(--text)]">2. No Guaranteed Returns:</strong> Historical performance, win rates, and backtest projections are provided for informational context only and do not guarantee future profits.
                    </p>
                    <p>
                      <strong className="text-[var(--text)]">3. Execution & Slippage:</strong> Market volatility, API delays, or exchange outage events can lead to trade slippage or failed executions beyond system control.
                    </p>
                    <p>
                      <strong className="text-[var(--text)]">4. Non-Custodial Operation:</strong> Your API key retains zero withdrawal permissions. You maintain full ownership and final control of your exchange funds at all times.
                    </p>
                    <p>
                      <strong className="text-[var(--text)]">5. Balance Policy:</strong> You need at least { fmtUsd( minActivationBalanceUSDT ) } to start copy trading. Normal drawdown below that does not immediately stop trades, but the system may warn below { fmtUsd( warnBalanceUSDT ) } and pause new entries below { fmtUsd( pauseBalanceUSDT ) }.
                    </p>
                  </div>
                </div>

                { errorMsg && (
                  <p role="alert" className="text-xs font-mono text-[var(--warn)]">{ errorMsg }</p>
                ) }

                { !riskDisclosureAccepted && (
                  <label className="flex items-start gap-3 p-3.5 border border-[var(--hairline-bright)] bg-[var(--bg)] cursor-pointer select-none group">
                    <div className="relative flex items-center justify-center shrink-0 w-5 h-5 mt-0.5 border border-[var(--hairline-bright)] group-hover:border-[var(--text)] transition-colors">
                      <input
                        type="checkbox"
                        checked={ hasAcceptedRisk }
                        onChange={ ( e ) => setHasAcceptedRisk( e.target.checked ) }
                        className="sr-only"
                      />
                      { hasAcceptedRisk && (
                        <div className="w-full h-full bg-[var(--text)] flex items-center justify-center">
                          <Check className="text-[var(--bg)] stroke-[3]" size={ 14 } />
                        </div>
                      ) }
                    </div>
                    <span className="text-xs leading-relaxed text-[var(--text)] font-medium">
                      I have read and agree to the{ " " }
                      <button
                        type="button"
                        onClick={ ( e ) => {
                          e.preventDefault();
                          setActiveLegalModal( "risk" );
                        } }
                        className="underline text-[var(--text)] hover:text-[var(--long)] transition-colors inline-button"
                      >
                        Risk Disclosure Statement
                      </button>
                      ,{ " " }
                      <button
                        type="button"
                        onClick={ ( e ) => {
                          e.preventDefault();
                          setActiveLegalModal( "terms" );
                        } }
                        className="underline text-[var(--text)] hover:text-[var(--long)] transition-colors inline-button"
                      >
                        Terms of Service
                      </button>
                      , and{ " " }
                      <button
                        type="button"
                        onClick={ ( e ) => {
                          e.preventDefault();
                          setActiveLegalModal( "privacy" );
                        } }
                        className="underline text-[var(--text)] hover:text-[var(--long)] transition-colors inline-button"
                      >
                        Privacy Policy
                      </button>
                      . I understand that trading involves financial risk and returns are not guaranteed.
                    </span>
                  </label>
                ) }
              </>
            ) : (
              <>
                {/* Referral Banner */ }
                <div className="border border-[var(--hairline-bright)] bg-[var(--bg)] p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] block">
                      Binance Partner Referral
                    </span>
                    <p className="text-xs text-[var(--text)] font-medium mt-0.5">
                      New to Binance? Use code <code className="font-mono font-bold text-[var(--long)]">{ REFERRAL_CODE }</code> when signing up.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={ copyReferralCode }
                      className="flex items-center gap-1.5 border border-[var(--hairline-bright)] px-2.5 py-1.5 text-xs font-mono hover:border-[var(--text)] transition-colors"
                    >
                      { copiedCode ? <Check className="text-[var(--long)]" size={ 13 } /> : <Copy size={ 13 } /> }
                      <span>{ copiedCode ? "Copied" : REFERRAL_CODE }</span>
                    </button>
                    <a
                      href={ REFERRAL_LINK }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 bg-[var(--text)] text-[var(--bg)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--long)] transition-colors"
                    >
                      Sign Up <ExternalLink size={ 12 } />
                    </a>
                  </div>
                </div>

                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  Before trades can be copied to your account, you need to connect a Binance API key. This takes about five minutes. Here&apos;s exactly how:
                </p>

                <div className="flex items-start gap-2 text-xs font-mono text-[var(--warn)] border border-[var(--warn-dim)] bg-[var(--warn-dim)]/10 px-3.5 py-3">
                  <AlertTriangle className="shrink-0 mt-0.5" size={ 14 } />
                  <span>
                    You need at least { fmtUsd( minActivationBalanceUSDT ) } available to turn on copy trading. After that, ordinary losses will not immediately disable you; new entries pause only below { fmtUsd( pauseBalanceUSDT ) }. Individual copied orders below { fmtUsd( minOrderNotionalUSDT ) } may still be skipped to avoid exchange notional errors and fee-heavy executions.
                  </span>
                </div>

                <ol className="space-y-4">
                  { STEPS.map( ( step, i ) => (
                    <li key={ i } className="flex gap-3">
                      <div
                        className="shrink-0 w-6 h-6 flex items-center justify-center font-mono text-[11px] font-semibold mt-0.5"
                        style={ {
                          color: step.critical ? "var(--warn)" : "var(--muted)",
                          border: `1px solid ${ step.critical ? "var(--warn)" : "var(--hairline-bright)" }`,
                        } }
                      >
                        { i + 1 }
                      </div>
                      <div>
                        <p
                          className="text-sm font-semibold mb-1"
                          style={ { color: step.critical ? "var(--warn)" : "var(--text)" } }
                        >
                          { step.title }
                        </p>
                        <p className="text-xs text-[var(--muted)] leading-relaxed">{ step.body }</p>
                      </div>
                    </li>
                  ) ) }
                </ol>

                <div className="flex items-start gap-2 text-xs font-mono text-[var(--long)] border border-[var(--long-dim)] bg-[var(--long-dim)]/10 px-3.5 py-3">
                  <ShieldCheck className="shrink-0 mt-0.5" size={ 14 } />
                  <span>
                    Your key is verified against Binance directly and encrypted before storage. It&apos;s never shown again after you submit it, and any key with withdrawal permission is rejected automatically — this platform can never move your funds out of your account.
                  </span>
                </div>
              </>
            ) }
          </div>

          {/* Footer Controls */ }
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--hairline)] shrink-0">
            <button
              onClick={ () => {
                if ( modalStep === "instructions" ) {
                  setModalStep( "disclaimer" );
                } else {
                  void handleDismiss( false );
                }
              } }
              disabled={ dismissing || submitting }
              className="text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] transition-colors disabled:opacity-50"
            >
              { modalStep === "instructions" ? "← Back to Disclaimer" : "Do this later" }
            </button>

            { modalStep === "disclaimer" ? (
              <button
                onClick={ () => void handleAcceptAndContinue() }
                disabled={ !hasAcceptedRisk || submitting || dismissing }
                className="flex items-center gap-2 bg-[var(--text)] text-[var(--bg)] font-display font-semibold text-sm
                           px-4 py-2.5 hover:bg-[var(--long)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                { submitting ? (
                  <>
                    <Loader2 className="animate-spin" size={ 15 } />
                    Logging Acceptance...
                  </>
                ) : riskDisclosureAccepted ? (
                  <>
                    Continue
                    <ArrowRight size={ 15 } />
                  </>
                ) : (
                  <>
                    I Accept & Continue
                    <ArrowRight size={ 15 } />
                  </>
                ) }
              </button>
            ) : (
              <button
                onClick={ () => void handleDismiss( true ) }
                disabled={ dismissing }
                className="flex items-center gap-2 bg-[var(--text)] text-[var(--bg)] font-display font-semibold text-sm
                           px-4 py-2.5 hover:bg-[var(--long)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Connect my exchange
                <ArrowRight size={ 15 } />
              </button>
            ) }
          </div>
        </div>
      </div>

      {/* Nested Legal Overlay Modal */ }
      { activeLegalModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div
            ref={legalModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-modal-title"
            tabIndex={-1}
            onKeyDown={(event) => keepFocusInside(event, legalModalRef.current, () => setActiveLegalModal(null))}
            className="w-full max-w-[540px] max-h-[75vh] panel-raised flex flex-col border border-[var(--hairline-bright)] shadow-2xl"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)] shrink-0 bg-[var(--bg)]">
              <div className="flex items-center gap-2.5">
                <FileText className="text-[var(--long)]" size={ 16 } />
                <span id="legal-modal-title" className="font-display font-semibold text-base">
                  { LEGAL_DOCS[ activeLegalModal ].title }
                </span>
              </div>
              <button
                onClick={ () => setActiveLegalModal( null ) }
                className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                aria-label="Close legal document"
              >
                <X size={ 18 } />
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5 bg-[var(--bg)]">
              <div className="mb-4 text-[10px] font-mono text-[var(--muted)] border-b border-[var(--hairline)] pb-2">
                Document Version: { LEGAL_DOCS[ activeLegalModal ].version }
              </div>

              <div className="space-y-4 text-xs leading-relaxed text-[var(--muted)]">
                { LEGAL_DOCS[ activeLegalModal ].sections.map( ( section, idx ) => (
                  <p key={ idx }>
                    <strong className="text-[var(--text)]">{ section.heading }: </strong>
                    { section.text }
                  </p>
                ) ) }
              </div>
            </div>

            <div className="flex items-center justify-end px-6 py-3.5 border-t border-[var(--hairline)] shrink-0 bg-[var(--bg)]">
              <button
                onClick={ () => setActiveLegalModal( null ) }
                className="bg-[var(--text)] text-[var(--bg)] font-display font-semibold text-xs px-4 py-2 hover:bg-[var(--long)] transition-colors"
              >
                Close Document
              </button>
            </div>
          </div>
        </div>
      ) }
    </>
  );
}

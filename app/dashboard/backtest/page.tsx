"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2, TriangleAlert, CheckCircle2, XCircle } from "lucide-react";
import { OperatorHeader } from "@/components/OperatorHeader";
import { loadSession, type Session } from "@/lib/session";
import {
  startBacktest,
  fetchBacktestJob,
  fetchRecentBacktestJobs,
  ApiError,
} from "@/lib/api";
import type { BacktestJob, StrategyOverrides } from "@/lib/types";

const POLL_MS = 2500;

const DEFAULT_PARAMS = {
  symbol: "BOME/USDT",
  candles: 10000,
  timeframe: "1h",
};
const DEFAULT_OVERRIDES: Required<Pick<
  StrategyOverrides,
  "stPeriod" | "stMult" | "exitMode" | "tp1Pct" | "tp2Pct" | "tp3Pct" | "adxMin"
>> = {
  stPeriod: 7,
  stMult: 2,
  exitMode: "fixed_tp",
  tp1Pct: 1.018,
  tp2Pct: 1.04,
  tp3Pct: 1.075,
  adxMin: 20,
};

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    stPeriod: "SuperTrend ATR period",
    stMult: "SuperTrend ATR multiplier",
    adxMin: "Min ADX (trend strength)",
    tp1Pct: "TP1 multiplier (e.g. 1.018 = 1.8%)",
    tp2Pct: "TP2 multiplier",
    tp3Pct: "TP3 multiplier",
  };
  return labels[key] ?? key;
}

function formatCandleDuration(candles: number, timeframe: string): string {
  if (!candles || candles <= 0) return "—";

  const hoursMap: Record<string, number> = {
    "15m": 0.25,
    "1h": 1,
    "4h": 4,
  };

  // Default to 1 hour if timeframe isn't found
  const totalHours = candles * (hoursMap[timeframe] || 1);
  const totalDays = totalHours / 24;

  if (totalDays < 14) return `~${Math.round(totalDays)} days`;
  if (totalDays < 60) return `~${(totalDays / 7).toFixed(1)} weeks`;
  if (totalDays < 365) return `~${(totalDays / 30.44).toFixed(1)} months`;
  
  return `~${(totalDays / 365.25).toFixed(1)} years`;
}

export default function BacktestPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  const [symbol, setSymbol] = useState(DEFAULT_PARAMS.symbol);
  const [candles, setCandles] = useState(DEFAULT_PARAMS.candles);
  const [timeframe, setTimeframe] = useState(DEFAULT_PARAMS.timeframe);
  const [exitMode, setExitMode] = useState<"fixed_tp" | "st_flip">(DEFAULT_OVERRIDES.exitMode);
  const [stPeriod, setStPeriod] = useState(DEFAULT_OVERRIDES.stPeriod);
  const [stMult, setStMult] = useState(DEFAULT_OVERRIDES.stMult);
  const [adxMin, setAdxMin] = useState(DEFAULT_OVERRIDES.adxMin);
  const [tp1Pct, setTp1Pct] = useState(DEFAULT_OVERRIDES.tp1Pct);
  const [tp2Pct, setTp2Pct] = useState(DEFAULT_OVERRIDES.tp2Pct);
  const [tp3Pct, setTp3Pct] = useState(DEFAULT_OVERRIDES.tp3Pct);

  const [job, setJob] = useState<BacktestJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<BacktestJob[]>([]);
  const [starting, setStarting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const existing = loadSession();
    if (!existing) {
      router.replace("/setup");
      return;
    }
    setSession(existing);
  }, [router]);

  const loadRecent = useCallback(() => {
    if (!session) return;
    fetchRecentBacktestJobs(session, 10)
      .then(setRecentJobs)
      .catch(() => {});
  }, [session]);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const pollJob = useCallback(
    (jobId: string) => {
      if (!session) return;
      stopPolling();
      pollTimer.current = setInterval(() => {
        fetchBacktestJob(session, jobId)
          .then((updated) => {
            setJob(updated);
            if (updated.status === "completed" || updated.status === "failed") {
              stopPolling();
              loadRecent();
            }
          })
          .catch(() => {
            stopPolling();
          });
      }, POLL_MS);
    },
    [session, stopPolling, loadRecent]
  );

  useEffect(() => stopPolling, [stopPolling]);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setFormError(null);

    if (!symbol.trim()) {
      setFormError("Symbol is required.");
      return;
    }

    setStarting(true);
    try {
      const overrides: StrategyOverrides = {
        exitMode,
        stPeriod,
        stMult,
        adxMin,
        ...(exitMode === "fixed_tp" ? { tp1Pct, tp2Pct, tp3Pct } : {}),
      };

      const result = await startBacktest(session, {
        symbol: symbol.trim(),
        candles,
        timeframe,
        overrides,
      });

      if (!result.started) {
        setFormError(result.reason);
        return;
      }

      setJob({
        id: result.jobId,
        status: "queued",
        params: { symbol: symbol.trim(), candles, timeframe, overrides },
        startedAt: new Date().toISOString(),
        finishedAt: null,
        result: null,
        error: null,
      });
      pollJob(result.jobId);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to start backtest.");
    } finally {
      setStarting(false);
    }
  }

  if (!session) return null;

  const isRunning = job?.status === "queued" || job?.status === "running";

  return (
    <main className="min-h-screen flex flex-col">
      <OperatorHeader
        status={ <span className="eyebrow">Backtest lab</span> }
      />

      <div className="flex-1 p-6">
        <div className="max-w-[1100px] mx-auto space-y-6">
          <div className="flex items-start gap-2 text-xs font-mono text-[var(--warn)] border border-[var(--warn)]/40 bg-[var(--warn)]/5 px-3 py-2.5">
            <TriangleAlert size={14} className="shrink-0 mt-0.5" />
            <span>
              Backtests run inside the bot&apos;s own process, on the same
              event loop as live trading — only one can run at a time, and
              a run can take anywhere from several seconds to a couple of
              minutes depending on candle count. Avoid running one during
              volatile market conditions if you want live execution
              unaffected.
            </span>
          </div>

          <form onSubmit={handleStart} className="panel p-5 space-y-5">
            <span className="eyebrow">Parameters</span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="bt-symbol" className="eyebrow block mb-1.5">Symbol</label>
                <input
                  id="bt-symbol"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="BOME/USDT"
                  className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3 py-2 text-sm font-mono
                             focus:outline-none focus:border-[var(--long)] transition-colors"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="bt-candles" className="eyebrow block">Candles</label>
                  <span className="text-[10px] font-mono text-[var(--muted)]">
                    {formatCandleDuration(candles, timeframe)}
                  </span>
                </div>
                <input
                  id="bt-candles"
                  type="number"
                  value={candles}
                  onChange={(e) => setCandles(Number(e.target.value))}
                  min={250}
                  max={20000}
                  className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3 py-2 text-sm font-mono tabular
                             focus:outline-none focus:border-[var(--long)] transition-colors"
                />
              </div>
              <div>
                <label htmlFor="bt-timeframe" className="eyebrow block mb-1.5">Timeframe</label>
                <select
                  id="bt-timeframe"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3 py-2 text-sm font-mono
                             focus:outline-none focus:border-[var(--long)] transition-colors"
                >
                  <option value="15m">15m</option>
                  <option value="1h">1h</option>
                  <option value="4h">4h</option>
                </select>
              </div>
            </div>

            <div className="border-t border-[var(--hairline)] pt-4 space-y-4">
              <span className="eyebrow">Strategy overrides</span>

              <div>
                <label className="eyebrow block mb-1.5">Exit mode</label>
                <div className="flex items-center gap-1 panel p-1 w-fit">
                  {(["fixed_tp", "st_flip"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setExitMode(m)}
                      className="px-3 py-1.5 text-xs font-mono transition-colors"
                      style={{
                        background: exitMode === m ? "var(--panel-raised)" : "transparent",
                        color: exitMode === m ? "var(--text)" : "var(--muted)",
                      }}
                    >
                      {m === "fixed_tp" ? "Fixed TP" : "SuperTrend flip"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="bt-stPeriod" className="eyebrow block mb-1.5">{fieldLabel("stPeriod")}</label>
                  <input
                    id="bt-stPeriod"
                    type="number"
                    value={stPeriod}
                    onChange={(e) => setStPeriod(Number(e.target.value))}
                    step={1}
                    className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3 py-2 text-sm font-mono tabular
                               focus:outline-none focus:border-[var(--long)] transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="bt-stMult" className="eyebrow block mb-1.5">{fieldLabel("stMult")}</label>
                  <input
                    id="bt-stMult"
                    type="number"
                    value={stMult}
                    onChange={(e) => setStMult(Number(e.target.value))}
                    step={0.1}
                    className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3 py-2 text-sm font-mono tabular
                               focus:outline-none focus:border-[var(--long)] transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="bt-adxMin" className="eyebrow block mb-1.5">{fieldLabel("adxMin")}</label>
                  <input
                    id="bt-adxMin"
                    type="number"
                    value={adxMin}
                    onChange={(e) => setAdxMin(Number(e.target.value))}
                    step={1}
                    className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3 py-2 text-sm font-mono tabular
                               focus:outline-none focus:border-[var(--long)] transition-colors"
                  />
                </div>
              </div>

              {exitMode === "fixed_tp" && (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="bt-tp1Pct" className="eyebrow block mb-1.5">{fieldLabel("tp1Pct")}</label>
                    <input
                      id="bt-tp1Pct"
                      type="number"
                      value={tp1Pct}
                      onChange={(e) => setTp1Pct(Number(e.target.value))}
                      step={0.001}
                      className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3 py-2 text-sm font-mono tabular
                                 focus:outline-none focus:border-[var(--long)] transition-colors"
                    />
                  </div>
                  <div>
                    <label htmlFor="bt-tp2Pct" className="eyebrow block mb-1.5">{fieldLabel("tp2Pct")}</label>
                    <input
                      id="bt-tp2Pct"
                      type="number"
                      value={tp2Pct}
                      onChange={(e) => setTp2Pct(Number(e.target.value))}
                      step={0.001}
                      className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3 py-2 text-sm font-mono tabular
                                 focus:outline-none focus:border-[var(--long)] transition-colors"
                    />
                  </div>
                  <div>
                    <label htmlFor="bt-tp3Pct" className="eyebrow block mb-1.5">{fieldLabel("tp3Pct")}</label>
                    <input
                      id="bt-tp3Pct"
                      type="number"
                      value={tp3Pct}
                      onChange={(e) => setTp3Pct(Number(e.target.value))}
                      step={0.001}
                      className="w-full bg-[var(--panel)] border border-[var(--hairline)] px-3 py-2 text-sm font-mono tabular
                                 focus:outline-none focus:border-[var(--long)] transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>

            {formError && (
              <div className="text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={starting || isRunning}
              className="flex items-center gap-2 bg-[var(--text)] text-[var(--bg)] font-display font-semibold text-sm
                         px-4 py-2.5 hover:bg-[var(--long)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {starting || isRunning ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Play size={15} />
              )}
              {isRunning ? "Running…" : starting ? "Starting…" : "Run backtest"}
            </button>
          </form>

          {job && (
            <div className="panel p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="eyebrow">
                  {job.params.symbol} · {job.params.timeframe} · {job.params.candles} candles
                </span>
                <StatusPill status={job.status} />
              </div>

              {isRunning && (
                <p className="text-xs font-mono text-[var(--muted)]">
                  Fetching candles and simulating normal + stressed friction
                  runs — this page updates automatically.
                </p>
              )}

              {job.status === "failed" && (
                <p className="text-sm font-mono text-[var(--short)]">
                  {job.error ?? "Backtest failed."}
                </p>
              )}

              {job.status === "completed" && job.result && (
                <ResultView result={job.result} />
              )}
            </div>
          )}

          {recentJobs.length > 0 && (
            <div className="panel overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--hairline)]">
                <span className="eyebrow">Recent runs</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--hairline)]">
                      {["Symbol", "Started", "Status", "Win Rate", "Net Profit", "Live Ready"].map(
                        (h) => (
                          <th
                            key={h}
                            className="eyebrow text-left px-4 py-2.5 font-normal whitespace-nowrap"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {recentJobs.map((j) => (
                      <tr
                        key={j.id}
                        className="border-b border-[var(--hairline)] last:border-b-0 hover:bg-[var(--panel-raised)] transition-colors cursor-pointer"
                        onClick={() => setJob(j)}
                      >
                        <td className="px-4 py-2.5 font-semibold whitespace-nowrap">
                          {j.params.symbol}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--muted)] whitespace-nowrap">
                          {new Date(j.startedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusPill status={j.status} />
                        </td>
                        <td className="px-4 py-2.5 tabular">
                          {j.result?.winRate ?? "—"}
                        </td>
                        <td
                          className="px-4 py-2.5 tabular font-semibold"
                          style={{
                            color:
                              j.result && parseFloat(j.result.netProfit) >= 0
                                ? "var(--long)"
                                : "var(--short)",
                          }}
                        >
                          {j.result ? `${j.result.netProfit}%` : "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {j.result ? (
                            j.result.isLiveReady ? (
                              <CheckCircle2 size={14} color="var(--long)" />
                            ) : (
                              <XCircle size={14} color="var(--short)" />
                            )
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "completed"
      ? "var(--long)"
      : status === "failed"
        ? "var(--short)"
        : "var(--warn)";
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 uppercase"
      style={{ color, border: `1px solid ${color}` }}
    >
      {status}
    </span>
  );
}

function ResultView({ result }: { result: NonNullable<BacktestJob["result"]> }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {result.isLiveReady ? (
          <CheckCircle2 size={16} color="var(--long)" />
        ) : (
          <XCircle size={16} color="var(--short)" />
        )}
        <span
          className="font-mono text-sm font-semibold"
          style={{ color: result.isLiveReady ? "var(--long)" : "var(--short)" }}
        >
          {result.isLiveReady ? "Passes live-ready thresholds" : "Does not pass live-ready thresholds"}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[var(--hairline)]">
        {[
          { label: "Total Trades", value: String(result.totalTrades) },
          { label: "Win Rate", value: result.winRate },
          { label: "Net Profit", value: `${result.netProfit}%` },
          { label: "Max Drawdown", value: `${result.maxDD}%` },
        ].map((tile) => (
          <div key={tile.label} className="panel p-4">
            <span className="eyebrow block mb-1">{tile.label}</span>
            <span className="font-display font-semibold text-xl tabular">{tile.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="border border-[var(--hairline)] p-4">
          <span className="eyebrow block mb-2">Normal friction</span>
          <dl className="space-y-1 font-mono text-xs">
            <Row label="Profit" value={`${result.normal.profit}%`} />
            <Row label="Win rate" value={result.normal.winRate} />
            <Row label="Trades" value={String(result.normal.trades)} />
            <Row label="Max DD" value={`${result.normal.maxDD}%`} />
          </dl>
        </div>
        <div className="border border-[var(--hairline)] p-4">
          <span className="eyebrow block mb-2">Stressed friction</span>
          <dl className="space-y-1 font-mono text-xs">
            <Row label="Profit" value={`${result.stress.profit}%`} />
            <Row label="Win rate" value={result.stress.winRate} />
            <Row label="Trades" value={String(result.stress.trades)} />
            <Row label="Max DD" value={`${result.stress.maxDD}%`} />
          </dl>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
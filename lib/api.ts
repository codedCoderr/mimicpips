import type {
  DashboardSnapshot,
  LedgerResult,
  LedgerSummaryRow,
  RecentTradeRow,
  PerformanceSummary,
  BacktestJob,
  BacktestJobParams,
} from "./types";
import type { Session } from "./session";
import { markBotSessionExpired } from "./session";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(
  session: Session,
  path: string,
  init?: RequestInit
): Promise<T> {
  void session;
  const url = `/api/operator/bot${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      "Could not reach the bot. Check the server address and that it's running.",
      0
    );
  }

  if (res.status === 401) {
    markBotSessionExpired();
    throw new ApiError("Bot connection expired. Reconnect the bot to continue.", 401);
  }
  if (!res.ok) {
    throw new ApiError(`Request failed (${res.status}).`, res.status);
  }
  return res.json();
}

export function fetchSnapshot(session: Session): Promise<DashboardSnapshot> {
  return call<DashboardSnapshot>(session, "/api/snapshot");
}

export function triggerKillSwitch(session: Session) {
  return call(session, "/api/emergency/kill-switch", { method: "POST" });
}

export function pauseTrading(session: Session) {
  return call(session, "/api/trading/pause", { method: "POST" });
}

export function resumeTrading(session: Session) {
  return call(session, "/api/trading/resume", { method: "POST" });
}

export interface ClosePositionResult {
  closed: boolean;
  symbol: string;
  exitPrice?: number;
  pnl?: number;
  reason?: string;
}

/**
 * Closes a single position at market price. The bot returns 409 (not 2xx)
 * when the close didn't go through — e.g. the position was already flat,
 * or an operation was already in progress for that symbol — with a
 * `reason` explaining why. That's a normal, expected outcome here, not a
 * network/auth failure, so it's returned rather than thrown.
 */
export async function closePosition(
  session: Session,
  symbol: string
): Promise<ClosePositionResult> {
  const url = "/api/operator/bot/api/positions/close";
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ symbol }),
    });
  } catch {
    throw new ApiError(
      "Could not reach the bot. Check the server address and that it's running.",
      0
    );
  }

  if (res.status === 401) {
    markBotSessionExpired();
    throw new ApiError("Bot connection expired. Reconnect the bot to continue.", 401);
  }
  if (res.status === 429) {
    throw new ApiError("Too many requests — slow down and try again.", 429);
  }
  if (!res.ok && res.status !== 409) {
    throw new ApiError(`Request failed (${res.status}).`, res.status);
  }

  return res.json();
}

export function checkHealth(session: Session): Promise<{ ok: boolean }> {
  return call(session, "/api/health");
}

export function fetchLedger(session: Session, days: number): Promise<LedgerResult> {
  return call<LedgerResult>(session, `/api/ledger?days=${days}&format=json`);
}

export interface LedgerSummaryResponse {
  summary: LedgerSummaryRow[];
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  feeDataWarning: string | null;
}

export function fetchLedgerSummary(
  session: Session,
  days: number,
  by: "month" | "symbol"
): Promise<LedgerSummaryResponse> {
  return call<LedgerSummaryResponse>(
    session,
    `/api/ledger/summary?days=${days}&by=${by}&format=json`
  );
}

/**
 * Downloads a CSV export through the same-origin bot proxy and triggers a
 * browser save via a temporary object URL.
 */
async function downloadCsv(
  session: Session,
  path: string,
  filename: string
): Promise<void> {
  const url = `/api/operator/bot${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {},
    });
  } catch {
    throw new ApiError(
      "Could not reach the bot. Check the server address and that it's running.",
      0
    );
  }

  if (res.status === 401) {
    markBotSessionExpired();
    throw new ApiError("Bot connection expired. Reconnect the bot to continue.", 401);
  }
  if (!res.ok) throw new ApiError(`Request failed (${res.status}).`, res.status);

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

export function downloadLedgerCsv(session: Session, days: number): Promise<void> {
  return downloadCsv(
    session,
    `/api/ledger?days=${days}&format=csv`,
    `ledger_${days}d.csv`
  );
}

export function downloadLedgerSummaryCsv(
  session: Session,
  days: number,
  by: "month" | "symbol"
): Promise<void> {
  return downloadCsv(
    session,
    `/api/ledger/summary?days=${days}&by=${by}&format=csv`,
    `ledger_summary_${by}_${days}d.csv`
  );
}

export interface RecentTradesPage {
  trades: RecentTradeRow[];
  hasMore: boolean;
}

export async function fetchRecentTrades(
  session: Session,
  limit: number = 10,
  offset: number = 0
): Promise<RecentTradesPage> {
  return call<RecentTradesPage>(
    session,
    `/api/trades/recent?limit=${limit}&offset=${offset}`
  );
}

export function fetchPerformanceSummary(
  session: Session,
  days: number = 30
): Promise<PerformanceSummary> {
  return call<PerformanceSummary>(session, `/api/performance/summary?days=${days}`);
}

/**
 * Starts a backtest job. The bot returns 409 (not thrown as a generic
 * error) when a backtest is already running, with a human-readable
 * `reason` — surfaced directly rather than a generic "request failed".
 */
export async function startBacktest(
  session: Session,
  params: BacktestJobParams
): Promise<{ started: true; jobId: string } | { started: false; reason: string }> {
  const url = "/api/operator/bot/api/backtest/run";
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
  } catch {
    throw new ApiError(
      "Could not reach the bot. Check the server address and that it's running.",
      0
    );
  }

  if (res.status === 401) {
    markBotSessionExpired();
    throw new ApiError("Bot connection expired. Reconnect the bot to continue.", 401);
  }
  if (res.status === 400) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data?.error ?? "Invalid backtest parameters.", 400);
  }
  if (res.status === 429) {
    throw new ApiError("Too many requests — slow down and try again.", 429);
  }
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    return { started: false, reason: data?.error ?? "A backtest is already running." };
  }
  if (!res.ok) throw new ApiError(`Request failed (${res.status}).`, res.status);

  const data = await res.json();
  return { started: true, jobId: data.jobId };
}

export function fetchBacktestJob(session: Session, jobId: string): Promise<BacktestJob> {
  return call<BacktestJob>(session, `/api/backtest/job/${encodeURIComponent(jobId)}`);
}

export async function fetchActiveBacktestJob(session: Session): Promise<BacktestJob | null> {
  const result = await call<{ job: BacktestJob | null }>(session, "/api/backtest/active");
  return result.job;
}

export async function fetchRecentBacktestJobs(
  session: Session,
  limit: number = 10
): Promise<BacktestJob[]> {
  const result = await call<{ jobs: BacktestJob[] }>(
    session,
    `/api/backtest/recent?limit=${limit}`
  );
  return result.jobs;
}

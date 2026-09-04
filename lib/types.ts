export interface DashboardPosition {
  symbol: string;
  fullSymbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  amount: number;
  notional: number;
  leverage: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  liquidationPrice: number;
  liquidationDistancePct: number;
  marginUsed: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  openedAt: string;
  takeProfits?: { tp1: number; tp2: number; tp3: number };
  tp1Filled: boolean;
  tp2Filled: boolean;
  tp1PriceReached?: boolean;
  tp2PriceReached?: boolean;
  tpStatus: "TP1 HIT" | "TP2 HIT" | null;
  tpWarning?: string | null;
}

export interface TelegramStatus {
  state: string;
  lastError: string;
  lastAttemptAt: string | null;
  launchTimeoutMs: number;
  launchGraceMs: number;
  retryMs: number;
  botUsername: string;
  online: boolean;
}

export interface HealthCheckEntry {
  status: "ok" | "error";
  latency?: number;
  error?: string;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: {
    api: HealthCheckEntry;
    state: HealthCheckEntry;
    disk: HealthCheckEntry;
  };
  uptime: number;
  memory: { used: number; total: number; percentage: number };
}

export interface RiskStatus {
  killSwitch: boolean;
  dailyLimit: boolean;
  tradingPaused: boolean;
  tradingHalted:boolean;
  drawdownPct: number;
  peakBalance: number;
  currentWalletBalance: number;
}

export interface DashboardSnapshot {
  timestamp: string;
  tradingMode: string;
  systemStatus: "ACTIVE" | "PAUSED" | "HALTED";
  telegram: TelegramStatus;
  health: HealthStatus;
  risk: RiskStatus;
  account: {
    totalBalance: number;
    availableBalance: number;
    startingBalance: number;
    accountReturnPct: number;
    unrealizedPnl: number;
    marginUsed: number;
    marginUsagePct: number;
    effectiveLeverage: number;
    openPositions: number;
    maxPositions: number;
  };
  positions: DashboardPosition[];
}

export type BotEventType =
  | "position.opened"
  | "position.closed"
  | "position.updated"
  | "order.placed"
  | "order.filled"
  | "margin.warning"
  | "risk.updated"
  | "system.halted"
  | "system.resumed"
  | "notification"
  | "health.updated"
  | "snapshot.updated";

export interface BotEvent<T = unknown> {
  type: BotEventType;
  timestamp: number;
  payload: T;
}

export interface EquityPoint {
  t: number;
  balance: number;
}

export interface LedgerRow {
  id: string;
  symbol: string;
  side: string;
  entryTime: string;
  exitTime: string;
  closedAt?: string;
  holdDuration: string;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  leverage: number;
  grossPnl: number;
  tradingFees: number | null;
  fundingFees: number | null;
  netPnl: number | null;
  feesIncluded: boolean;
  closeReason: string;
  market: string;
}

export interface LedgerSummaryRow {
  period: string;
  trades: number;
  grossPnl: number;
  tradingFees: number;
  fundingFees: number;
  netPnl: number;
  incompleteRows: number;
}

export interface LedgerResult {
  rows: LedgerRow[];
  byMonth: LedgerSummaryRow[];
  bySymbol: LedgerSummaryRow[];
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  feeDataWarning: string | null;
}

export interface RecentTradeRow {
  id: string;
  symbol: string;
  side: string;
  entryTime: string;
  exitTime: string;
  holdDuration: string;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  leverage: number;
  pnl: number;
  closeReason: string;
}

export interface PerformanceSummary {
  totalTrades: number;
  winRate: string;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: string;
  netPnL: number;
  avgRR: number | null;
  days: number;
}

export interface StrategyOverrides {
  stPeriod?: number;
  stMult?: number;
  ema200Filter?: boolean;
  emaGapMinPct?: number;
  exitMode?: "fixed_tp" | "st_flip";
  tp1Pct?: number;
  tp2Pct?: number;
  tp3Pct?: number;
  adxMin?: number;
  macdConfirm?: boolean;
  rsiLongMin?: number;
  rsiLongMax?: number;
  rsiShortMin?: number;
  rsiShortMax?: number;
}

export interface BacktestSideResult {
  profit: string;
  winRate: string;
  trades: number;
  wins: number;
  losses: number;
  maxDD: string;
  [key: string]: unknown;
}

export interface BacktestResult {
  symbol: string;
  timeframe: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: string;
  normal: BacktestSideResult;
  stress: BacktestSideResult;
  netProfit: string;
  maxDD: string;
  isLiveReady: boolean;
}

export type BacktestJobStatus = "queued" | "running" | "completed" | "failed";

export interface BacktestJobParams {
  symbol: string;
  candles?: number;
  timeframe?: string;
  overrides?: StrategyOverrides;
}

export interface BacktestJob {
  id: string;
  status: BacktestJobStatus;
  params: BacktestJobParams;
  startedAt: string;
  finishedAt: string | null;
  result: BacktestResult | null;
  error: string | null;
}

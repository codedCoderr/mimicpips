/**
 * Pure display-logic helpers for the copy-trade log API. Extracted from
 * route.ts so they can be unit tested directly (a Next.js route handler
 * cannot be imported and exercised the same way).
 */
import type { CopyTradeLogDoc, CopyTradeLogStatus } from "@/lib/saasTypes";
import type { Document } from "mongodb";
import { calculateDirectionalPnl } from "@/lib/pnlMath";

export type CopyTradeLogResponseDoc = CopyTradeLogDoc & {
  symbol?: string;
  side?: "LONG" | "SHORT";
  entryPrice?: number;
  markPrice?: number | null;
  exitPrice?: number;
  stopLossPrice?: number | null;
  stopLossType?: "ATR" | "manual" | "unknown" | null;
  atrPeriod?: number | null;
  atrMultiplier?: number | null;
  marginAllocated?: number;
  realizedPnl?: number;
  roiPercentage?: number;
  roi?: number;
  pnl?: number;
  status?: CopyTradeLogStatus | "SUCCESS";
  executedAt?: Date;
};

export const BOT_TRADES_COLLECTION = "futures_history";

export function toBinanceSymbol(symbol: string): string {
  return symbol.replace(":USDT", "").replace("/", "");
}

export async function fetchBinanceFuturesPrice(symbol: string): Promise<number | null> {
  const marketSymbol = toBinanceSymbol(symbol);
  if (!/^[A-Z0-9]+USDT$/.test(marketSymbol)) return null;

  const baseUrl =
    process.env.TRADING_MODE === "LIVE"
      ? "https://fapi.binance.com"
      : "https://demo-fapi.binance.com";

  const response = await fetch(`${baseUrl}/fapi/v1/ticker/price?symbol=${marketSymbol}`, {
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;

  const data = await response.json().catch(() => null) as { price?: string } | null;
  const price = Number(data?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function calculateUnrealizedPnl(entry: CopyTradeLogResponseDoc, markPrice: number | null): {
  pnl: number;
  roi: number;
} {
  const entryPrice = Number(entry.entryPrice ?? 0);
  const notional = Number(entry.followerNotional ?? entry.marginAllocated ?? 0);
  if (
    entry.action !== "OPEN" ||
    entry.status !== "executed" ||
    !markPrice ||
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(notional) ||
    notional <= 0
  ) {
    return {
      pnl: Number(entry.realizedPnl ?? entry.pnl ?? 0) || 0,
      roi: Number(entry.roiPercentage ?? entry.roi ?? 0) || 0,
    };
  }

  const direction = entry.leaderSide === "SHORT" || entry.side === "SHORT" ? -1 : 1;
  const pnl = ((markPrice - entryPrice) / entryPrice) * notional * direction;
  return {
    pnl,
    roi: (pnl / notional) * 100,
  };
}

export function calculateClosedPnlFromPrices(
  entry: CopyTradeLogResponseDoc,
  entryPrice: number,
  exitPrice: number,
  notional: number
): { pnl: number; roi: number } | null {
  if (entry.action !== "CLOSE") return null;

  // entry.side is a different, optional field on the wider response shape
  // (populated by an unrelated futures-history display path) — kept as a
  // fallback here in case a caller ever passes a row where leaderSide is
  // absent but side is set; leaderSide is checked first since it is the
  // field this collection actually stores.
  const side = entry.leaderSide === "SHORT" || entry.side === "SHORT" ? "SHORT" : "LONG";
  return calculateDirectionalPnl(entryPrice, exitPrice, notional, side);
}

function readPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

export function leaderHistoryPrices(doc: Document | undefined): {
  entryPrice: number | null;
  exitPrice: number | null;
} {
  if (!doc) {
    return {
      entryPrice: null,
      exitPrice: null,
    };
  }

  return {
    entryPrice: readPositiveNumber(doc.entryPrice, doc.avgEntryPrice),
    exitPrice: readPositiveNumber(doc.exitPrice, doc.stopLossHitPrice, doc.stopLoss, doc.avgExitPrice),
  };
}

export function userFacingCopyTradeDetail(status: string, detail: string | null | undefined): string | null {
  if (!detail) return null;
  const lower = detail.toLowerCase();

  if (lower.includes("request timed out") || lower.includes("fetch failed") || lower.includes("econnreset")) {
    return "Binance demo did not respond in time. The system will retry automatically when the connection is stable.";
  }
  if (
    lower.includes("invalid api-key") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid api-key id") ||
    lower.includes("api-key") ||
    lower.includes("apikey") ||
    lower.includes("authentication") ||
    lower.includes("credential") ||
    lower.includes("permission")
  ) {
    return "Your Binance Futures API key could not be used. Reconnect a valid key with Futures permission enabled and withdrawals disabled.";
  }
  if (lower.includes("already flat") || lower.includes("no matching follower position is open")) {
    return "Follower position is already closed.";
  }
  if (status.startsWith("skipped_")) {
    return detail.replace(/^skipped[_\s-]*/i, "");
  }
  return detail.length > 140 ? `${detail.slice(0, 137)}...` : detail;
}

export function isAlreadyClosedDetail(detail: string | null | undefined): boolean {
  if (!detail) return false;
  const lower = detail.toLowerCase();
  return lower.includes("already flat") ||
    lower.includes("already closed") ||
    lower.includes("no matching follower position is open");
}

/**
 * True only for the ONE known case where a CLOSE row is legitimately
 * marked "failed" despite the position actually being closed on the
 * exchange: PnL could not be computed/recorded at write time, but the
 * order itself went through. This must NOT match a genuine close failure
 * (unreadable positions, a rejected order, a revoked key, "not verified",
 * etc.) — those leave the follower's position untouched or in an unknown
 * state, and showing them as "Closed" would hide exactly the case
 * reconciliation exists to catch. If in doubt, this returns false: an
 * unresolved "Needs attention" row is the safe failure mode, a silently
 * hidden live position is not.
 */
export function isPnlOnlyCloseFailure(detail: string | null | undefined): boolean {
  if (!detail) return false;
  return detail.toLowerCase().includes("pnl not recorded");
}

export function isResolvedStaleOpenDetail(detail: string | null | undefined): boolean {
  return !!detail?.toLowerCase().includes("reconciliation marked this stale open claim as failed");
}


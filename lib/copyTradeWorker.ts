import { ObjectId, type Db } from "mongodb";
import { getSaasDb } from "./saasDb";
import { calculateFollowerNotional, getCopyTradePauseBalanceUSDT } from "./copyTradeSizing";
import { decryptSecret } from "./exchangeKeyCrypto";
import { getErrorMessage } from "./errorMessage";
import type {
  CopyTradeLogDoc,
  CopyTradeLogStatus,
  ExchangeKeyDoc,
  UserDoc,
  SubscriptionDoc,
  PerformanceFeeInvoiceDoc,
} from "./saasTypes";

const MAX_CONCURRENT_EXECUTIONS = 8;

export interface LeaderTradeEvent {
  leaderTradeId: string;
  action: "OPEN" | "CLOSE";
  symbol: string;
  side: "LONG" | "SHORT";
  leaderNotional: number;
  leaderBalance: number;
  entryPrice?: number | null;
  exitPrice?: number | null;
  realizedPnl?: number | null;
  leverage?: number | null;
  reduceOnly?: boolean;
  occurredAt?: string | null;
}

export interface CopyTradeExecutionResult {
  userId: string;
  status: CopyTradeLogStatus;
  followerNotional: number | null;
  followerOrderId: string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  realizedPnl?: number | null;
  roiPercentage?: number | null;
  detail: string | null;
}

interface EligibleFollower {
  user: UserDoc & { _id: ObjectId };
  key: ExchangeKeyDoc;
  subscription: SubscriptionDoc;
}

interface BotCopyTradeResponse {
  ok?: boolean;
  orderId?: string;
  followerOrderId?: string;
  avgFillPrice?: number | null;
  reason?: string;
  error?: string;
}

function userFacingExecutionError(message: string): string {
  const lower = message.toLowerCase();
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
  if (lower.includes("invalid copy-trade request") || lower.includes("invalid input")) {
    return "Your exchange connection is invalid or incomplete. Reconnect your Binance Futures API key and try again.";
  }
  return message;
}

export function parseLeaderTradeEvent(input: unknown): LeaderTradeEvent | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;

  const leaderTradeId = readString(body.leaderTradeId) ?? readString(body.tradeId) ?? readString(body.id);
  const rawAction = readString(body.action)?.toUpperCase() ?? (readString(body.type) === "position.closed" ? "CLOSE" : "OPEN");
  const action = rawAction === "CLOSE" ? "CLOSE" : rawAction === "OPEN" ? "OPEN" : null;
  const symbol = readString(body.symbol) ?? readString(body.leaderSymbol);
  const side = readSide(body.side) ?? readSide(body.leaderSide);
  const leaderNotional = readNumber(body.leaderNotional) ?? readNumber(body.notional) ?? readNumber(body.marginUsed);
  const leaderBalance = readNumber(body.leaderBalance) ?? readNumber(body.totalBalance) ?? readNumber(body.accountBalance);

  if (!leaderTradeId || !action || !symbol || !side || !leaderNotional || !leaderBalance) {
    return null;
  }

  return {
    leaderTradeId,
    action,
    symbol,
    side,
    leaderNotional,
    leaderBalance,
    entryPrice: readNumber(body.entryPrice) ?? readNumber(body.avgEntryPrice) ?? null,
    exitPrice: readNumber(body.exitPrice) ?? null,
    realizedPnl: readFiniteNumber(body.realizedPnl) ?? readFiniteNumber(body.realizedPnL) ?? readFiniteNumber(body.pnl) ?? readFiniteNumber(body.cumulativePnL) ?? null,
    leverage: readNumber(body.leverage) ?? null,
    reduceOnly: typeof body.reduceOnly === "boolean" ? body.reduceOnly : action === "CLOSE",
    occurredAt: readString(body.occurredAt) ?? readString(body.timestamp) ?? null,
  };
}

export async function executeCopyTradeFanOut(event: LeaderTradeEvent): Promise<CopyTradeExecutionResult[]> {
  const db = await getSaasDb();
  const followers = await loadEligibleFollowers(db);
  console.log(
    `[CopyTrade] ${event.action} ${event.symbol}: ${followers.length} eligible follower(s) found.`
  );
  const results: CopyTradeExecutionResult[] = [];

  for (let index = 0; index < followers.length; index += MAX_CONCURRENT_EXECUTIONS) {
    const batch = followers.slice(index, index + MAX_CONCURRENT_EXECUTIONS);
    const batchResults = await Promise.all(batch.map((follower) => executeForFollower(db, event, follower)));
    results.push(...batchResults);
  }

  return results;
}

async function loadEligibleFollowers(db: Db): Promise<EligibleFollower[]> {
  const users = await db
    .collection<UserDoc>("users")
    .find({
      role: "follower",
      copyTradingEnabled: true,
      emailVerified: true,
    })
    .toArray();

  const userIds = users.flatMap((user) => (user._id ? [user._id] : []));
  if (userIds.length === 0) return [];

  const [keys, subscriptions, pendingInvoices] = await Promise.all([
    db
      .collection<ExchangeKeyDoc>("exchange_keys")
      .find({ userId: { $in: userIds }, verifiedAt: { $ne: null } })
      .toArray(),
    db
      .collection<SubscriptionDoc>("subscriptions")
      .find({ userId: { $in: userIds }, status: "ACTIVE" })
      .toArray(),
    db
      .collection<PerformanceFeeInvoiceDoc>("performance_fee_invoices")
      .find({ userId: { $in: userIds }, status: { $in: ["PENDING_APPROVAL", "APPROVED"] } })
      .toArray(),
  ]);

  const keyByUser = new Map(keys.map((key) => [key.userId.toString(), key]));
  const subscriptionByUser = new Map(subscriptions.map((sub) => [sub.userId.toString(), sub]));
  const pendingInvoiceUsers = new Set(pendingInvoices.map((invoice) => invoice.userId.toString()));

  return users.flatMap((user) => {
    if (!user._id) return [];
    const userId = user._id.toString();
    const key = keyByUser.get(userId);
    const subscription = subscriptionByUser.get(userId);
    if (!key || !subscription || pendingInvoiceUsers.has(userId)) return [];
    return [{ user: user as UserDoc & { _id: ObjectId }, key, subscription }];
  });
}

async function executeForFollower(
  db: Db,
  event: LeaderTradeEvent,
  follower: EligibleFollower
): Promise<CopyTradeExecutionResult> {
  const userId = follower.user._id;
  const duplicate = await db.collection<CopyTradeLogDoc>("copy_trade_log").findOne({
    userId,
    leaderTradeId: event.leaderTradeId,
    action: event.action,
  });
  if (duplicate) {
    return {
      userId: userId.toString(),
      status: "skipped_duplicate",
      followerNotional: duplicate.followerNotional,
      followerOrderId: duplicate.followerOrderId,
      detail: "This leader trade was already processed for the follower.",
    };
  }

  const followerBalance = follower.key.lastKnownBalanceUSDT;
  if (!followerBalance || followerBalance <= 0) {
    return writeLog(db, event, follower, {
      status: "skipped_balance_unavailable",
      followerNotional: null,
      followerOrderId: null,
      detail: "Follower balance is unavailable.",
    });
  }
  const pauseBalanceUSDT = getCopyTradePauseBalanceUSDT();
  if (event.action === "OPEN" && followerBalance < pauseBalanceUSDT) {
    await db.collection<UserDoc>("users").updateOne(
      { _id: userId },
      { $set: { copyTradingEnabled: false, updatedAt: new Date() } }
    );
    return writeLog(db, event, follower, {
      status: "skipped_insufficient_balance",
      followerNotional: null,
      followerOrderId: null,
      detail: `Copy trading paused because available balance is below the $${pauseBalanceUSDT.toFixed(2)} runtime safety floor.`,
    });
  }

  const sizing = calculateFollowerNotional({
    leaderNotional: event.leaderNotional,
    leaderBalance: event.leaderBalance,
    followerBalance,
  });

  if (sizing.belowMinimum || sizing.followerNotional <= 0) {
    return writeLog(db, event, follower, {
      status: "skipped_insufficient_balance",
      followerNotional: sizing.followerNotional,
      followerOrderId: null,
      detail: `Calculated follower trade size is below the $${sizing.minNotionalUSDT.toFixed(2)} minimum copy-trade amount.`,
    });
  }

  try {
    const [apiKey, apiSecret] = await Promise.all([
      decryptSecret(follower.key.apiKeyEncrypted),
      decryptSecret(follower.key.apiSecretEncrypted),
    ]);
    const execution = await callBotCopyTradeExecution(event, {
      apiKey,
      apiSecret,
      followerNotional: sizing.followerNotional,
    });
    const reason = execution.reason ?? execution.error ?? "";
    if (!execution.ok && event.action === "CLOSE" && /no matching follower position is open/i.test(reason)) {
      const openLog = await db.collection<CopyTradeLogDoc>("copy_trade_log").findOne({
        userId,
        leaderTradeId: event.leaderTradeId,
        action: "OPEN",
      });
      return writeLog(db, event, follower, {
        status: "closed",
        followerNotional: sizing.followerNotional,
        followerOrderId: openLog?.followerOrderId ?? null,
        entryPrice: openLog?.entryPrice ?? null,
        exitPrice: null,
        realizedPnl: 0,
        roiPercentage: 0,
        detail: "Follower was already flat when the leader close event arrived.",
      });
    }

    if (!execution.ok) {
      return writeLog(db, event, follower, {
        status: "failed",
        followerNotional: sizing.followerNotional,
        followerOrderId: null,
        detail: userFacingExecutionError(reason || "Bot rejected the copy-trade execution."),
      });
    }

    const openLog = event.action === "CLOSE"
      ? await db.collection<CopyTradeLogDoc>("copy_trade_log").findOne({
          userId,
          leaderTradeId: event.leaderTradeId,
          action: "OPEN",
        })
      : null;
    const entryPrice = event.action === "OPEN" ? execution.avgFillPrice ?? null : openLog?.entryPrice ?? null;
    const exitPrice = event.action === "CLOSE" ? execution.avgFillPrice ?? event.exitPrice ?? null : null;
    const priceBasedPnl =
      event.action === "CLOSE" && entryPrice && exitPrice && sizing.followerNotional
        ? ((exitPrice - entryPrice) / entryPrice) * sizing.followerNotional * (event.side === "SHORT" ? -1 : 1)
        : null;
    const leaderRealizedPnl = event.realizedPnl ?? null;
    const leaderScaledPnl =
      event.action === "CLOSE" && leaderRealizedPnl !== null && event.leaderNotional > 0 && sizing.followerNotional
        ? leaderRealizedPnl * (sizing.followerNotional / event.leaderNotional)
        : null;
    const realizedPnl = priceBasedPnl ?? leaderScaledPnl;
    const roiPercentage =
      realizedPnl !== null && sizing.followerNotional
        ? (realizedPnl / sizing.followerNotional) * 100
        : null;

    return writeLog(db, event, follower, {
      status: event.action === "CLOSE" ? "closed" : "executed",
      followerNotional: sizing.followerNotional,
      followerOrderId: execution.followerOrderId ?? execution.orderId ?? null,
      entryPrice,
      exitPrice,
      realizedPnl,
      roiPercentage,
      detail: sizing.cappedByMaxPct ? "Executed with max-notional cap applied." : null,
    });
  } catch (error: unknown) {
    return writeLog(db, event, follower, {
      status: "failed",
      followerNotional: sizing.followerNotional,
      followerOrderId: null,
      detail: userFacingExecutionError(getErrorMessage(error, "Copy-trade execution failed.")),
    });
  }
}

async function callBotCopyTradeExecution(
  event: LeaderTradeEvent,
  follower: { apiKey: string; apiSecret: string; followerNotional: number }
): Promise<BotCopyTradeResponse> {
  const botUrl = process.env.BOT_SERVER_URL;
  const serviceKey = process.env.SAAS_SERVICE_KEY;
  if (!botUrl || !serviceKey) {
    throw new Error("BOT_SERVER_URL / SAAS_SERVICE_KEY not configured.");
  }

  const res = await fetch(`${botUrl.replace(/\/+$/, "")}/api/saas/execute-copy-trade`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Key": serviceKey,
    },
    body: JSON.stringify({
      apiKey: follower.apiKey,
      apiSecret: follower.apiSecret,
      action: event.action,
      symbol: event.symbol,
      side: event.side,
      notionalUSDT: follower.followerNotional,
      leverage: event.leverage,
      reduceOnly: event.reduceOnly,
      leaderTradeId: event.leaderTradeId,
    }),
  });

  const data = await res.json().catch(() => null) as BotCopyTradeResponse | null;
  if (!res.ok) {
    return {
      ok: false,
      reason: data?.reason ?? data?.error ?? `Bot execution failed (${res.status}).`,
    };
  }
  return data ?? { ok: true };
}

async function writeLog(
  db: Db,
  event: LeaderTradeEvent,
  follower: EligibleFollower,
  result: Omit<CopyTradeExecutionResult, "userId">
): Promise<CopyTradeExecutionResult> {
  const now = new Date();
  const occurredAt = event.occurredAt ? new Date(event.occurredAt) : now;
  const executedAt = Number.isNaN(occurredAt.getTime()) ? now : occurredAt;

  const updateResult = await db.collection<CopyTradeLogDoc>("copy_trade_log").updateOne(
    {
      userId: follower.user._id,
      leaderTradeId: event.leaderTradeId,
      action: event.action,
    },
    {
      $setOnInsert: {
        userId: follower.user._id,
        leaderTradeId: event.leaderTradeId,
        action: event.action,
        leaderSymbol: event.symbol,
        leaderSide: event.side,
        leaderNotional: event.leaderNotional,
        leaderBalance: event.leaderBalance,
        followerNotional: result.followerNotional,
        followerOrderId: result.followerOrderId,
        entryPrice: result.entryPrice,
        exitPrice: result.exitPrice,
        realizedPnl: result.realizedPnl,
        roiPercentage: result.roiPercentage,
        exchange: follower.key.exchange,
        status: result.status,
        detail: result.detail,
        executedAt,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  if (updateResult.upsertedCount === 0) {
    return {
      userId: follower.user._id.toString(),
      status: "skipped_duplicate",
      followerNotional: result.followerNotional,
      followerOrderId: result.followerOrderId,
      detail: "This leader trade was already processed for the follower.",
    };
  }

  return {
    userId: follower.user._id.toString(),
    ...result,
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readSide(value: unknown): "LONG" | "SHORT" | null {
  if (value === "LONG" || value === "SHORT") return value;
  if (value === "BUY") return "LONG";
  if (value === "SELL") return "SHORT";
  return null;
}

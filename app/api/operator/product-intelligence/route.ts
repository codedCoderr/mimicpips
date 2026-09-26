import { NextRequest, NextResponse } from "next/server";
import type { Document } from "mongodb";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getBotDb, getSaasDb } from "@/lib/saasDb";
import { calculateFollowerHealth } from "@/lib/followerHealth";
import type { CopyTradeLogDoc, UserDoc } from "@/lib/saasTypes";

const DAY_MS = 24 * 60 * 60 * 1000;
const BOT_TRADES_COLLECTION = "futures_history";

type HealthBand = "healthy" | "watching" | "anxious" | "likely_to_churn";

async function requireOperator(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return token ? !!(await verifySessionToken(token).catch(() => null)) : false;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function cleanSymbol(raw: unknown): string {
  return typeof raw === "string" && raw.trim()
    ? raw.trim().split(":")[0]
    : "UNKNOWN";
}

function readNumber(...values: unknown[]): number {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function safeStatus(log: Pick<CopyTradeLogDoc, "status">): string {
  return typeof log.status === "string" ? log.status : "unknown";
}

function safeAction(log: Pick<CopyTradeLogDoc, "action">): "OPEN" | "CLOSE" | "UNKNOWN" {
  return log.action === "OPEN" || log.action === "CLOSE" ? log.action : "UNKNOWN";
}

function closeReason(doc: Document): string {
  const reason = String(doc.closeReason ?? doc.reason ?? doc.exitReason ?? "UNKNOWN");
  return reason.toUpperCase().replace(/\s+/g, "_");
}

export async function GET(req: NextRequest) {
  if (!(await requireOperator(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;
  const since = new Date(Date.now() - days * DAY_MS);

  const [saasDb, botDb] = await Promise.all([getSaasDb(), getBotDb()]);

  const [followers, copyLogs, leaderTrades, recentMarketingEvents] = await Promise.all([
    saasDb.collection<UserDoc>("users").find({ role: "follower" }).limit(250).toArray(),
    saasDb
      .collection<CopyTradeLogDoc>("copy_trade_log")
      .find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray(),
    botDb
      .collection<Document>(BOT_TRADES_COLLECTION)
      .find({
        status: { $in: ["CLOSED", "closed"] },
        $or: [{ closedAt: { $gte: since } }, { exitTime: { $gte: since } }],
      })
      .sort({ closedAt: -1, exitTime: -1 })
      .limit(500)
      .toArray(),
    saasDb
      .collection("marketing_events")
      .find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(12)
      .toArray(),
  ]);

  const healthResults = await Promise.all(
    followers.map(async (user) => {
      if (!user._id) return null;
      const health = await calculateFollowerHealth(
        saasDb,
        user as UserDoc & { _id: NonNullable<UserDoc["_id"]> }
      );
      return {
        userId: user._id.toString(),
        displayName: user.displayName || user.email,
        email: user.email,
        copyTradingEnabled: user.copyTradingEnabled,
        score: health.score,
        band: health.band as HealthBand,
        drivers: health.drivers,
        recommendedAction: health.recommendedAction,
        daysUntilRenewal: health.daysUntilRenewal,
        netPnl30d: health.netPnl30d,
      };
    })
  );

  const followerHealth = healthResults.filter(
    (item): item is NonNullable<typeof item> => item !== null
  );
  const activeFollowers = followers.filter((user) => user.copyTradingEnabled).length;
  const anxiousFollowers = followerHealth.filter((item) =>
    ["anxious", "likely_to_churn"].includes(item.band)
  );

  const logsByTrade = new Map<string, CopyTradeLogDoc[]>();
  for (const log of copyLogs) {
    const key = log.leaderTradeId || "unknown";
    logsByTrade.set(key, [...(logsByTrade.get(key) ?? []), log]);
  }

  const failedLogs = copyLogs.filter((log) => safeStatus(log) === "failed");
  const skippedLogs = copyLogs.filter((log) => safeStatus(log).startsWith("skipped_"));
  const closeLogs = copyLogs.filter((log) => safeAction(log) === "CLOSE");
  const repairedCloseCandidates = closeLogs.filter((log) => {
    const detail = log.detail?.toLowerCase() ?? "";
    return (
      log.status === "failed" &&
      (detail.includes("already closed") ||
        detail.includes("already flat") ||
        detail.includes("no matching follower position is open"))
    );
  });

  const unresolvedTradeGroups = Array.from(logsByTrade.entries())
    .map(([leaderTradeId, logs]) => {
      const opens = logs.filter((log) => safeAction(log) === "OPEN");
      const closes = logs.filter((log) => safeAction(log) === "CLOSE");
      const failed = logs.filter((log) => safeStatus(log) === "failed");
      const skipped = logs.filter((log) => safeStatus(log).startsWith("skipped_"));
      return {
        leaderTradeId,
        symbol: cleanSymbol(logs[0]?.leaderSymbol),
        opens: opens.length,
        closes: closes.length,
        failed: failed.length,
        skipped: skipped.length,
        lastStatus: logs[0] ? safeStatus(logs[0]) : "unknown",
        lastDetail: logs[0]?.detail ?? null,
      };
    })
    .filter((group) => group.failed > 0 || group.skipped > 0 || group.opens !== group.closes)
    .slice(0, 12);

  const symbolStats = new Map<
    string,
    { symbol: string; trades: number; wins: number; pnl: number; losses: number }
  >();
  const exitStats = new Map<string, { reason: string; trades: number; pnl: number }>();
  for (const doc of leaderTrades) {
    const symbol = cleanSymbol(doc.symbol ?? doc.leaderSymbol);
    const pnl = readNumber(doc.realizedPnL, doc.realizedPnl, doc.pnl);
    const existing = symbolStats.get(symbol) ?? {
      symbol,
      trades: 0,
      wins: 0,
      losses: 0,
      pnl: 0,
    };
    existing.trades += 1;
    existing.pnl += pnl;
    if (pnl > 0) existing.wins += 1;
    if (pnl < 0) existing.losses += 1;
    symbolStats.set(symbol, existing);

    const reason = closeReason(doc);
    const exit = exitStats.get(reason) ?? { reason, trades: 0, pnl: 0 };
    exit.trades += 1;
    exit.pnl += pnl;
    exitStats.set(reason, exit);
  }

  const symbolQuality = Array.from(symbolStats.values())
    .map((row) => ({
      ...row,
      winRate: row.trades > 0 ? (row.wins / row.trades) * 100 : 0,
    }))
    .sort((a, b) => a.pnl - b.pnl)
    .slice(0, 10);

  const exitLeaks = Array.from(exitStats.values())
    .sort((a, b) => a.pnl - b.pnl)
    .slice(0, 8);

  const totalLeaderPnl = leaderTrades.reduce(
    (sum, doc) => sum + readNumber(doc.realizedPnL, doc.realizedPnl, doc.pnl),
    0
  );
  const wins = leaderTrades.filter(
    (doc) => readNumber(doc.realizedPnL, doc.realizedPnl, doc.pnl) > 0
  ).length;
  const copiedPnl = copyLogs.reduce(
    (sum, log) => sum + readNumber(log.realizedPnl),
    0
  );

  const integrityScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        failedLogs.length * 7 -
        skippedLogs.length * 2 -
        unresolvedTradeGroups.length * 4 -
        repairedCloseCandidates.length * 3
    )
  );

  const goLiveBlockers = [
    failedLogs.length > 0 ? `${failedLogs.length} failed copy-trade event(s) in ${days}d` : null,
    unresolvedTradeGroups.length > 0
      ? `${unresolvedTradeGroups.length} trade lifecycle group(s) need reconciliation`
      : null,
    anxiousFollowers.length > 0
      ? `${anxiousFollowers.length} anxious or likely-to-churn follower(s)`
      : null,
    integrityScore < 85 ? `Execution integrity score is ${integrityScore}/100` : null,
  ].filter((item): item is string => item !== null);

  const readiness =
    goLiveBlockers.length === 0
      ? "READY"
      : integrityScore >= 75 && failedLogs.length <= 2
        ? "WATCH"
        : "BLOCKED";

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    windowDays: days,
    readiness,
    goLiveBlockers,
    executionIntegrity: {
      score: integrityScore,
      copyEvents: copyLogs.length,
      failedEvents: failedLogs.length,
      skippedEvents: skippedLogs.length,
      repairedCloseCandidates: repairedCloseCandidates.length,
      unresolvedTradeGroups,
    },
    followerIntelligence: {
      totalFollowers: followers.length,
      activeFollowers,
      anxiousFollowers: anxiousFollowers.length,
      healthBands: {
        healthy: followerHealth.filter((item) => item.band === "healthy").length,
        watching: followerHealth.filter((item) => item.band === "watching").length,
        anxious: followerHealth.filter((item) => item.band === "anxious").length,
        likelyToChurn: followerHealth.filter((item) => item.band === "likely_to_churn").length,
      },
      topRetentionRisks: anxiousFollowers
        .sort((a, b) => a.score - b.score)
        .slice(0, 8)
        .map((item) => ({
          userId: item.userId,
          displayName: item.displayName,
          email: item.email,
          score: item.score,
          band: item.band,
          driver: item.drivers[0] ?? "No driver recorded.",
          recommendedAction: item.recommendedAction,
          daysUntilRenewal: item.daysUntilRenewal,
          netPnl30d: item.netPnl30d,
        })),
    },
    tradingIntelligence: {
      leaderTrades: leaderTrades.length,
      leaderWinRate: leaderTrades.length > 0 ? (wins / leaderTrades.length) * 100 : 0,
      leaderPnl: totalLeaderPnl,
      copiedPnl,
      symbolQuality,
      exitLeaks,
    },
    productModules: [
      {
        key: "trade_lifecycle",
        title: "Trade lifecycle state machine",
        status: unresolvedTradeGroups.length > 0 ? "NEEDS_ATTENTION" : "HEALTHY",
        nextAction:
          unresolvedTradeGroups.length > 0
            ? "Reconcile open/close count mismatches before scaling follower volume."
            : "Keep collecting lifecycle events for audit timelines.",
      },
      {
        key: "follower_fidelity",
        title: "Leader vs follower fidelity",
        status: failedLogs.length > 0 ? "NEEDS_ATTENTION" : "HEALTHY",
        nextAction:
          failedLogs.length > 0
            ? "Review failed copy events and show exact reason on follower timelines."
            : "Start exposing slippage and fill-delay deltas per follower.",
      },
      {
        key: "retention_engine",
        title: "Anxiety and renewal retention",
        status: anxiousFollowers.length > 0 ? "WATCH" : "HEALTHY",
        nextAction:
          anxiousFollowers.length > 0
            ? "Send reassurance or education to the highest-risk followers."
            : "Keep sending monthly proof and renewal context.",
      },
      {
        key: "public_proof",
        title: "Public performance proof",
        status: recentMarketingEvents.length > 0 ? "READY" : "TODO",
        nextAction:
          recentMarketingEvents.length > 0
            ? "Package recent verified events into public Telegram/social proof."
            : "Generate a marketing signal from verified performance or risk events.",
      },
    ],
    recentMarketingEvents: recentMarketingEvents.map((event) => ({
      id: event._id?.toString(),
      type: event.type,
      title: event.title,
      metricLabel: event.metricLabel,
      metricValue: event.metricValue,
      createdAt: asDate(event.createdAt)?.toISOString() ?? new Date().toISOString(),
    })),
  });
}

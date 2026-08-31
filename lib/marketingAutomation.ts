import { ObjectId, type Db } from "mongodb";
import { getSaasDb } from "@/lib/saasDb";
import { sendTelegramPublicMessage } from "@/lib/telegram";

type MarketingEventType =
  | "monthly_gain_milestone"
  | "crisis_averted"
  | "new_equity_high"
  | "drawdown_recovery"
  | "risk_guard_triggered"
  | "extended_drawdown"
  | "technical_disruption";

interface MarketingSignalInput {
  type: MarketingEventType;
  title: string;
  summary: string;
  metricLabel: string;
  metricValue: string;
  audience?: string;
  campaignKey: string;
}

export interface MarketingAutomationResult {
  campaignKey: string;
  type: MarketingEventType;
  title: string;
  outcome: "created" | "already_exists" | "telegram_sent" | "telegram_error";
  eventId?: string;
  detail?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function fmtUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function formatTelegramMarketingSignal(event: {
  type: string;
  title: string;
  summary: string;
  metricLabel?: string;
  metricValue?: string;
}): string {
  const label = event.type.replace(/_/g, " ").toUpperCase();
  const metric = event.metricValue
    ? [`KEY METRIC`, `${event.metricLabel || "Signal"}: ${event.metricValue}`].join("\n")
    : "";

  return [
    "MIMIC PIPS SIGNAL DESK",
    label,
    "",
    event.title,
    "",
    event.summary,
    metric ? `\n${metric}` : "",
    "",
    "SYSTEM STATUS",
    "Risk Guard: Active",
    "Copy Engine: Monitoring",
    "Execution Rules: Enforced",
    "",
    "This is not financial advice. Futures trading carries risk.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function realizedPnlStats(db: Db, since: Date) {
  const result = await db.collection("copy_trade_log").aggregate<{
    totalPnl: number;
    winCount: number;
    lossCount: number;
    tradeCount: number;
  }>([
    {
      $match: {
        createdAt: { $gte: since },
        $or: [
          { action: "CLOSE" },
          { realizedPnl: { $ne: null } },
          { pnl: { $ne: null } },
        ],
      },
    },
    {
      $project: {
        pnl: { $ifNull: ["$realizedPnl", { $ifNull: ["$pnl", 0] }] },
      },
    },
    {
      $group: {
        _id: null,
        totalPnl: { $sum: "$pnl" },
        winCount: { $sum: { $cond: [{ $gt: ["$pnl", 0] }, 1, 0] } },
        lossCount: { $sum: { $cond: [{ $lt: ["$pnl", 0] }, 1, 0] } },
        tradeCount: { $sum: 1 },
      },
    },
  ]).next();

  return result ?? { totalPnl: 0, winCount: 0, lossCount: 0, tradeCount: 0 };
}

async function recentGateStats(db: Db, since: Date) {
  const [riskActions, failures, activeFollowers] = await Promise.all([
    db.collection("follower_behaviour_events").countDocuments({
      createdAt: { $gte: since },
      type: { $in: ["copy_trading_disabled", "risk_settings_view", "support_intent"] },
    }),
    db.collection("copy_trade_log").countDocuments({
      createdAt: { $gte: since },
      status: { $regex: /^(failed|skipped_)/ },
    }),
    db.collection("users").countDocuments({ role: "follower", copyTradingEnabled: true }),
  ]);

  return { riskActions, failures, activeFollowers };
}

async function buildSignalCandidates(db: Db): Promise<MarketingSignalInput[]> {
  const now = new Date();
  const today = dayKey(now);
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const since30d = new Date(now.getTime() - 30 * DAY_MS);
  const last7 = await realizedPnlStats(db, since7d);
  const last30 = await realizedPnlStats(db, since30d);
  const gate = await recentGateStats(db, since7d);
  const candidates: MarketingSignalInput[] = [];

  if (last30.tradeCount >= 3 && last30.totalPnl >= 100) {
    candidates.push({
      type: "monthly_gain_milestone",
      title: "Monthly copied-performance milestone reached",
      summary: `Mimic Pips has closed ${last30.tradeCount} copied trade event(s) in the last 30 days with net realized copied PnL of ${fmtUsd(last30.totalPnl)} across tracked followers. The useful story is not only the gain; it is that billing, exchange, and copy-status gates stayed visible while the system operated.`,
      metricLabel: "30-day realized copied PnL",
      metricValue: fmtUsd(last30.totalPnl),
      campaignKey: `auto:${today}:monthly_gain_milestone:${Math.floor(last30.totalPnl / 100)}`,
    });
  }

  if (last7.tradeCount >= 2 && last7.totalPnl > 0 && last7.lossCount > 0) {
    candidates.push({
      type: "drawdown_recovery",
      title: "The system recovered after losing close events",
      summary: `The last 7 days included ${last7.lossCount} losing close event(s), but net copied PnL still recovered to ${fmtUsd(last7.totalPnl)}. This is a stronger trust signal than a clean winning streak because it shows the system continuing through normal volatility instead of hiding the rough part.`,
      metricLabel: "7-day recovery",
      metricValue: `${fmtUsd(last7.totalPnl)} after ${last7.lossCount} loss event(s)`,
      campaignKey: `auto:${today}:drawdown_recovery:${last7.lossCount}:${Math.floor(last7.totalPnl)}`,
    });
  }

  if (gate.riskActions >= 3 || gate.failures >= 3) {
    candidates.push({
      type: "risk_guard_triggered",
      title: "Risk Guard slowed execution pressure before it became unsafe",
      summary: `In the last 7 days, Mimic Pips recorded ${gate.riskActions} follower risk action(s) and ${gate.failures} failed/skipped execution event(s). Those are not silent failures; they are exactly the kind of safety signals followers should see before capital is exposed carelessly.`,
      metricLabel: "Risk-control events",
      metricValue: `${gate.riskActions + gate.failures} visible gate event(s)`,
      campaignKey: `auto:${today}:risk_guard_triggered:${gate.riskActions}:${gate.failures}`,
    });
  }

  if (last7.tradeCount >= 3 && last7.totalPnl <= -100) {
    candidates.push({
      type: "extended_drawdown",
      title: "Drawdown watch is active",
      summary: `Copied trades are down ${fmtUsd(last7.totalPnl)} over the last 7 days across ${last7.tradeCount} close event(s). This should be communicated plainly: drawdowns happen, risk gates remain visible, and the system should avoid pretending that every week is a straight line upward.`,
      metricLabel: "7-day drawdown",
      metricValue: fmtUsd(last7.totalPnl),
      campaignKey: `auto:${today}:extended_drawdown:${Math.floor(Math.abs(last7.totalPnl) / 100)}`,
    });
  }

  if (gate.activeFollowers > 0 && last30.tradeCount >= 5) {
    const winRate = last30.tradeCount > 0 ? (last30.winCount / last30.tradeCount) * 100 : 0;
    if (winRate >= 60) {
      candidates.push({
        type: "new_equity_high",
        title: "Follower-side execution quality is strengthening",
        summary: `Tracked copied closes show a ${fmtPct(winRate)} win-rate over ${last30.tradeCount} realized event(s) in the last 30 days. For acquisition, this is useful proof only when paired with transparent risk language, not hype.`,
        metricLabel: "30-day copied close win-rate",
        metricValue: fmtPct(winRate),
        campaignKey: `auto:${today}:new_equity_high:${Math.floor(winRate)}`,
      });
    }
  }

  return candidates;
}

async function createAndMaybeSendSignal(db: Db, signal: MarketingSignalInput): Promise<MarketingAutomationResult> {
  const now = new Date();
  const event = {
    ...signal,
    audience: signal.audience ?? "public",
    source: "automation",
    createdAt: now,
    updatedAt: now,
  };

  const existing = await db.collection("marketing_events").findOne({ campaignKey: signal.campaignKey });
  if (existing) {
    return {
      campaignKey: signal.campaignKey,
      type: signal.type,
      title: signal.title,
      outcome: "already_exists",
      eventId: existing._id?.toString(),
    };
  }

  const insert = await db.collection("marketing_events").insertOne(event);
  const eventId = insert.insertedId.toString();
  const autoTelegram = process.env.AUTO_TELEGRAM_MARKETING === "true";

  if (!autoTelegram) {
    return { campaignKey: signal.campaignKey, type: signal.type, title: signal.title, outcome: "created", eventId };
  }

  try {
    const result = await sendTelegramPublicMessage(formatTelegramMarketingSignal(signal));
    await db.collection("marketing_send_logs").insertOne({
      eventId: new ObjectId(eventId),
      channel: "telegram_public",
      status: "sent",
      subject: signal.title,
      message: formatTelegramMarketingSignal(signal),
      providerMessageId: result.messageId,
      providerChatId: result.chatId,
      campaignKey: `${signal.campaignKey}:telegram`,
      createdAt: now,
    });
    await db.collection("marketing_events").updateOne(
      { _id: new ObjectId(eventId) },
      { $set: { lastSentAt: now, lastSentChannel: "telegram_public", updatedAt: now } }
    );
    return { campaignKey: signal.campaignKey, type: signal.type, title: signal.title, outcome: "telegram_sent", eventId };
  } catch (error) {
    await db.collection("marketing_send_logs").insertOne({
      eventId: new ObjectId(eventId),
      channel: "telegram_public",
      status: "error",
      subject: signal.title,
      message: formatTelegramMarketingSignal(signal),
      campaignKey: `${signal.campaignKey}:telegram`,
      error: error instanceof Error ? error.message : "Telegram send failed.",
      createdAt: now,
    });
    return {
      campaignKey: signal.campaignKey,
      type: signal.type,
      title: signal.title,
      outcome: "telegram_error",
      eventId,
      detail: error instanceof Error ? error.message : "Telegram send failed.",
    };
  }
}

export async function runMarketingAutomationCycle(): Promise<MarketingAutomationResult[]> {
  const db = await getSaasDb();
  const candidates = await buildSignalCandidates(db);
  const results: MarketingAutomationResult[] = [];

  for (const signal of candidates) {
    results.push(await createAndMaybeSendSignal(db, signal));
  }

  return results;
}

import type { ObjectId, Db } from "mongodb";
import type { CopyTradeLogDoc, ExchangeKeyDoc, PerformanceFeeInvoiceDoc, SubscriptionDoc, UserDoc } from "@/lib/saasTypes";

export type BehaviourEventType =
  | "dashboard_view"
  | "copy_trading_enabled"
  | "copy_trading_disabled"
  | "profile_view"
  | "billing_view"
  | "performance_view"
  | "support_intent"
  | "risk_settings_view"
  | "pnl_card_generated";

export interface FollowerBehaviourEventDoc {
  _id?: ObjectId;
  userId: ObjectId;
  type: BehaviourEventType;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export type FollowerHealthBand = "healthy" | "watching" | "anxious" | "likely_to_churn";

export interface FollowerHealthScore {
  score: number;
  band: FollowerHealthBand;
  label: string;
  drivers: string[];
  recommendedAction: string;
  recentDashboardViews: number;
  recentRiskActions: number;
  losingTrades30d: number;
  netPnl30d: number;
  daysUntilRenewal: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / DAY_MS);
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function bandForScore(score: number): FollowerHealthBand {
  if (score >= 76) return "healthy";
  if (score >= 56) return "watching";
  if (score >= 36) return "anxious";
  return "likely_to_churn";
}

function labelForBand(band: FollowerHealthBand): string {
  if (band === "healthy") return "Healthy";
  if (band === "watching") return "Watching carefully";
  if (band === "anxious") return "Anxious";
  return "Likely to churn";
}

function actionForBand(band: FollowerHealthBand, drivers: string[]): string {
  if (band === "healthy") return "Keep them warm with transparent weekly performance notes.";
  if (drivers.some((driver) => driver.toLowerCase().includes("invoice") || driver.toLowerCase().includes("renewal"))) {
    return "Send a billing reminder with recent risk-control context before renewal.";
  }
  if (drivers.some((driver) => driver.toLowerCase().includes("loss") || driver.toLowerCase().includes("drawdown") || driver.toLowerCase().includes("down"))) {
    return "Send a calm post-drawdown explanation showing what the bot protected and what happens next.";
  }
  if (drivers.some((driver) => driver.toLowerCase().includes("disabled") || driver.toLowerCase().includes("risk action"))) {
    return "Reach out personally and help them reset allocation expectations.";
  }
  return "Check in with a concise confidence-building update.";
}

export async function calculateFollowerHealth(db: Db, user: UserDoc & { _id: ObjectId }): Promise<FollowerHealthScore> {
  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  const since30d = new Date(now.getTime() - 30 * DAY_MS);

  const [key, subscription, openInvoices, recentTrades, recentEvents] = await Promise.all([
    db.collection<ExchangeKeyDoc>("exchange_keys").findOne({ userId: user._id }),
    db.collection<SubscriptionDoc>("subscriptions").findOne({ userId: user._id }),
    db.collection<PerformanceFeeInvoiceDoc>("performance_fee_invoices").find({
      userId: user._id,
      status: { $in: ["PENDING_APPROVAL", "APPROVED"] },
    }).toArray(),
    db.collection<CopyTradeLogDoc>("copy_trade_log").find({
      userId: user._id,
      createdAt: { $gte: since30d },
    }).sort({ createdAt: -1 }).limit(80).toArray(),
    db.collection<FollowerBehaviourEventDoc>("follower_behaviour_events").find({
      userId: user._id,
      createdAt: { $gte: since30d },
    }).sort({ createdAt: -1 }).limit(120).toArray(),
  ]);

  let score = 100;
  const drivers: string[] = [];
  const realizedTrades = recentTrades.filter((trade) => trade.action === "CLOSE" || Number(trade.realizedPnl ?? 0) !== 0);
  const netPnl30d = realizedTrades.reduce((sum, trade) => sum + Number(trade.realizedPnl ?? 0), 0);
  const losingTrades30d = realizedTrades.filter((trade) => Number(trade.realizedPnl ?? 0) < 0).length;
  const failedOrSkipped = recentTrades.filter((trade) => trade.status === "failed" || trade.status.startsWith("skipped_")).length;

  const recentDashboardViews = recentEvents.filter((event) => event.type === "dashboard_view" && event.createdAt >= since7d).length;
  const recentRiskActions = recentEvents.filter((event) => ["copy_trading_disabled", "risk_settings_view", "support_intent"].includes(event.type) && event.createdAt >= since7d).length;
  const disabledRecently = recentEvents.some((event) => event.type === "copy_trading_disabled" && event.createdAt >= since30d);
  const daysUntilRenewal = subscription?.currentPeriodEnd ? daysBetween(now, new Date(subscription.currentPeriodEnd)) : null;

  if (!user.emailVerified) {
    score -= 10;
    drivers.push("Email is still unverified.");
  }
  if (!key?.verifiedAt) {
    score -= 16;
    drivers.push("Exchange is not connected.");
  }
  if (!user.copyTradingEnabled) {
    score -= disabledRecently ? 22 : 12;
    drivers.push(disabledRecently ? "Follower recently disabled copy trading." : "Copy trading is currently off.");
  }
  if (subscription?.status !== "ACTIVE") {
    score -= subscription?.status === "PAST_DUE" ? 24 : 16;
    drivers.push(subscription?.status ? `Subscription is ${subscription.status.toLowerCase().replace(/_/g, " ")}.` : "No active subscription is present.");
  }
  if (openInvoices.length > 0) {
    score -= Math.min(20, openInvoices.length * 8);
    drivers.push(`${openInvoices.length} unsettled performance invoice${openInvoices.length > 1 ? "s" : ""}.`);
  }
  if (daysUntilRenewal !== null && daysUntilRenewal >= 0 && daysUntilRenewal <= 7) {
    score -= 8;
    drivers.push(`Renewal is due in ${daysUntilRenewal} day${daysUntilRenewal === 1 ? "" : "s"}.`);
  }
  if (netPnl30d < 0) {
    score -= Math.min(20, Math.abs(netPnl30d) >= 100 ? 18 : 10);
    drivers.push(`Recent copied trades are down $${Math.abs(netPnl30d).toFixed(2)}.`);
  }
  if (losingTrades30d >= 3) {
    score -= Math.min(14, losingTrades30d * 3);
    drivers.push(`${losingTrades30d} losing close events in the last 30 days.`);
  }
  if (failedOrSkipped >= 3) {
    score -= Math.min(12, failedOrSkipped * 2);
    drivers.push(`${failedOrSkipped} failed or skipped execution events need review.`);
  }
  if (recentDashboardViews >= 8 && netPnl30d < 0) {
    score -= 12;
    drivers.push("High dashboard checking after losses suggests anxiety.");
  }
  if (recentRiskActions > 0) {
    score -= Math.min(18, recentRiskActions * 8);
    drivers.push(`${recentRiskActions} recent risk action${recentRiskActions === 1 ? "" : "s"}.`);
  }

  const finalScore = clampScore(score);
  const band = bandForScore(finalScore);
  const normalizedDrivers = drivers.length > 0 ? drivers.slice(0, 5) : ["No immediate churn or anxiety signal detected."];

  return {
    score: finalScore,
    band,
    label: labelForBand(band),
    drivers: normalizedDrivers,
    recommendedAction: actionForBand(band, normalizedDrivers),
    recentDashboardViews,
    recentRiskActions,
    losingTrades30d,
    netPnl30d,
    daysUntilRenewal,
  };
}

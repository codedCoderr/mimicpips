import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

dotenv.config();
dotenv.config({ path: ".env.local" });

const uri = process.env.MONGO_URI || "mongodb://localhost:27017";
const dbName = process.env.SAAS_DB_NAME || "copytrade_saas";
const password = process.env.SEED_USER_PASSWORD || "TestPass123!";
const now = new Date();
const dayMs = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return new Date(now.getTime() - days * dayMs);
}

function daysFromNow(days) {
  return new Date(now.getTime() + days * dayMs);
}

const scenarios = [
  {
    email: "healthy.follower@mimicpips.test",
    displayName: "Healthy Follower",
    copyTradingEnabled: true,
    emailVerified: true,
    balance: 1250,
    subscription: { status: "ACTIVE", periodEndDays: 21 },
    trades: [
      { pnl: 42.5, roi: 3.4, daysAgo: 3 },
      { pnl: 18.2, roi: 1.7, daysAgo: 11 },
    ],
    events: [{ type: "dashboard_view", daysAgo: 6 }],
  },
  {
    email: "anxious.afterloss@mimicpips.test",
    displayName: "Anxious After Loss",
    copyTradingEnabled: true,
    emailVerified: true,
    balance: 840,
    subscription: { status: "ACTIVE", periodEndDays: 5 },
    trades: [
      { pnl: -76.4, roi: -6.9, daysAgo: 1 },
      { pnl: -33.1, roi: -3.2, daysAgo: 4 },
      { pnl: 12.7, roi: 1.1, daysAgo: 8 },
    ],
    events: [
      ...Array.from({ length: 10 }, (_, index) => ({ type: "dashboard_view", daysAgo: Math.min(index + 1, 7) })),
      { type: "performance_view", daysAgo: 1 },
      { type: "billing_view", daysAgo: 1 },
    ],
  },
  {
    email: "likely.churn@mimicpips.test",
    displayName: "Likely Churn",
    copyTradingEnabled: false,
    emailVerified: true,
    balance: 510,
    subscription: { status: "ACTIVE", periodEndDays: 2 },
    trades: [
      { pnl: -120.8, roi: -9.4, daysAgo: 2 },
      { pnl: -51.25, roi: -4.8, daysAgo: 7 },
      { pnl: -38.9, roi: -3.7, daysAgo: 13 },
    ],
    events: [
      { type: "copy_trading_disabled", daysAgo: 1 },
      { type: "risk_settings_view", daysAgo: 1 },
      { type: "support_intent", daysAgo: 1 },
      ...Array.from({ length: 8 }, (_, index) => ({ type: "dashboard_view", daysAgo: Math.min(index + 1, 7) })),
    ],
  },
  {
    email: "pastdue.invoice@mimicpips.test",
    displayName: "Past Due Invoice",
    copyTradingEnabled: true,
    emailVerified: true,
    balance: 970,
    subscription: { status: "PAST_DUE", periodEndDays: -2 },
    invoice: true,
    trades: [{ pnl: 64.2, roi: 4.8, daysAgo: 9 }],
    events: [{ type: "billing_view", daysAgo: 1 }, { type: "dashboard_view", daysAgo: 1 }],
  },
  {
    email: "not.ready@mimicpips.test",
    displayName: "Not Ready Yet",
    copyTradingEnabled: false,
    emailVerified: false,
    balance: null,
    subscription: { status: "PENDING_PAYMENT", periodEndDays: null },
    noExchange: true,
    trades: [],
    events: [{ type: "profile_view", daysAgo: 2 }],
  },
  {
    email: "exchange.pendingpayment@mimicpips.test",
    displayName: "Exchange Connected Pending Payment",
    copyTradingEnabled: false,
    emailVerified: true,
    balance: 720,
    subscription: { status: "PENDING_PAYMENT", periodEndDays: null },
    trades: [],
    events: [{ type: "billing_view", daysAgo: 1 }, { type: "dashboard_view", daysAgo: 1 }],
  },
  {
    email: "active.noexchange@mimicpips.test",
    displayName: "Active Subscription No Exchange",
    copyTradingEnabled: false,
    emailVerified: true,
    balance: null,
    subscription: { status: "ACTIVE", periodEndDays: 18 },
    noExchange: true,
    trades: [],
    events: [{ type: "profile_view", daysAgo: 1 }, { type: "dashboard_view", daysAgo: 1 }],
  },
  {
    email: "exchange.nosubscription@mimicpips.test",
    displayName: "Exchange Connected No Subscription",
    copyTradingEnabled: false,
    emailVerified: true,
    balance: 650,
    noSubscription: true,
    trades: [],
    events: [{ type: "billing_view", daysAgo: 2 }, { type: "dashboard_view", daysAgo: 2 }],
  },
  {
    email: "active.pendinginvoice@mimicpips.test",
    displayName: "Active Subscription Pending Invoice",
    copyTradingEnabled: true,
    emailVerified: true,
    balance: 1360,
    subscription: { status: "ACTIVE", periodEndDays: 12 },
    invoice: true,
    trades: [{ pnl: 225.5, roi: 9.2, daysAgo: 5 }],
    events: [{ type: "billing_view", daysAgo: 1 }, { type: "dashboard_view", daysAgo: 1 }],
  },
  {
    email: "lowbalance.pause@mimicpips.test",
    displayName: "Low Balance Pause Risk",
    copyTradingEnabled: true,
    emailVerified: true,
    balance: 125,
    subscription: { status: "ACTIVE", periodEndDays: 14 },
    trades: [{ pnl: -18.2, roi: -2.1, daysAgo: 2 }],
    events: [{ type: "dashboard_view", daysAgo: 1 }, { type: "risk_settings_view", daysAgo: 1 }],
  }
];

function tradeDocs(userId, scenario) {
  const docs = [];
  scenario.trades.forEach((trade, index) => {
    const leaderTradeId = `SEED-${scenario.email}-${index + 1}`;
    docs.push({
      userId,
      leaderTradeId,
      action: "OPEN",
      leaderSymbol: index % 2 === 0 ? "BTC/USDT:USDT" : "ETH/USDT:USDT",
      leaderSide: index % 2 === 0 ? "LONG" : "SHORT",
      leaderNotional: 1000,
      leaderBalance: 10000,
      followerNotional: 100,
      followerOrderId: `seed-open-${index + 1}`,
      entryPrice: index % 2 === 0 ? 64200 : 3100,
      exitPrice: null,
      realizedPnl: 0,
      roiPercentage: 0,
      exchange: "binance",
      status: "executed",
      detail: null,
      executedAt: daysAgo(trade.daysAgo + 1),
      createdAt: daysAgo(trade.daysAgo + 1),
    });
    docs.push({
      userId,
      leaderTradeId,
      action: "CLOSE",
      leaderSymbol: index % 2 === 0 ? "BTC/USDT:USDT" : "ETH/USDT:USDT",
      leaderSide: index % 2 === 0 ? "LONG" : "SHORT",
      leaderNotional: 1000,
      leaderBalance: 10000,
      followerNotional: 100,
      followerOrderId: `seed-close-${index + 1}`,
      entryPrice: index % 2 === 0 ? 64200 : 3100,
      exitPrice: index % 2 === 0 ? 64650 : 3050,
      realizedPnl: trade.pnl,
      roiPercentage: trade.roi,
      exchange: "binance",
      status: "closed",
      detail: null,
      executedAt: daysAgo(trade.daysAgo),
      createdAt: daysAgo(trade.daysAgo),
    });
  });
  return docs;
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const passwordHash = await bcrypt.hash(password, 12);

  await db.collection("users").deleteMany({
    $or: [
      { email: { $exists: false } },
      { email: null },
      { email: "" },
    ],
  });

  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("exchange_keys").createIndex({ userId: 1 }, { unique: true }),
    db.collection("subscriptions").createIndex({ userId: 1 }, { unique: true }),
    db.collection("follower_behaviour_events").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("marketing_events").createIndex({ type: 1, createdAt: -1 }),
  ]);

  for (const scenario of scenarios) {
    if (!scenario.email || !scenario?.displayName) continue;
    const userResult = await db.collection("users").findOneAndUpdate(
      { email: scenario.email },
      {
        $set: {
          email: scenario.email,
          displayName: scenario?.displayName,
          role: "follower",
          passwordHash,
          copyTradingEnabled: scenario?.copyTradingEnabled,
          emailVerified: scenario.emailVerified,
          riskDisclosureAccepted: true,
          riskDisclosureVersion: "seed-test",
          riskDisclosureAcceptedAt: daysAgo(30),
          hasSeenOnboarding: true,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: daysAgo(35) },
      },
      { upsert: true, returnDocument: "after" }
    );
    const user = userResult.value;
    const userId = user?._id;

    await db.collection("copy_trade_log").deleteMany({ userId, leaderTradeId: /^SEED-/ });
    await db.collection("follower_behaviour_events").deleteMany({ userId });
    await db.collection("performance_fee_invoices").deleteMany({ userId, source: "seed" });

    if (scenario?.noExchange) {
      await db.collection("exchange_keys").deleteOne({ userId });
    } else {
      await db.collection("exchange_keys").updateOne(
        { userId },
        {
          $set: {
            userId,
            exchange: "binance",
            apiKeyEncrypted: { ciphertext: "seed-ciphertext", nonce: "seed-nonce" },
            apiSecretEncrypted: { ciphertext: "seed-ciphertext", nonce: "seed-nonce" },
            verifiedAt: daysAgo(20),
            lastKnownBalanceUSDT: scenario?.balance,
            lastBalanceCheckAt: daysAgo(1),
            updatedAt: now,
          },
          $setOnInsert: { createdAt: daysAgo(20) },
        },
        { upsert: true }
      );
    }

    if (scenario?.noSubscription) {
      await db.collection("subscriptions").deleteOne({ userId });
    } else {
      await db.collection("subscriptions").updateOne(
        { userId },
        {
          $set: {
            userId,
            status: scenario?.subscription.status,
            monthlyFeeNGN: 30000,
            paystackCustomerCode: "CUS_seed",
            paystackAuthorizationCode: "AUTH_seed",
            currentPeriodStart: scenario?.subscription.periodEndDays === null ? null : daysAgo(28),
            currentPeriodEnd: scenario?.subscription.periodEndDays === null ? null : daysFromNow(scenario?.subscription.periodEndDays),
            lastChargedAt: scenario?.subscription.status === "ACTIVE" ? daysAgo(28) : null,
            failedChargeCount: scenario?.subscription.status === "PAST_DUE" ? 2 : 0,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: daysAgo(35) },
        },
        { upsert: true }
      );
    }

    const trades = tradeDocs(userId, scenario);
    if (trades.length > 0) await db.collection("copy_trade_log").insertMany(trades);

    if (scenario?.events.length > 0) {
      await db.collection("follower_behaviour_events").insertMany(
        scenario?.events.map((event) => ({
          userId,
          type: event.type,
          metadata: { seed: true, scenario: scenario?.displayName },
          createdAt: daysAgo(event.daysAgo),
        }))
      );
    }

    if (scenario?.invoice) {
      await db.collection("performance_fee_invoices").insertOne({
        userId,
        periodStart: daysAgo(30),
        periodEnd: now,
        startBalanceUSD: 800,
        endBalanceUSD: 970,
        priorPeakBalanceUSD: 820,
        newPeakBalanceUSD: 970,
        profitAboveHighWaterMarkUSD: 150,
        feePercent: 0.3,
        feeAmountUSD: 45,
        usdToNgnRateAtInvoice: 1500,
        feeAmountNGN: 67500,
        status: "PENDING_APPROVAL",
        paystackReference: null,
        createdAt: daysAgo(1),
        updatedAt: now,
        paidAt: null,
        source: "seed",
      });
    }

    console.log(`Seeded ${scenario?.displayName}: ${scenario.email}`);
  }

  await db.collection("marketing_events").deleteMany({ source: "seed" });
  await db.collection("marketing_events").insertMany([
    {
      type: "crisis_averted",
      title: "Risk Guard held exposure during a sharp market selloff",
      summary: "BTC futures flushed hard, but Mimic Pips preserved discipline by keeping copied exposure controlled and avoiding emotional re-entry.",
      metricLabel: "Drawdown context",
      metricValue: "Bot -1.2% vs market -8.4%",
      audience: "public",
      source: "seed",
      createdAt: daysAgo(1),
    },
    {
      type: "monthly_gain_milestone",
      title: "Monthly system gain milestone reached",
      summary: "Mimic Pips crossed a fresh monthly performance milestone while keeping follower risk gates visible and enforceable.",
      metricLabel: "Monthly gain",
      metricValue: "+7.8%",
      audience: "public",
      source: "seed",
      createdAt: daysAgo(2),
    },
  ]);

  console.log(`\nDone. Test follower password: ${password}`);
  console.log("Open /dashboard/followers and /dashboard/marketing to review the seeded scenarios.");
  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

dotenv.config();
dotenv.config({ path: ".env.local" });

const uri = process.env.MONGO_URI || "mongodb://localhost:27017";
const dbName = process.env.SAAS_DB_NAME || "copytrade_saas";
const password = process.env.SEED_USER_PASSWORD || "TestPass123!";
const scenario = (process.env.MARKETING_AUTOMATION_SCENARIO || process.argv[2] || "").trim().toLowerCase();
const now = new Date();
const dayMs = 24 * 60 * 60 * 1000;

const scenarios = {
  monthly: {
    label: "Monthly gain milestone",
    email: "cron.monthly@mimicpips.test",
    displayName: "Cron Monthly Gain",
    copyTradingEnabled: true,
    balance: 2400,
    trades: [
      { pnl: 45, roi: 2.1, daysAgo: 12 },
      { pnl: 35, roi: 1.8, daysAgo: 18 },
      { pnl: 40, roi: 2.0, daysAgo: 24 },
    ],
    events: [],
    expected: "Triggers monthly_gain_milestone: 3 realized copied closes in 30 days with +$120 total PnL.",
  },
  recovery: {
    label: "Drawdown recovery",
    email: "cron.recovery@mimicpips.test",
    displayName: "Cron Drawdown Recovery",
    copyTradingEnabled: true,
    balance: 1850,
    trades: [
      { pnl: -22, roi: -1.4, daysAgo: 5 },
      { pnl: 48, roi: 2.8, daysAgo: 3 },
      { pnl: 19, roi: 1.2, daysAgo: 1 },
    ],
    events: [],
    expected: "Triggers drawdown_recovery: positive 7-day PnL with at least one losing close.",
  },
  riskguard: {
    label: "Risk Guard triggered",
    email: "cron.riskguard@mimicpips.test",
    displayName: "Cron Risk Guard",
    copyTradingEnabled: true,
    balance: 920,
    trades: [
      { pnl: 12, roi: 0.9, daysAgo: 10 },
    ],
    events: [
      { type: "risk_settings_view", daysAgo: 2 },
      { type: "support_intent", daysAgo: 2 },
      { type: "copy_trading_disabled", daysAgo: 1 },
    ],
    failures: [
      { status: "skipped_insufficient_balance", daysAgo: 1 },
    ],
    expected: "Triggers risk_guard_triggered: at least 3 risk actions or failed/skipped executions in 7 days.",
  },
  drawdown: {
    label: "Extended drawdown",
    email: "cron.drawdown@mimicpips.test",
    displayName: "Cron Extended Drawdown",
    copyTradingEnabled: true,
    balance: 760,
    trades: [
      { pnl: -55, roi: -4.1, daysAgo: 6 },
      { pnl: -38, roi: -2.9, daysAgo: 4 },
      { pnl: -42, roi: -3.3, daysAgo: 2 },
    ],
    events: [],
    expected: "Triggers extended_drawdown: at least 3 realized copied closes in 7 days with -$100 or worse total PnL.",
  },
  equity: {
    label: "New equity high style signal",
    email: "cron.equity@mimicpips.test",
    displayName: "Cron Equity Quality",
    copyTradingEnabled: true,
    balance: 3100,
    trades: [
      { pnl: 22, roi: 1.1, daysAgo: 9 },
      { pnl: 18, roi: 0.9, daysAgo: 11 },
      { pnl: 24, roi: 1.3, daysAgo: 13 },
      { pnl: 16, roi: 0.8, daysAgo: 15 },
      { pnl: -20, roi: -1.0, daysAgo: 17 },
    ],
    events: [],
    expected: "Triggers new_equity_high: at least one active follower, 5 realized copied closes in 30 days, win rate >= 60%.",
  },
};

function usage() {
  console.log("Choose one automation condition to seed:");
  console.log("  npm run seed:marketing:auto -- monthly");
  console.log("  npm run seed:marketing:auto -- recovery");
  console.log("  npm run seed:marketing:auto -- riskguard");
  console.log("  npm run seed:marketing:auto -- drawdown");
  console.log("  npm run seed:marketing:auto -- equity");
  console.log("\nOr set MARKETING_AUTOMATION_SCENARIO=monthly npm run seed:marketing:auto");
  console.log("\nNote: recovery and drawdown are intentionally seeded one at a time because the same 7-day aggregate PnL cannot be both positive and <= -$100.");
}

function daysAgo(days) {
  return new Date(now.getTime() - days * dayMs);
}

function daysFromNow(days) {
  return new Date(now.getTime() + days * dayMs);
}

function tradeDocs(userId, selected) {
  const docs = [];
  selected.trades.forEach((trade, index) => {
    const leaderTradeId = `AUTO-SEED-${scenario.toUpperCase()}-${index + 1}`;
    const symbol = index % 2 === 0 ? "BTC/USDT:USDT" : "ETH/USDT:USDT";
    const side = index % 2 === 0 ? "LONG" : "SHORT";
    docs.push({
      userId,
      leaderTradeId,
      action: "OPEN",
      leaderSymbol: symbol,
      leaderSide: side,
      leaderNotional: 2000,
      leaderBalance: 10000,
      followerNotional: 200,
      followerOrderId: `auto-seed-open-${scenario}-${index + 1}`,
      entryPrice: symbol.startsWith("BTC") ? 64200 : 3100,
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
      leaderSymbol: symbol,
      leaderSide: side,
      leaderNotional: 2000,
      leaderBalance: 10000,
      followerNotional: 200,
      followerOrderId: `auto-seed-close-${scenario}-${index + 1}`,
      entryPrice: symbol.startsWith("BTC") ? 64200 : 3100,
      exitPrice: symbol.startsWith("BTC") ? 64720 : 3040,
      realizedPnl: trade.pnl,
      roiPercentage: trade.roi,
      exchange: "binance",
      status: "closed",
      detail: null,
      executedAt: daysAgo(trade.daysAgo),
      createdAt: daysAgo(trade.daysAgo),
    });
  });

  (selected.failures || []).forEach((failure, index) => {
    docs.push({
      userId,
      leaderTradeId: `AUTO-SEED-${scenario.toUpperCase()}-FAIL-${index + 1}`,
      action: "OPEN",
      leaderSymbol: "SOL/USDT:USDT",
      leaderSide: "LONG",
      leaderNotional: 2000,
      leaderBalance: 10000,
      followerNotional: null,
      followerOrderId: null,
      entryPrice: null,
      exitPrice: null,
      realizedPnl: null,
      roiPercentage: null,
      exchange: "binance",
      status: failure.status,
      detail: "Seeded automation gate event",
      executedAt: null,
      createdAt: daysAgo(failure.daysAgo),
    });
  });

  return docs;
}

async function main() {
  if (!scenario || !scenarios[scenario]) {
    usage();
    process.exitCode = 1;
    return;
  }

  const selected = scenarios[scenario];
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const passwordHash = await bcrypt.hash(password, 12);

  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("exchange_keys").createIndex({ userId: 1 }, { unique: true }),
    db.collection("subscriptions").createIndex({ userId: 1 }, { unique: true }),
    db.collection("copy_trade_log").createIndex(
      { userId: 1, leaderTradeId: 1, action: 1 },
      { unique: true, partialFilterExpression: { leaderTradeId: { $type: "string" }, action: { $type: "string" } } }
    ).catch(() => null),
    db.collection("follower_behaviour_events").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("marketing_events").createIndex({ campaignKey: 1 }, { unique: true, sparse: true }),
    db.collection("marketing_send_logs").createIndex({ campaignKey: 1 }, { unique: true, sparse: true }),
  ]);

  const seededUsers = await db.collection("users").find({ email: /^cron\.(monthly|recovery|riskguard|drawdown|equity)@mimicpips\.test$/ }).project({ _id: 1 }).toArray();
  const seededUserIds = seededUsers.map((user) => user._id);

  await Promise.all([
    seededUserIds.length ? db.collection("copy_trade_log").deleteMany({ userId: { $in: seededUserIds } }) : Promise.resolve(),
    seededUserIds.length ? db.collection("follower_behaviour_events").deleteMany({ userId: { $in: seededUserIds } }) : Promise.resolve(),
    seededUserIds.length ? db.collection("exchange_keys").deleteMany({ userId: { $in: seededUserIds } }) : Promise.resolve(),
    seededUserIds.length ? db.collection("subscriptions").deleteMany({ userId: { $in: seededUserIds } }) : Promise.resolve(),
    seededUserIds.length ? db.collection("performance_fee_invoices").deleteMany({ userId: { $in: seededUserIds } }) : Promise.resolve(),
    db.collection("marketing_events").deleteMany({ source: "automation" }),
    db.collection("marketing_send_logs").deleteMany({ campaignKey: /^auto:/ }),
  ]);

  const updated = await db.collection("users").findOneAndUpdate(
    { email: selected.email },
    {
      $set: {
        email: selected.email,
        displayName: selected.displayName,
        role: "follower",
        passwordHash,
        copyTradingEnabled: selected.copyTradingEnabled,
        emailVerified: true,
        riskDisclosureAccepted: true,
        riskDisclosureVersion: "seed-automation-test",
        riskDisclosureAcceptedAt: daysAgo(30),
        hasSeenOnboarding: true,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: daysAgo(35) },
    },
    { upsert: true, returnDocument: "after" }
  );
  const user = updated.value || await db.collection("users").findOne({ email: selected.email });
  if (!user?._id) throw new Error("Seed user was not created.");

  await db.collection("exchange_keys").updateOne(
    { userId: user._id },
    {
      $set: {
        userId: user._id,
        exchange: "binance",
        apiKeyEncrypted: { ciphertext: "seed-ciphertext", nonce: "seed-nonce" },
        apiSecretEncrypted: { ciphertext: "seed-ciphertext", nonce: "seed-nonce" },
        verifiedAt: daysAgo(20),
        lastKnownBalanceUSDT: selected.balance,
        lastBalanceCheckAt: daysAgo(1),
        updatedAt: now,
      },
      $setOnInsert: { createdAt: daysAgo(20) },
    },
    { upsert: true }
  );

  await db.collection("subscriptions").updateOne(
    { userId: user._id },
    {
      $set: {
        userId: user._id,
        status: "ACTIVE",
        monthlyFeeNGN: 30000,
        paystackCustomerCode: "CUS_auto_seed",
        paystackAuthorizationCode: "AUTH_auto_seed",
        currentPeriodStart: daysAgo(8),
        currentPeriodEnd: daysFromNow(22),
        lastChargedAt: daysAgo(8),
        failedChargeCount: 0,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: daysAgo(35) },
    },
    { upsert: true }
  );

  const trades = tradeDocs(user._id, selected);
  if (trades.length > 0) await db.collection("copy_trade_log").insertMany(trades, { ordered: false });

  if (selected.events.length > 0) {
    await db.collection("follower_behaviour_events").insertMany(
      selected.events.map((event) => ({
        userId: user._id,
        type: event.type,
        metadata: { seed: true, automationSeed: true, scenario },
        createdAt: daysAgo(event.daysAgo),
      }))
    );
  }

  await client.close();

  console.log(`Seeded: ${selected.label}`);
  console.log(`User: ${selected.email}`);
  console.log(`Password: ${password}`);
  console.log(selected.expected);
  console.log("\nTo test locally:");
  console.log("  npm run dev");
  console.log("  npm run worker    # waits for the configured cron schedule");
  console.log("\nFor an immediate local check, use the operator Run automation scan button or POST /api/cron/marketing-automation with your CRON_SECRET.");
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});

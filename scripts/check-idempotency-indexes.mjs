import * as dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: ".env.local" });
dotenv.config();

const uri = process.env.MONGO_URI || "mongodb://localhost:27017";
const dbName = process.env.SAAS_DB_NAME || "copytrade_saas";

const checks = [
  {
    collection: "subscriptions",
    label: "subscription paystackReference",
    match: { paystackReference: { $type: "string", $ne: "" } },
    groupId: { paystackReference: "$paystackReference" },
  },
  {
    collection: "performance_fee_invoices",
    label: "performance-fee paystackReference",
    match: { paystackReference: { $type: "string", $ne: "" } },
    groupId: { paystackReference: "$paystackReference" },
  },
  {
    collection: "marketing_events",
    label: "marketing event campaignKey",
    match: { campaignKey: { $type: "string", $ne: "" } },
    groupId: { campaignKey: "$campaignKey" },
  },
  {
    collection: "marketing_send_logs",
    label: "marketing send campaignKey",
    match: { campaignKey: { $type: "string", $ne: "" } },
    groupId: { campaignKey: "$campaignKey" },
  },
  {
    collection: "copy_trade_log",
    label: "copy-trade user/leader/action",
    match: {
      userId: { $exists: true },
      leaderTradeId: { $type: "string", $ne: "" },
      action: { $type: "string", $ne: "" },
    },
    groupId: { userId: "$userId", leaderTradeId: "$leaderTradeId", action: "$action" },
  },
];

async function findDuplicates(db, check) {
  return db.collection(check.collection).aggregate([
    { $match: check.match },
    {
      $group: {
        _id: check.groupId,
        count: { $sum: 1 },
        ids: { $push: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]).toArray();
}

async function main() {
  const client = new MongoClient(uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  await client.connect();
  const db = client.db(dbName);
  let failed = false;

  try {
    for (const check of checks) {
      const duplicates = await findDuplicates(db, check);
      if (duplicates.length === 0) {
        console.log(`[OK] ${check.label}: no duplicates found.`);
        continue;
      }

      failed = true;
      console.log(`[DUPLICATES] ${check.label}: ${duplicates.length} duplicate key group(s) found.`);
      for (const duplicate of duplicates) {
        console.log(JSON.stringify({
          key: duplicate._id,
          count: duplicate.count,
          ids: duplicate.ids.map((id) => id.toString()),
        }));
      }
    }
  } finally {
    await client.close();
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown idempotency check failure.");
  process.exit(1);
});

import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getSaasDb } from "@/lib/saasDb";
import { decryptSecret } from "@/lib/exchangeKeyCrypto";
import { fetchCurrentBalance } from "@/lib/billingJobs";
import type { ExchangeKeyDoc } from "@/lib/saasTypes";

/**
 * Fetches every connected follower's CURRENT balance live from the
 * exchange and updates lastKnownBalanceUSDT — the followers table
 * otherwise only shows whatever balance was captured at key-connection
 * time (or the last billing run), which goes stale fast. This is a
 * manual, on-demand refresh rather than something that runs on every
 * page load, since it's N live exchange calls (real latency, real
 * rate-limit exposure) — the operator triggers it when they actually
 * want current numbers, not implicitly on every visit to the page.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const valid = token ? await verifySessionToken(token) : false;
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getSaasDb();
  const keyDocs = await db
    .collection<ExchangeKeyDoc>("exchange_keys")
    .find({ verifiedAt: { $ne: null } })
    .toArray();

  let updated = 0;
  let failed = 0;

  for (const keyDoc of keyDocs) {
    try {
      const apiKey = await decryptSecret(keyDoc.apiKeyEncrypted);
      const apiSecret = await decryptSecret(keyDoc.apiSecretEncrypted);
      const balance = await fetchCurrentBalance(apiKey, apiSecret);

      if (balance !== null) {
        await db.collection<ExchangeKeyDoc>("exchange_keys").updateOne(
          { _id: keyDoc._id },
          { $set: { lastKnownBalanceUSDT: balance, lastBalanceCheckAt: new Date() } }
        );
        updated++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, updated, failed, total: keyDocs.length });
}
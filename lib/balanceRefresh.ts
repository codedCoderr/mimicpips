import { getSaasDb } from "@/lib/saasDb";
import { decryptSecret } from "@/lib/exchangeKeyCrypto";
import { fetchCurrentBalance } from "@/lib/billingJobs";
import type { ExchangeKeyDoc } from "@/lib/saasTypes";

export interface BalanceRefreshResult {
  total: number;
  attempted: number;
  updated: number;
  failed: number;
  /** Verified keys not reached this run (cap hit). Picked up next run. */
  remaining: number;
}

/**
 * Refresh followers' stored lastKnownBalanceUSDT from the live exchange.
 *
 * That snapshot is not just a display value. The billing cron pauses a
 * follower when it drops below the pause balance and gates activation on it,
 * and the copy-trading toggle checks it too. Left to a manual operator
 * button it went four weeks stale on a real account (showing ~$4,997 when
 * the live balance was ~$3,996).
 *
 * Each refresh is a live exchange round trip through the bot, so this is
 * bounded: the most-stale keys go first, and at most `limit` are attempted
 * per run. Anything not reached is picked up next run instead of risking a
 * serverless timeout. A failed fetch leaves the old snapshot untouched
 * (never overwrites a number with null or zero).
 */
export async function refreshFollowerBalances(options?: {
  limit?: number;
  now?: Date;
}): Promise<BalanceRefreshResult> {
  const limit = Math.max(1, options?.limit ?? 25);
  const now = options?.now ?? new Date();
  const db = await getSaasDb();

  const keys = await db
    .collection<ExchangeKeyDoc>("exchange_keys")
    .find({ verifiedAt: { $ne: null } })
    .toArray();

  // Never-checked first, then oldest check first.
  const ordered = [...keys].sort((a, b) => {
    const at = a.lastBalanceCheckAt ? new Date(a.lastBalanceCheckAt).getTime() : 0;
    const bt = b.lastBalanceCheckAt ? new Date(b.lastBalanceCheckAt).getTime() : 0;
    return at - bt;
  });

  const batch = ordered.slice(0, limit);
  let updated = 0;
  let failed = 0;

  for (const keyDoc of batch) {
    try {
      const apiKey = await decryptSecret(keyDoc.apiKeyEncrypted);
      const apiSecret = await decryptSecret(keyDoc.apiSecretEncrypted);
      const balance = await fetchCurrentBalance(apiKey, apiSecret);

      if (balance === null || !Number.isFinite(balance)) {
        failed += 1;
        continue;
      }
      await db.collection<ExchangeKeyDoc>("exchange_keys").updateOne(
        { _id: keyDoc._id },
        { $set: { lastKnownBalanceUSDT: balance, lastBalanceCheckAt: now } }
      );
      updated += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    total: keys.length,
    attempted: batch.length,
    updated,
    failed,
    remaining: Math.max(0, keys.length - batch.length),
  };
}

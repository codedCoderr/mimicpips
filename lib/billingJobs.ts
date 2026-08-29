import { getSaasDb } from "./saasDb";
import { calculatePerformanceFee } from "./performanceFee";
import { chargeSavedAuthorization } from "./paystack";
import { getUsdToNgnRate } from "./exchangeRate";
import type {
  UserDoc,
  ExchangeKeyDoc,
  SubscriptionDoc,
  HighWaterMarkDoc,
  PerformanceFeeInvoiceDoc,
} from "./saasTypes";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { getErrorMessage } from "./errorMessage";

const PERFORMANCE_FEE_PERCENT = 0.3;
const PERIOD_DAYS = 30;

interface BotVerifyResponse {
  verified: boolean;
  reason: string | null;
  balanceUSDT: number | null;
}

/**
 * Fetches a follower's CURRENT exchange balance via the bot server — not
 * the stale lastKnownBalanceUSDT snapshot from whenever they connected
 * their key. Reuses the bot's verify-key endpoint since it already does
 * exactly this (fetch balance + confirm the key still works), rather
 * than duplicating CCXT credential handling in a second endpoint.
 */
export async function fetchCurrentBalance (
  apiKeyDecrypted: string,
  apiSecretDecrypted: string
): Promise<number | null> {
  const botUrl = process.env.BOT_SERVER_URL;
  const serviceKey = process.env.SAAS_SERVICE_KEY;
  if ( !botUrl || !serviceKey ) {
    throw new Error( "BOT_SERVER_URL / SAAS_SERVICE_KEY not configured." );
  }

  const res = await fetch( `${ botUrl.replace( /\/+$/, "" ) }/api/saas/verify-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Service-Key": serviceKey },
    body: JSON.stringify( { apiKey: apiKeyDecrypted, apiSecret: apiSecretDecrypted } ),
  } );

  if ( !res.ok ) return null;
  const data: BotVerifyResponse = await res.json();
  return data.verified ? data.balanceUSDT : null;
}

export interface PerformanceFeeRunResult {
  userId: string;
  outcome:
  | "invoice_created"
  | "no_fee_owed"
  | "skipped_not_enabled"
  | "skipped_balance_unavailable"
  | "skipped_pending_payment"
  | "skipped_already_billed"
  | "error";
  detail?: string;
}

/**
 * Runs the performance-fee calculation for every follower with copy
 * trading enabled. Does NOT charge anything automatically — creates a
 * PENDING_APPROVAL invoice that the follower must review and approve
 * (see the "manual invoice" decision in /areas/futures-trading-bot.md —
 * an unpredictable, variable-amount charge is a real dispute risk if
 * auto-charged without the follower seeing the number first).
 */
export async function runPerformanceFeeBillingCycle (): Promise<PerformanceFeeRunResult[]> {
  const { decryptSecret } = await import( "./exchangeKeyCrypto" );

  const db = await getSaasDb();
  const results: PerformanceFeeRunResult[] = [];

  const enabledUsers = await db
    .collection<UserDoc>( "users" )
    .find( { role: "follower", copyTradingEnabled: true } )
    .toArray();

  const now = new Date();
  const periodStart = new Date( now.getFullYear(), now.getMonth(), 1 );
  const periodEnd = new Date( now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999 );

  for ( const user of enabledUsers ) {
    const userId = user._id!;
    try {
      // 1. Guard Check: Skip if follower has an existing unpaid invoice
      const pendingInvoice = await db
        .collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" )
        .findOne( {
          userId,
          status: { $in: [ "PENDING_APPROVAL", "APPROVED" ] },
        } );

      if ( pendingInvoice ) {
        results.push( {
          userId: userId.toString(),
          outcome: "skipped_pending_payment",
          detail: `Follower has an unpaid invoice of ₦${ pendingInvoice.feeAmountNGN.toLocaleString() }.`,
        } );
        continue;
      }

      // 2. Guard Check: Skip if an invoice was already issued for this billing period
      const periodInvoice = await db
        .collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" )
        .findOne( {
          userId,
          periodStart: { $gte: periodStart, $lte: periodEnd },
        } );

      if ( periodInvoice ) {
        results.push( {
          userId: userId.toString(),
          outcome: "skipped_already_billed",
          detail: "Invoice already generated for the current billing period.",
        } );
        continue;
      }

      const keyDoc = await db
        .collection<ExchangeKeyDoc>( "exchange_keys" )
        .findOne( { userId } );

      if ( !keyDoc?.verifiedAt ) {
        results.push( { userId: userId.toString(), outcome: "skipped_not_enabled" } );
        continue;
      }

      const apiKey = await decryptSecret( keyDoc.apiKeyEncrypted );
      const apiSecret = await decryptSecret( keyDoc.apiSecretEncrypted );
      const currentBalance = await fetchCurrentBalance( apiKey, apiSecret );

      if ( currentBalance === null ) {
        results.push( {
          userId: userId.toString(),
          outcome: "skipped_balance_unavailable",
          detail: "Could not fetch current balance from the exchange.",
        } );
        continue;
      }

      const hwm = await db
        .collection<HighWaterMarkDoc>( "high_water_marks" )
        .findOne( { userId } );

      if ( !hwm ) {
        await db.collection<HighWaterMarkDoc>( "high_water_marks" ).insertOne( {
          userId,
          peakBalanceUSD: currentBalance,
          peakSetAt: now,
          createdAt: now,
          updatedAt: now,
        } );
        results.push( {
          userId: userId.toString(),
          outcome: "no_fee_owed",
          detail: "First cycle — high-water mark established.",
        } );
        continue;
      }

      const priorPeak = hwm.peakBalanceUSD;

      const calc = calculatePerformanceFee(
        priorPeak,
        currentBalance,
        priorPeak,
        PERFORMANCE_FEE_PERCENT
      );

      if ( !calc.feeOwed ) {
        results.push( { userId: userId.toString(), outcome: "no_fee_owed" } );
        continue;
      }

      const usdToNgnRate = getUsdToNgnRate();
      const feeAmountNGN = calc.feeAmountUSD * usdToNgnRate;

      try {
        await db.collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" ).insertOne( {
        userId,
        periodStart,
        periodEnd: now,
        startBalanceUSD: calc.startBalanceUSD,
        endBalanceUSD: calc.endBalanceUSD,
        priorPeakBalanceUSD: calc.priorPeakBalanceUSD,
        newPeakBalanceUSD: calc.newPeakBalanceUSD,
        profitAboveHighWaterMarkUSD: calc.profitAboveHighWaterMarkUSD,
        feePercent: PERFORMANCE_FEE_PERCENT,
        feeAmountUSD: calc.feeAmountUSD,
        usdToNgnRateAtInvoice: usdToNgnRate,
        feeAmountNGN,
        status: "PENDING_APPROVAL",
        paystackReference: null,
        createdAt: now,
        updatedAt: now,
        paidAt: null,
        } );
      } catch (err: unknown) {
        if (isMongoDuplicateKeyError(err)) {
          results.push({
            userId: userId.toString(),
            outcome: "skipped_already_billed",
            detail: "Invoice already generated for the current billing period.",
          });
          continue;
        }
        throw err;
      }

      results.push( { userId: userId.toString(), outcome: "invoice_created" } );
    } catch ( err: unknown ) {
      results.push( { userId: userId.toString(), outcome: "error", detail: getErrorMessage(err, "Performance fee billing failed.") } );
    }
  }

  return results;
}

export interface SubscriptionRenewalResult {
  userId: string;
  outcome: "charged" | "not_due" | "no_authorization" | "charge_failed" | "subscription_expired";
  detail?: string;
}

/**
 * Charges every subscription whose currentPeriodEnd has passed, using
 * their saved Paystack authorization — no checkout page, fully
 * automatic, appropriate here since the amount is fixed and known in
 * advance (unlike the performance fee).
 */
const MAX_RETRIES = 3;

export async function runSubscriptionRenewalCycle (): Promise<SubscriptionRenewalResult[]> {
  const db = await getSaasDb();
  const results: SubscriptionRenewalResult[] = [];
  const now = new Date();

  // Query both due ACTIVE subscriptions and retryable PAST_DUE subscriptions
  const dueSubscriptions = await db
    .collection<SubscriptionDoc>( "subscriptions" )
    .find( {
      $or: [
        { status: "ACTIVE", currentPeriodEnd: { $lte: now } },
        { status: "PAST_DUE", failedChargeCount: { $lt: MAX_RETRIES } },
      ],
    } )
    .toArray();

  for ( const sub of dueSubscriptions ) {
    const reference = `SUB-PAY-${ sub.userId }-${ randomUUID().slice( 0, 8 ) }`;
    const claimed = await db.collection<SubscriptionDoc>( "subscriptions" ).findOneAndUpdate(
      {
        _id: sub._id,
        status: sub.status,
        failedChargeCount: sub.failedChargeCount,
        $or: [
          { status: "ACTIVE", currentPeriodEnd: { $lte: now } },
          { status: "PAST_DUE", failedChargeCount: { $lt: MAX_RETRIES } },
        ],
      },
      { $set: { status: "RENEWING", updatedAt: now } },
      { returnDocument: "after" }
    );

    if (!claimed) {
      results.push({ userId: sub.userId.toString(), outcome: "not_due" });
      continue;
    }

    if ( !sub.paystackAuthorizationCode ) {
      await db.collection<SubscriptionDoc>( "subscriptions" ).updateOne(
        { _id: sub._id, status: "RENEWING" },
        { $set: { status: "PAST_DUE", updatedAt: now } }
      );
      results.push( { userId: sub.userId.toString(), outcome: "no_authorization" } );
      continue;
    }

    const user = await db.collection<UserDoc>( "users" ).findOne( { _id: sub.userId } );
    if ( !user ) continue;

    try {
      const charge = await chargeSavedAuthorization( {
        email: user.email,
        amountNGN: sub.monthlyFeeNGN,
        authorizationCode: sub.paystackAuthorizationCode,
        reference,
      } );

      if ( charge.status === "success" ) {
        const newPeriodEnd = new Date( now );
        newPeriodEnd.setDate( newPeriodEnd.getDate() + PERIOD_DAYS );

        await db.collection<SubscriptionDoc>( "subscriptions" ).updateOne(
          { _id: sub._id },
          {
            $set: {
              currentPeriodStart: now,
              currentPeriodEnd: newPeriodEnd,
              lastChargedAt: now,
              failedChargeCount: 0,
              status: "ACTIVE",
              updatedAt: now,
            },
          }
        );
        results.push( { userId: sub.userId.toString(), outcome: "charged" } );
      } else {
        await processFailedPayment( db, sub, now, charge.status, results );
      }
    } catch ( err: unknown ) {
      await processFailedPayment( db, sub, now, getErrorMessage(err, "Subscription renewal charge failed."), results );
    }
  }

  return results;
}

async function processFailedPayment (
  db: Db,
  sub: SubscriptionDoc,
  now: Date,
  errorDetail: string,
  results: SubscriptionRenewalResult[]
) {
  const currentFails = sub.failedChargeCount ?? 0;
  const newFailCount = currentFails + 1;
  const shouldExpire = newFailCount >= MAX_RETRIES;
  const nextStatus = shouldExpire ? "EXPIRED" : "PAST_DUE";

  await db.collection( "subscriptions" ).updateOne(
    { _id: sub._id },
    {
      $set: {
        status: nextStatus,
        updatedAt: now,
      },
      $inc: { failedChargeCount: 1 },
    }
  );

  results.push( {
    userId: sub.userId.toString(),
    outcome: shouldExpire ? "subscription_expired" : "charge_failed",
    detail: errorDetail,
  } );
}

function isMongoDuplicateKeyError(err: unknown): err is { code: 11000 } {
  return typeof err === "object" && err !== null && "code" in err && err.code === 11000;
}

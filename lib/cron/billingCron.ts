import cron from "node-cron";
import { ObjectId } from "mongodb";
import { getSaasDb } from "@/lib/saasDb";
import { runPerformanceFeeBillingCycle, runSubscriptionRenewalCycle } from "@/lib/billingJobs";
import { runRetentionEmailCycle } from "@/lib/retentionEmails";
import { runMarketingAutomationCycle } from "@/lib/marketingAutomation";
import {
  getCopyTradeMinActivationBalanceUSDT,
  getCopyTradePauseBalanceUSDT,
} from "@/lib/copyTradeSizing";
import type { UserDoc, SubscriptionDoc, PerformanceFeeInvoiceDoc, ExchangeKeyDoc, PerformanceFeeInvoiceStatus } from "@/lib/saasTypes";

const UNPAID_INVOICE_STATUSES: PerformanceFeeInvoiceStatus[] = [ "PENDING_APPROVAL", "APPROVED" ];

/**
 * 1. Email Reminders for Upcoming Subscription Renewals
 */
async function sendSubscriptionReminders () {
  const db = await getSaasDb();
  const now = new Date();

  const targetDateStart = new Date( now );
  targetDateStart.setDate( targetDateStart.getDate() + 3 );
  targetDateStart.setHours( 0, 0, 0, 0 );

  const targetDateEnd = new Date( targetDateStart );
  targetDateEnd.setHours( 23, 59, 59, 999 );

  const upcomingSubscriptions = await db
    .collection<SubscriptionDoc>( "subscriptions" )
    .find( {
      status: "ACTIVE",
      currentPeriodEnd: { $gte: targetDateStart, $lte: targetDateEnd },
    } )
    .toArray();

  for ( const sub of upcomingSubscriptions ) {
    const user = await db.collection<UserDoc>( "users" ).findOne( { _id: sub.userId } );
    if ( user?.email ) {
      console.log( `[Reminder Email] Sending 3-day renewal notice for user ${ sub.userId.toString() }` );
    }
  }
}

/**
 * 2. Gate Enforcement: Disables copy trading for active followers if:
 * - Email is unverified
 * - Subscription status is not ACTIVE
 * - Has any pending/unpaid performance fee invoice
 * - Available balance is below the runtime pause floor
 */
export async function enforceCopyTradingGates () {
  const db = await getSaasDb();
  const now = new Date();
  const pauseBalanceUSDT = getCopyTradePauseBalanceUSDT();

  const activeFollowers = await db
    .collection<UserDoc>( "users" )
    .find( {
      role: { $regex: /^follower$/i },
      copyTradingEnabled: true,
    } )
    .toArray();

  if ( activeFollowers.length === 0 ) {
    return { disabledCount: 0, disabledUserIds: [] };
  }

  const userIds = activeFollowers.map( ( u ) => u._id! );

  const [ keyDocs, subDocs, pendingInvoices ] = await Promise.all( [
    db
      .collection<ExchangeKeyDoc>( "exchange_keys" )
      .find( { userId: { $in: userIds }, verifiedAt: { $ne: null } } )
      .toArray(),
    db
      .collection<SubscriptionDoc>( "subscriptions" )
      .find( { userId: { $in: userIds } } )
      .toArray(),
    db
      .collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" )
      .find( {
        userId: { $in: userIds },
        status: { $in: UNPAID_INVOICE_STATUSES },
      } )
      .toArray(),
  ] );

  const keyByUser = new Map( keyDocs.map( ( k ) => [ k.userId.toString(), k ] ) );
  const subByUser = new Map( subDocs.map( ( s ) => [ s.userId.toString(), s ] ) );
  const pendingInvoiceUserIds = new Set( pendingInvoices.map( ( inv ) => inv.userId.toString() ) );

  const disabledUserIds: ObjectId[] = [];

  for ( const user of activeFollowers ) {
    const userIdStr = user._id!.toString();
    const key = keyByUser.get( userIdStr );
    const sub = subByUser.get( userIdStr );

    const isUnverified = !user.emailVerified;
    const hasNoVerifiedKey = !key;
    const isBelowPauseBalance = Number( key?.lastKnownBalanceUSDT ?? 0 ) < pauseBalanceUSDT;
    const isSubNonActive = !sub || sub.status !== "ACTIVE";
    const hasPendingInvoice = pendingInvoiceUserIds.has( userIdStr );

    if ( isUnverified || hasNoVerifiedKey || isBelowPauseBalance || isSubNonActive || hasPendingInvoice ) {
      disabledUserIds.push( user._id! );
    }
  }

  if ( disabledUserIds.length > 0 ) {
    await db.collection<UserDoc>( "users" ).updateMany(
      { _id: { $in: disabledUserIds } },
      { $set: { copyTradingEnabled: false, updatedAt: now } }
    );
  }

  return {
    disabledCount: disabledUserIds.length,
    disabledUserIds: disabledUserIds.map( ( id ) => id.toString() ),
  };
}

/**
 * 3. Auto-Enable Gates: Checks inactive followers and turns ON copy trading 
 * if all 4 conditions are satisfied.
 */
export async function autoEnableCopyTradingGates () {
  const db = await getSaasDb();
  const now = new Date();
  const minActivationBalanceUSDT = getCopyTradeMinActivationBalanceUSDT();

  const inactiveFollowers = await db
    .collection<UserDoc>( "users" )
    .find( {
      role: { $regex: /^follower$/i },
      copyTradingEnabled: false,
      emailVerified: true,
    } )
    .toArray();

  if ( inactiveFollowers.length === 0 ) {
    return { enabledCount: 0, enabledUserIds: [] };
  }

  const userIds = inactiveFollowers.map( ( u ) => u._id! );

  const [ keyDocs, subDocs, pendingInvoices ] = await Promise.all( [
    db
      .collection<ExchangeKeyDoc>( "exchange_keys" )
      .find( { userId: { $in: userIds }, verifiedAt: { $ne: null } } )
      .toArray(),
    db
      .collection<SubscriptionDoc>( "subscriptions" )
      .find( { userId: { $in: userIds }, status: "ACTIVE" } )
      .toArray(),
    db
      .collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" )
      .find( {
        userId: { $in: userIds },
        status: { $in: UNPAID_INVOICE_STATUSES },
      } )
      .toArray(),
  ] );

  const keyByUser = new Map( keyDocs.map( ( k ) => [ k.userId.toString(), k ] ) );
  const activeSubUserIds = new Set( subDocs.map( ( s ) => s.userId.toString() ) );
  const pendingInvoiceUserIds = new Set( pendingInvoices.map( ( inv ) => inv.userId.toString() ) );

  const enabledUserIds: ObjectId[] = [];

  for ( const user of inactiveFollowers ) {
    const userIdStr = user._id!.toString();
    const key = keyByUser.get( userIdStr );

    const hasVerifiedExchange = !!key;
    const hasActivationBalance = Number( key?.lastKnownBalanceUSDT ?? 0 ) >= minActivationBalanceUSDT;
    const hasActiveSub = activeSubUserIds.has( userIdStr );
    const hasNoPendingInvoice = !pendingInvoiceUserIds.has( userIdStr );

    if ( hasVerifiedExchange && hasActivationBalance && hasActiveSub && hasNoPendingInvoice ) {
      enabledUserIds.push( user._id! );
    }
  }

  if ( enabledUserIds.length > 0 ) {
    await db.collection<UserDoc>( "users" ).updateMany(
      { _id: { $in: enabledUserIds } },
      { $set: { copyTradingEnabled: true, updatedAt: now } }
    );
  }

  return {
    enabledCount: enabledUserIds.length,
    enabledUserIds: enabledUserIds.map( ( id ) => id.toString() ),
  };
}

const globalForCron = globalThis as unknown as { billingCronInitialized?: boolean };

/**
 * Main Cron Initialization
 */
export function initBillingCron () {
  if ( globalForCron.billingCronInitialized ) {
    return;
  }
  globalForCron.billingCronInitialized = true;

  // Run gate sync sequentially every minute
  // cron.schedule( "* * * * *", async () => {
  //   try {
  //     const enforcement = await enforceCopyTradingGates();
  //     if ( enforcement.disabledCount > 0 ) {
  //       console.log( `⚠️ [Cron] Disabled copy trading for ${ enforcement.disabledCount } follower(s).` );
  //     }

  //     const autoEnable = await autoEnableCopyTradingGates();
  //     if ( autoEnable.enabledCount > 0 ) {
  //       console.log( `🚀 [Cron] Auto-enabled copy trading for ${ autoEnable.enabledCount } follower(s).` );
  //     }
  //   } catch ( err ) {
  //     console.error( "❌ [Cron] Per-minute gate sync failed:", err );
  //   }
  // } );

  // Marketing signal scanner every 30 minutes. It creates deduped proof points and
  // sends to the signal channel only when AUTO_TELEGRAM_MARKETING=true.
  cron.schedule( "*/30 * * * *", async () => {
    try {
      const results = await runMarketingAutomationCycle();
      const sent = results.filter( ( result ) => result.outcome === "telegram_sent" ).length;
      const created = results.filter( ( result ) => result.outcome === "created" ).length;
      if ( sent > 0 || created > 0 ) {
        console.log( `[Cron] Marketing automation created ${ created } signal(s), sent ${ sent } Telegram post(s).` );
      }
    } catch ( err ) {
      console.error( "❌ [Cron] Marketing signal scanner failed:", err );
    }
  } );

  // Daily reminders at 08:00 AM WAT
  cron.schedule( "0 8 * * *", async () => {
    try {
      await sendSubscriptionReminders();
      const retentionResults = await runRetentionEmailCycle();
      const sentCount = retentionResults.filter( ( result ) => result.outcome === "sent" ).length;
      if ( sentCount > 0 ) {
        console.log( `[Cron] Sent ${ sentCount } retention email(s).` );
      }
    } catch ( err ) {
      console.error( "❌ [Cron] Daily reminder check failed:", err );
    }
  } );

  // Monthly billing run on 1st day of month at midnight
  cron.schedule( "0 0 1 * *", async () => {
    try {
      await runSubscriptionRenewalCycle();
      await runPerformanceFeeBillingCycle();
      await enforceCopyTradingGates();
    } catch ( err ) {
      console.error( "❌ [Cron] Monthly billing run failed:", err );
    }
  } );

  console.log( "📅 Billing cron scheduler initialized." );
}

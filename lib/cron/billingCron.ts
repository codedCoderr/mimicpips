import cron from "node-cron";
import { ObjectId } from "mongodb";
import { getSaasDb } from "@/lib/saasDb";
import { runPerformanceFeeBillingCycle, runSubscriptionRenewalCycle } from "@/lib/billingJobs";
import type { UserDoc, SubscriptionDoc, PerformanceFeeInvoiceDoc, ExchangeKeyDoc } from "@/lib/saasTypes";

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
      console.log( `[Reminder Email] Sending 3-day renewal notice to ${ user.email }` );
    }
  }
}

/**
 * 2. Gate Enforcement: Disables copy trading for active followers if:
 * - Email is not verified
 * - Has NO active subscription
 * - Has pending/unpaid performance fee invoices
 */
export async function enforceCopyTradingGates () {
  const db = await getSaasDb();
  const now = new Date();

  const activeFollowers = await db
    .collection<UserDoc>( "users" )
    .find( { role: "follower", copyTradingEnabled: true } )
    .toArray();
  console.log( activeFollowers );
  if ( activeFollowers.length === 0 ) {
    return { disabledCount: 0, disabledUserIds: [] };
  }

  const userIds = activeFollowers.map( ( u ) => u._id! );

  // Fetch only ACTIVE subscriptions to prevent old expired ones from overwriting the check
  const [ activeSubDocs, pendingInvoices ] = await Promise.all( [
    db
      .collection<SubscriptionDoc>( "subscriptions" )
      .find( { userId: { $in: userIds }, status: "ACTIVE" } )
      .toArray(),
    db
      .collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" )
      .find( {
        userId: { $in: userIds },
        status: { $in: [ "PENDING_APPROVAL", "APPROVED" ] },
      } )
      .toArray(),
  ] );

  const activeSubUserIds = new Set( activeSubDocs.map( ( s ) => s.userId.toString() ) );
  const pendingInvoiceUserIds = new Set( pendingInvoices.map( ( inv ) => inv.userId.toString() ) );

  const disabledUserIds: ObjectId[] = [];

  for ( const user of activeFollowers ) {
    const userIdStr = user._id!.toString();

    const isUnverified = !user.emailVerified;
    const noActiveSub = !activeSubUserIds.has( userIdStr );
    const hasPendingInvoice = pendingInvoiceUserIds.has( userIdStr );

    if ( isUnverified || noActiveSub || hasPendingInvoice ) {
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


const globalForCron = globalThis as unknown as { billingCronInitialized?: boolean };

/**
 * Main Cron Initialization
 */
export function initBillingCron () {
  // Prevent duplicate execution tasks during local dev HMR reloads
  if ( globalForCron.billingCronInitialized ) {
    return;
  }
  globalForCron.billingCronInitialized = true;

  // 1. Every minute: Run Gate Checks Sequentially (Enforce OFF first, then Auto-Enable ON)
  cron.schedule( "* * * * *", async () => {
    try {
      // Step A: Revoke copy trading for users who lost active status or accrued pending invoices
      const enforcement = await enforceCopyTradingGates();
      if ( enforcement.disabledCount > 0 ) {
        console.log( `⚠️ [Cron] Disabled copy trading for ${ enforcement.disabledCount } follower(s).` );
      }

      // Step B: Auto-enable copy trading for followers meeting all 4 conditions
      const autoEnable = await autoEnableCopyTradingGates();
      if ( autoEnable.enabledCount > 0 ) {
        console.log( `🚀 [Cron] Auto-enabled copy trading for ${ autoEnable.enabledCount } follower(s).` );
      }
    } catch ( err ) {
      console.error( "❌ [Cron] Per-minute gate sync failed:", err );
    }
  } );

  // 2. Daily at 08:00 AM WAT: Send upcoming subscription email reminders
  cron.schedule( "0 8 * * *", async () => {
    console.log( "⏰ [Cron] Running daily subscription email reminders..." );
    try {
      await sendSubscriptionReminders();
      console.log( "✅ [Cron] Renewal reminders processed." );
    } catch ( err ) {
      console.error( "❌ [Cron] Daily email reminder check failed:", err );
    }
  } );

  // 3. Monthly on the 1st day of the month at midnight (00:00 WAT): Charge renewals & performance fees
  cron.schedule( "0 0 1 * *", async () => {
    console.log( "💳 [Cron] Running monthly subscription renewal & performance fee billing cycle..." );
    try {
      const renewalResults = await runSubscriptionRenewalCycle();
      const performanceFeeResults = await runPerformanceFeeBillingCycle();

      const enforcement = await enforceCopyTradingGates();

      console.log(
        `✅ [Cron] Monthly billing run complete. Renewals: ${ renewalResults.length }, Performance Fees: ${ performanceFeeResults.length }, Disabled: ${ enforcement.disabledCount }`
      );
    } catch ( err ) {
      console.error( "❌ [Cron] Monthly billing run failed:", err );
    }
  } );

  console.log( "📅 Billing cron scheduler initialized." );
}

/**
 * 3. Auto-Enable Gates: Checks inactive followers and turns ON copy trading 
 * if all 4 conditions are satisfied.
 */
export async function autoEnableCopyTradingGates () {
  const db = await getSaasDb();
  const now = new Date();

  // Find followers who currently have copy trading disabled but email is verified
  const inactiveFollowers = await db
    .collection<UserDoc>( "users" )
    .find( { role: "follower", copyTradingEnabled: false, emailVerified: true } )
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
        status: { $in: [ "PENDING_APPROVAL", "APPROVED" ] },
      } )
      .toArray(),
  ] );

  const verifiedKeysUserIds = new Set( keyDocs.map( ( k ) => k.userId.toString() ) );
  const activeSubUserIds = new Set( subDocs.map( ( s ) => s.userId.toString() ) );
  const pendingInvoiceUserIds = new Set( pendingInvoices.map( ( inv ) => inv.userId.toString() ) );

  const enabledUserIds: ObjectId[] = [];

  for ( const user of inactiveFollowers ) {
    const userIdStr = user._id!.toString();

    const hasVerifiedExchange = verifiedKeysUserIds.has( userIdStr );
    const hasActiveSub = activeSubUserIds.has( userIdStr );
    const hasNoPendingInvoice = !pendingInvoiceUserIds.has( userIdStr );

    // All 4 conditions met (emailVerified is guaranteed by the initial query)
    if ( hasVerifiedExchange && hasActiveSub && hasNoPendingInvoice ) {
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

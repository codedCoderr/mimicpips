import type { SubscriptionDoc } from "@/lib/saasTypes";

/**
 * Is this subscription genuinely active right now, for copy-trading gate
 * purposes — not just "was it marked ACTIVE the last time something wrote
 * to it".
 *
 * status only flips away from "ACTIVE" when runSubscriptionRenewalCycle
 * actually runs (the billing cron, documented as a monthly schedule). A
 * subscription whose currentPeriodEnd has already passed but that hasn't
 * been processed by that cron yet still has status "ACTIVE" in the
 * database — checking status alone lets a lapsed subscription look active
 * for as long as the gap between billing cron runs, which on a monthly
 * schedule can be weeks. currentPeriodEnd is checked directly here so a
 * lapsed period is caught immediately, everywhere this is called from,
 * independent of whether the billing cron has run yet.
 *
 * "RENEWING" is deliberately treated as active despite currentPeriodEnd
 * having passed (that's exactly why it's renewing) — a renewal charge is
 * in flight for this subscription right now, and this check must not
 * punish a follower for the very process that's trying to fix their
 * expired period.
 *
 * This is the core, type-agnostic version (plain status string + Date):
 * used directly by client-side code, which only has JSON-serialized
 * subscription data (ISO date strings, already parsed into Date before
 * calling this). isSubscriptionActiveForGates below is the server-side
 * convenience wrapper over this for code that already holds a
 * SubscriptionDoc straight from Mongo.
 */
export function isSubscriptionStatusActive(
  status: string | null | undefined,
  currentPeriodEnd: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!status) return false;
  if (status === "RENEWING") return true;
  if (status !== "ACTIVE") return false;
  if (currentPeriodEnd != null && currentPeriodEnd <= now) return false;
  return true;
}

/**
 * Server-side convenience wrapper over isSubscriptionStatusActive for code
 * that already holds a SubscriptionDoc straight from Mongo (Date objects,
 * not ISO strings).
 *
 * Used by the copy-trading enable/status API (app/api/saas/copy-trading/
 * route.ts), the copy-trade follower-selection query (lib/copyTradeWorker.ts),
 * the gate-sync cron (lib/cron/billingCron.ts), and the operator followers
 * list (app/dashboard/followers/page.tsx's API data) — previously several
 * separate, drifting copies of the same `status === "ACTIVE"` check, none
 * of which caught a lapsed-but-unprocessed period.
 */
export function isSubscriptionActiveForGates(
  sub: SubscriptionDoc | null | undefined,
  now: Date = new Date()
): boolean {
  if (!sub) return false;
  return isSubscriptionStatusActive(sub.status, sub.currentPeriodEnd, now);
}

/**
 * Is a PENDING_PAYMENT (or RENEWING) subscription row stale enough to be
 * reclaimed by a new subscribe attempt?
 *
 * Nothing else ever clears a PENDING_PAYMENT row — only a successful
 * Paystack webhook moves it to ACTIVE. If the user closes the checkout
 * tab, the payment fails silently, or the webhook never arrives, the row
 * stays PENDING_PAYMENT permanently, and without this check every future
 * subscribe attempt is rejected as "already pending" with no way out.
 *
 * Returns false for a status this doesn't apply to (ACTIVE, EXPIRED,
 * etc.) — callers combine this with their own status check; it is not a
 * replacement for one.
 */
export function isPendingPaymentReclaimable(
  status: string | null | undefined,
  updatedAt: Date | null | undefined,
  staleAfterMs: number,
  now: Date = new Date()
): boolean {
  if (status !== "PENDING_PAYMENT" && status !== "RENEWING") return false;
  if (!updatedAt) return true; // no timestamp to judge by — treat as stale rather than stuck forever
  // Strict >, matching the route's Mongo condition
  // (updatedAt < now - staleAfterMs, i.e. strictly older than the cutoff).
  return now.getTime() - updatedAt.getTime() > staleAfterMs;
}

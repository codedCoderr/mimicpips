import type { SubscriptionDoc } from "@/lib/saasTypes";

/**
 * Is this subscription genuinely active right now, for copy-trading gate
 * purposes — not just "was it marked ACTIVE the last time something wrote
 * to it".
 *
 * sub.status only flips away from "ACTIVE" when runSubscriptionRenewalCycle
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
 * Used by both the copy-trading enable/status API (app/api/saas/
 * copy-trading/route.ts) and the gate-sync cron (lib/cron/billingCron.ts)
 * — previously two separate, drifting copies of the same `status ===
 * "ACTIVE"` check, neither of which caught a lapsed-but-unprocessed period.
 */
export function isSubscriptionActiveForGates(
  sub: SubscriptionDoc | null | undefined,
  now: Date = new Date()
): boolean {
  if (!sub) return false;
  if (sub.status === "RENEWING") return true;
  if (sub.status !== "ACTIVE") return false;
  if (sub.currentPeriodEnd !== null && sub.currentPeriodEnd <= now) return false;
  return true;
}

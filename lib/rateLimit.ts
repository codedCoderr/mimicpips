/**
 * Simple in-memory rate limiting, matching the pattern used by the
 * operator login route — resets on server restart, which is an accepted
 * trade-off for a single-instance deployment. If this ever runs behind
 * multiple instances, swap for the bot's Redis-backed checkRateLimit
 * (see the bot repo's events/broker.ts for that pattern).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function isRateLimited(
  key: string,
  maxAttempts: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > maxAttempts;
}
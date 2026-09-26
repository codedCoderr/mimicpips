/**
 * Simple in-memory rate limiting, matching the pattern used by the
 * operator login route — resets on server restart, which is an accepted
 * trade-off for a single-instance deployment. If this ever runs behind
 * multiple instances, swap for the bot's Redis-backed checkRateLimit
 * (see the bot repo's events/broker.ts for that pattern).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Records an attempt against key and returns whether this attempt has
 * pushed the count over maxAttempts. Used where every request to an
 * endpoint should count as an attempt (signup, resend-verification,
 * connect-exchange) — each call both records and checks in one step.
 */
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

/**
 * Read-only check: is this key already over its limit, based on
 * attempts recorded so far — without recording a new one. Use this to
 * reject a request up front (e.g. before running a slow bcrypt.compare)
 * without the check itself counting as an attempt. Pair with
 * recordFailedAttempt, called only once the real failure is confirmed,
 * so legitimate repeated use (retrying after a genuine typo, multiple
 * devices) isn't double-counted between the peek and the real event.
 */
export function isCurrentlyLimited(key: string, maxAttempts: number): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= maxAttempts;
}

/**
 * Records one confirmed failed attempt against key (e.g. a wrong
 * password), creating or extending its window as needed. Call this only
 * from the branch where a failure has already happened — pair with
 * isCurrentlyLimited beforehand to reject fast without recording an
 * extra attempt for the rejection itself.
 */
export function recordFailedAttempt(
  key: string,
  windowMs: number
): void {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count += 1;
}

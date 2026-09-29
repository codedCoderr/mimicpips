/**
 * Shared, persistent rate limiting backed by MongoDB (rate_limit_buckets,
 * TTL-indexed on resetAt — see saasDb.ts).
 *
 * This replaced an in-process `Map`. That worked for a single long-lived
 * server, but this app runs on Amplify's serverless Next.js compute: each
 * invocation can land on a different, possibly cold instance with its own
 * empty map, so a limit meant to trigger after N attempts could in practice
 * allow N attempts per instance. Login and signup abuse checks need to hold
 * regardless of which instance handles a given request, so the bucket lives
 * in the same database every instance already shares.
 *
 * Concurrency: findOneAndUpdate's $inc is atomic in MongoDB, so two
 * simultaneous requests for the same key are still correctly counted (one
 * becomes attempt N, the other N+1) rather than a plain read-then-write
 * race where both could read the same pre-increment count.
 */
import { getSaasDb as defaultGetSaasDb } from "@/lib/saasDb";
import type { Db } from "mongodb";

/**
 * Test seam. Production code never sets this; tests swap in a fake so the
 * rate-limit logic (and its concurrency behavior) can be exercised without
 * a real MongoDB connection.
 */
export const _deps = { getSaasDb: defaultGetSaasDb as () => Promise<Db> };

interface RateLimitBucketDoc {
  _id: string;
  count: number;
  resetAt: Date;
}

const COLLECTION = "rate_limit_buckets";

/**
 * Records an attempt against key and returns whether this attempt has
 * pushed the count over maxAttempts. Used where every request to an
 * endpoint should count as an attempt (signup, resend-verification,
 * connect-exchange) — each call both records and checks in one step.
 */
export async function isRateLimited(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<boolean> {
  const db = await _deps.getSaasDb();
  const collection = db.collection<RateLimitBucketDoc>(COLLECTION);
  const now = new Date();

  // Try to bump the count on a live (non-expired) bucket first. This is
  // separate from the upsert below because a single findOneAndUpdate
  // cannot both "increment if unexpired" and "reset to 1 if expired or
  // absent" — those are different starting values for the same field.
  const bumped = await collection.findOneAndUpdate(
    { _id: key, resetAt: { $gt: now } },
    { $inc: { count: 1 } },
    { returnDocument: "after" }
  );
  if (bumped) return bumped.count > maxAttempts;

  // No live bucket found above (expired, or genuinely the first attempt
  // for this key). Start a fresh window with an upsert. $setOnInsert
  // means only the FIRST of any concurrent callers actually creates the
  // document — every other concurrent caller's upsert is a no-op match
  // against the doc the winner just created.
  //
  // Reading the result back separately (a plain findOne) instead of
  // re-attempting the $inc below was the bug this comment replaced: N
  // concurrent callers hitting a brand-new key ALL miss the findOneAndUpdate
  // above (no doc exists yet), ALL reach this upsert, but only one is the
  // upsert's actual insert — the other N-1 are the "already exists, matched,
  // did nothing" case. A subsequent findOne then has every one of those N
  // callers read the SAME just-inserted count (1) and report "not limited",
  // regardless of N. The fix is for every loser of the upsert race to fall
  // through to the same atomic $inc used above, so it is counted rather
  // than merely observed.
  const upsertResult = await collection.updateOne(
    { _id: key, resetAt: { $lte: now } },
    { $setOnInsert: { count: 1, resetAt: new Date(now.getTime() + windowMs) } },
    { upsert: true }
  );
  if (upsertResult.upsertedCount > 0) {
    // This call performed the actual insert: it is attempt 1.
    return 1 > maxAttempts;
  }

  // Someone else's insert won the race (or, less likely, this is a plain
  // "the doc was created between our findOneAndUpdate and here" case).
  // Either way, THIS call must still register as an attempt against the
  // now-live bucket, via the same atomic increment as the fast path.
  const counted = await collection.findOneAndUpdate(
    { _id: key, resetAt: { $gt: now } },
    { $inc: { count: 1 } },
    { returnDocument: "after" }
  );
  // counted should always be non-null here (the bucket that just won the
  // upsert race is, by definition, live); the fallback exists only so a
  // truly pathological interleaving (the window expiring between the
  // upsert and this read) fails safe as "allowed" rather than throwing.
  return (counted?.count ?? 1) > maxAttempts;
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
export async function isCurrentlyLimited(key: string, maxAttempts: number): Promise<boolean> {
  const db = await _deps.getSaasDb();
  const entry = await db
    .collection<RateLimitBucketDoc>(COLLECTION)
    .findOne({ _id: key, resetAt: { $gt: new Date() } });
  return (entry?.count ?? 0) >= maxAttempts;
}

/**
 * Records one confirmed failed attempt against key (e.g. a wrong
 * password), creating or extending its window as needed. Call this only
 * from the branch where a failure has already happened — pair with
 * isCurrentlyLimited beforehand to reject fast without recording an
 * extra attempt for the rejection itself.
 */
export async function recordFailedAttempt(key: string, windowMs: number): Promise<void> {
  const db = await _deps.getSaasDb();
  const collection = db.collection<RateLimitBucketDoc>(COLLECTION);
  const now = new Date();

  const bumped = await collection.findOneAndUpdate(
    { _id: key, resetAt: { $gt: now } },
    { $inc: { count: 1 } }
  );
  if (bumped) return;

  // Same race as isRateLimited above: of several concurrent callers that
  // all miss the live bucket above, only one's upsert actually inserts —
  // the rest must still record their attempt via $inc, or that attempt is
  // silently dropped entirely (undercounting real failed login attempts).
  const upsertResult = await collection.updateOne(
    { _id: key, resetAt: { $lte: now } },
    { $setOnInsert: { count: 1, resetAt: new Date(now.getTime() + windowMs) } },
    { upsert: true }
  );
  if (upsertResult.upsertedCount > 0) return; // this call's own insert already recorded it as attempt 1

  await collection.findOneAndUpdate(
    { _id: key, resetAt: { $gt: now } },
    { $inc: { count: 1 } }
  );
}

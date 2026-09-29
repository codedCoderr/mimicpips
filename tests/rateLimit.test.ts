import test from "node:test";
import assert from "node:assert/strict";

/**
 * These tests run against a fake Mongo collection, NOT a real mongod —
 * this sandbox's network policy blocks the binary download
 * mongodb-memory-server needs (fastdl.mongodb.org), so a real-server test
 * could not run here. Anyone with real MongoDB access should prefer
 * re-pointing MONGO_URI at a real instance (or reinstating
 * mongodb-memory-server) and rerunning this file unchanged — every test
 * below only calls the public lib/rateLimit.ts functions, nothing here is
 * fake-specific.
 *
 * What this DOES prove: the interleaving below runs each fake operation
 * through a real setImmediate/await boundary, so a LOGIC race in
 * rateLimit.ts — e.g. reverting to a plain findOne-then-updateOne instead
 * of the atomic findOneAndUpdate($inc) — is caught, because that pattern
 * has a genuine window between the two operations for one call to observe
 * the other's stale pre-write value.
 *
 * What this does NOT prove: real MongoDB server-side atomicity itself
 * (that $inc really does serialize at the storage engine level). That is
 * a guarantee of MongoDB, not of this code, and isn't something a fake can
 * demonstrate either way.
 */


class FakeRateLimitCollection {
  private docs = new Map<string, { count: number; resetAt: Date }>();

  async findOneAndUpdate(filter: any, update: any, opts: any = {}) {
    // Yield first — this is what makes the interleaving test meaningful:
    // without it, sequential `await`s in a single-threaded fake would
    // never actually interleave two "concurrent" calls.
    await new Promise((r) => setImmediate(r));

    const doc = this.docs.get(filter._id);
    const matchesResetAt =
      filter.resetAt?.$gt !== undefined
        ? !!doc && doc.resetAt.getTime() > filter.resetAt.$gt.getTime()
        : filter.resetAt?.$lte !== undefined
        ? !!doc && doc.resetAt.getTime() <= filter.resetAt.$lte.getTime()
        : true;
    if (!doc || !matchesResetAt) return null;

    if (update.$inc?.count) doc.count += update.$inc.count;
    if (opts.returnDocument === "after") return { ...doc };
    return { ...doc };
  }

  async updateOne(filter: any, update: any, opts: any = {}) {
    await new Promise((r) => setImmediate(r));
    const existing = this.docs.get(filter._id);
    const isExpiredOrAbsent =
      !existing || (filter.resetAt?.$lte !== undefined && existing.resetAt.getTime() <= filter.resetAt.$lte.getTime());

    if (existing && !isExpiredOrAbsent) return { matchedCount: 1 };
    if (!opts.upsert) return { matchedCount: 0 };
    if (!this.docs.has(filter._id) || isExpiredOrAbsent) {
      // $setOnInsert must not clobber a doc a concurrent call just created —
      // re-check right before writing (still after the yield above, so two
      // callers racing here is exactly the scenario under test).
      if (!this.docs.has(filter._id) || (this.docs.get(filter._id)!.resetAt.getTime() <= (filter.resetAt?.$lte ?? Infinity))) {
        this.docs.set(filter._id, { ...update.$setOnInsert });
      }
    }
    return { matchedCount: 0, upsertedCount: 1 };
  }

  async findOne(filter: any) {
    await new Promise((r) => setImmediate(r));
    const doc = this.docs.get(filter._id);
    if (!doc) return null;
    if (filter.resetAt?.$gt !== undefined && !(doc.resetAt.getTime() > filter.resetAt.$gt.getTime())) return null;
    return { ...doc };
  }
}

function installFake(deps: typeof import("../lib/rateLimit")._deps) {
  const collection = new FakeRateLimitCollection();
  const fakeDb = { collection: () => collection } as any;
  deps.getSaasDb = async () => fakeDb;
}

async function importRateLimit() {
  const mod = await import("../lib/rateLimit");
  installFake(mod._deps);
  return mod;
}

test("isRateLimited: allows up to maxAttempts, blocks the next one", async () => {
  const { isRateLimited } = await importRateLimit();
  const key = `t1-${Date.now()}`;
  const results: boolean[] = [];
  for (let i = 0; i < 4; i++) results.push(await isRateLimited(key, 3, 60_000));
  assert.deepEqual(results, [false, false, false, true]);
});

test("isRateLimited: an expired window starts fresh rather than carrying its count forward", async () => {
  const { isRateLimited } = await importRateLimit();
  const key = `t2-${Date.now()}`;
  const r1 = await isRateLimited(key, 1, -1000);
  const r2 = await isRateLimited(key, 1, -1000);
  assert.equal(r1, false);
  assert.equal(r2, false);
});

test("isRateLimited: concurrent requests against the same key are all correctly counted", async () => {
  const { isRateLimited } = await importRateLimit();
  const key = `concurrent-${Date.now()}`;
  const maxAttempts = 5;
  const totalRequests = 20;

  const results = await Promise.all(
    Array.from({ length: totalRequests }, () => isRateLimited(key, maxAttempts, 60_000))
  );

  const allowed = results.filter((r) => r === false).length;
  const blocked = results.filter((r) => r === true).length;
  assert.equal(allowed, maxAttempts, `exactly ${maxAttempts} of ${totalRequests} concurrent attempts should be let through`);
  assert.equal(blocked, totalRequests - maxAttempts, "a lost update would let more than maxAttempts through");
});

test("isCurrentlyLimited: false before any attempts, true at maxAttempts, and peeking doesn't itself count", async () => {
  const { isRateLimited, isCurrentlyLimited } = await importRateLimit();
  const key = `t4-${Date.now()}`;
  assert.equal(await isCurrentlyLimited(key, 2), false);
  await isRateLimited(key, 2, 60_000);
  assert.equal(await isCurrentlyLimited(key, 2), false);
  await isRateLimited(key, 2, 60_000);
  assert.equal(await isCurrentlyLimited(key, 2), true);
  await isCurrentlyLimited(key, 2);
  await isCurrentlyLimited(key, 2);
  assert.equal(await isCurrentlyLimited(key, 2), true, "peeking must not change the outcome");
});

test("recordFailedAttempt: accumulates and trips isCurrentlyLimited at the threshold", async () => {
  const { isCurrentlyLimited, recordFailedAttempt } = await importRateLimit();
  const key = `t5-${Date.now()}`;
  assert.equal(await isCurrentlyLimited(key, 3), false);
  await recordFailedAttempt(key, 60_000);
  await recordFailedAttempt(key, 60_000);
  assert.equal(await isCurrentlyLimited(key, 3), false);
  await recordFailedAttempt(key, 60_000);
  assert.equal(await isCurrentlyLimited(key, 3), true);
});

test("recordFailedAttempt: concurrent failures against the same key are not lost", async () => {
  const { isCurrentlyLimited, recordFailedAttempt } = await importRateLimit();
  const key = `t6-${Date.now()}`;
  const n = 15;
  await Promise.all(Array.from({ length: n }, () => recordFailedAttempt(key, 60_000)));
  assert.equal(await isCurrentlyLimited(key, n), true);
});

test("login-shaped scenario: distinct keys (per-IP, per-account) don't interfere", async () => {
  const { isRateLimited, isCurrentlyLimited, recordFailedAttempt } = await importRateLimit();
  const ipKey = `login:ip:1.2.3.4-${Date.now()}`;
  const accountKey = `login:acct:someone@example.com-${Date.now()}`;

  await isRateLimited(ipKey, 10, 60_000);
  await recordFailedAttempt(accountKey, 60_000);

  assert.equal(await isCurrentlyLimited(ipKey, 10), false, "the IP bucket must be unaffected by the account bucket");
  assert.equal(await isCurrentlyLimited(accountKey, 1), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { isSubscriptionActiveForGates } from "../lib/subscriptionGates";
import type { SubscriptionDoc } from "../lib/saasTypes";

function sub(over: Partial<SubscriptionDoc>): SubscriptionDoc {
  return {
    status: "ACTIVE",
    currentPeriodEnd: null,
    ...over,
  } as SubscriptionDoc;
}

test("null/undefined subscription is never active", () => {
  assert.equal(isSubscriptionActiveForGates(null), false);
  assert.equal(isSubscriptionActiveForGates(undefined), false);
});

test("ACTIVE with no currentPeriodEnd set is active", () => {
  assert.equal(isSubscriptionActiveForGates(sub({ status: "ACTIVE", currentPeriodEnd: null })), true);
});

test("ACTIVE with a currentPeriodEnd in the future is active", () => {
  const future = new Date(Date.now() + 86400_000);
  assert.equal(isSubscriptionActiveForGates(sub({ status: "ACTIVE", currentPeriodEnd: future })), true);
});

test("THE BUG: ACTIVE status but currentPeriodEnd already passed is NOT active (status alone used to be trusted)", () => {
  const past = new Date(Date.now() - 86400_000);
  assert.equal(
    isSubscriptionActiveForGates(sub({ status: "ACTIVE", currentPeriodEnd: past })),
    false,
    "a lapsed period must be caught even though status hasn't been flipped by the billing cron yet"
  );
});

test("RENEWING is active even with a lapsed currentPeriodEnd (a renewal charge is in flight)", () => {
  const past = new Date(Date.now() - 86400_000);
  assert.equal(isSubscriptionActiveForGates(sub({ status: "RENEWING", currentPeriodEnd: past })), true);
});

for (const status of ["PENDING_PAYMENT", "PAST_DUE", "EXPIRED", "CANCELLED"] as const) {
  test(`${status} is never active, regardless of currentPeriodEnd`, () => {
    assert.equal(isSubscriptionActiveForGates(sub({ status, currentPeriodEnd: null })), false);
    assert.equal(isSubscriptionActiveForGates(sub({ status, currentPeriodEnd: new Date(Date.now() + 86400_000) })), false);
  });
}

test("a currentPeriodEnd exactly equal to now is treated as lapsed (inclusive boundary)", () => {
  const now = new Date();
  assert.equal(isSubscriptionActiveForGates(sub({ status: "ACTIVE", currentPeriodEnd: now }), now), false);
});

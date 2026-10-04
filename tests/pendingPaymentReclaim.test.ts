import test from "node:test";
import assert from "node:assert/strict";
import { isPendingPaymentReclaimable } from "../lib/subscriptionGates";

const STALE_MS = 30 * 60 * 1000;

test("THE STUCK-CHECKOUT REGRESSION: an old PENDING_PAYMENT is reclaimable", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const updatedAt = new Date(now.getTime() - 40 * 60 * 1000); // 40 min ago
  assert.equal(isPendingPaymentReclaimable("PENDING_PAYMENT", updatedAt, STALE_MS, now), true);
});

test("a recent PENDING_PAYMENT (checkout genuinely in progress) is NOT reclaimable", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const updatedAt = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
  assert.equal(isPendingPaymentReclaimable("PENDING_PAYMENT", updatedAt, STALE_MS, now), false);
});

test("exactly at the staleness boundary is NOT YET reclaimable (strict >, matches the route's Mongo $lt condition)", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const updatedAt = new Date(now.getTime() - STALE_MS);
  assert.equal(isPendingPaymentReclaimable("PENDING_PAYMENT", updatedAt, STALE_MS, now), false);
});

test("one millisecond past the boundary is reclaimable", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const updatedAt = new Date(now.getTime() - STALE_MS - 1);
  assert.equal(isPendingPaymentReclaimable("PENDING_PAYMENT", updatedAt, STALE_MS, now), true);
});

test("RENEWING follows the same staleness rule as PENDING_PAYMENT", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const old = new Date(now.getTime() - STALE_MS - 1000);
  const recent = new Date(now.getTime() - 1000);
  assert.equal(isPendingPaymentReclaimable("RENEWING", old, STALE_MS, now), true);
  assert.equal(isPendingPaymentReclaimable("RENEWING", recent, STALE_MS, now), false);
});

test("ACTIVE, EXPIRED, PAST_DUE, CANCELLED are never reclaimable by this check, regardless of age", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const ancient = new Date(now.getTime() - 365 * 86_400_000);
  for (const status of ["ACTIVE", "EXPIRED", "PAST_DUE", "CANCELLED"]) {
    assert.equal(
      isPendingPaymentReclaimable(status, ancient, STALE_MS, now),
      false,
      `${status} must not be treated as a reclaimable pending payment`
    );
  }
});

test("a PENDING_PAYMENT with no updatedAt at all is treated as stale (never leaves a user stuck forever)", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  assert.equal(isPendingPaymentReclaimable("PENDING_PAYMENT", null, STALE_MS, now), true);
  assert.equal(isPendingPaymentReclaimable("PENDING_PAYMENT", undefined, STALE_MS, now), true);
});

test("null/undefined status is never reclaimable", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const old = new Date(now.getTime() - STALE_MS - 1000);
  assert.equal(isPendingPaymentReclaimable(null, old, STALE_MS, now), false);
  assert.equal(isPendingPaymentReclaimable(undefined, old, STALE_MS, now), false);
});

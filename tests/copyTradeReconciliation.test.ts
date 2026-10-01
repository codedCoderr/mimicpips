import test from "node:test";
import assert from "node:assert/strict";
import { isPossiblyLiveOpenStatus } from "../lib/copyTradeReconciliation";
import type { CopyTradeLogStatus } from "../lib/saasTypes";

test("isPossiblyLiveOpenStatus: executed, processing, and failed are all possibly-live (the PHB regression)", () => {
  // "failed" is the one that matters most here: this is the exact status
  // an OPEN row gets when the entry filled but a bracket order failed —
  // a real, unprotected position on the exchange that the ORIGINAL logic
  // (status === "executed" only) never flagged for reconciliation at all.
  assert.equal(isPossiblyLiveOpenStatus("executed"), true);
  assert.equal(isPossiblyLiveOpenStatus("processing"), true);
  assert.equal(isPossiblyLiveOpenStatus("failed"), true);
});

test("isPossiblyLiveOpenStatus: every skipped_* status is NOT possibly-live (nothing was ever placed)", () => {
  const skipped: CopyTradeLogStatus[] = [
    "skipped_insufficient_balance",
    "skipped_not_verified",
    "skipped_copy_trading_disabled",
    "skipped_duplicate",
    "skipped_subscription_inactive",
    "skipped_pending_invoice",
    "skipped_balance_unavailable",
  ];
  for (const status of skipped) {
    assert.equal(isPossiblyLiveOpenStatus(status), false, `${status} should never trigger an open_without_close check`);
  }
});

test("isPossiblyLiveOpenStatus: closed is not possibly-live (it already has its matching close)", () => {
  assert.equal(isPossiblyLiveOpenStatus("closed"), false);
});

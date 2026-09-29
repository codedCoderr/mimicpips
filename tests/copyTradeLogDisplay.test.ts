import test from "node:test";
import assert from "node:assert/strict";
import {
  isAlreadyClosedDetail,
  isPnlOnlyCloseFailure,
  isResolvedStaleOpenDetail,
  calculateClosedPnlFromPrices,
} from "../lib/copyTradeLogDisplay";
import type { CopyTradeLogResponseDoc } from "../lib/copyTradeLogDisplay";

// ---------------------------------------------------------------------
// isPnlOnlyCloseFailure: the ONLY gate that may upgrade a "failed" CLOSE
// row to look like a successful close on the dashboard. This is the fix:
// it used to be "any failed CLOSE we can compute a price for", which
// silently hid real close failures. Every real failure message the bot
// actually writes must come back false here.
// ---------------------------------------------------------------------

test("isPnlOnlyCloseFailure: true only for the one documented case", () => {
  assert.equal(
    isPnlOnlyCloseFailure(
      "Closed outside the bot (manual close on the exchange or a missed close event). Confirmed flat on the exchange by reconciliation. Realized PnL not recorded."
    ),
    true
  );
});

test("isPnlOnlyCloseFailure: false for every real close-failure message the bot writes (the bug this fixes)", () => {
  const realFailureMessages = [
    "No verified exchange key on file — could not close mirrored position.",
    "Could not connect to follower's exchange account while closing — key may have been revoked.",
    "Could not read the follower's positions, so the position was NOT closed: ETIMEDOUT",
    "Close failed: exchange 503",
    "Close failed: ReduceOnly Order is rejected",
  ];
  for (const detail of realFailureMessages) {
    assert.equal(
      isPnlOnlyCloseFailure(detail),
      false,
      `"${detail}" must NOT be treated as a successful close — the follower's position may still be open`
    );
  }
});

test("isPnlOnlyCloseFailure: false for null, undefined, and empty detail", () => {
  assert.equal(isPnlOnlyCloseFailure(null), false);
  assert.equal(isPnlOnlyCloseFailure(undefined), false);
  assert.equal(isPnlOnlyCloseFailure(""), false);
});

test("isAlreadyClosedDetail vs isPnlOnlyCloseFailure: distinct, not interchangeable", () => {
  // "already flat" (an OPEN-side / repeated-close detail) must not also
  // satisfy the CLOSE-status-upgrade gate — they answer different questions.
  assert.equal(isAlreadyClosedDetail("Follower was already flat when the leader close event arrived."), true);
  assert.equal(isPnlOnlyCloseFailure("Follower was already flat when the leader close event arrived."), false);
});

test("isResolvedStaleOpenDetail: only matches the exact reconciliation phrase", () => {
  assert.equal(isResolvedStaleOpenDetail("Reconciliation marked this stale open claim as failed."), true);
  assert.equal(isResolvedStaleOpenDetail("Entry order failed: rejected"), false);
  assert.equal(isResolvedStaleOpenDetail(null), false);
});

// ---------------------------------------------------------------------
// End-to-end on the shape route.ts actually builds: given a bot-written
// "failed" CLOSE row plus leader prices, the row must remain
// unresolved (effectiveStatus stays "failed") for a real failure, and
// only resolves for the reconciliation case.
// ---------------------------------------------------------------------

function computeEffectiveStatus(e: CopyTradeLogResponseDoc, entryPrice: number, exitPrice: number, notional: number) {
  const priceBasedClose = calculateClosedPnlFromPrices(e, entryPrice, exitPrice, notional);
  const closeResolvedFromPrices = e.action === "CLOSE" && !!priceBasedClose && isPnlOnlyCloseFailure(e.detail);
  let effectiveStatus: string = e.status || "SUCCESS";
  if (closeResolvedFromPrices && e.status === "failed") effectiveStatus = "closed";
  return effectiveStatus;
}

test("regression: a genuine close failure with recoverable leader prices stays 'failed', not 'closed'", () => {
  // This is exactly the BANK/PHB-shaped case: leader prices ARE available
  // (so calculateClosedPnlFromPrices succeeds), but the bot's own status
  // says the follower's close genuinely failed. Before the fix, having a
  // price was enough by itself to relabel this as "Closed".
  const row: CopyTradeLogResponseDoc = {
    action: "CLOSE",
    status: "failed",
    detail: "Could not read the follower's positions, so the position was NOT closed: ETIMEDOUT",
    leaderSymbol: "BANK/USDT:USDT",
    leaderSide: "LONG",
  } as CopyTradeLogResponseDoc;

  assert.equal(
    computeEffectiveStatus(row, /* entryPrice */ 0.0342, /* exitPrice */ 0.0333, /* notional */ 500),
    "failed",
    "a real close failure must still show as 'Needs attention', even when leader prices are available"
  );
});

test("the reconciliation PnL-only case still resolves to 'closed'", () => {
  const row: CopyTradeLogResponseDoc = {
    action: "CLOSE",
    status: "failed",
    detail:
      "Closed outside the bot (manual close on the exchange or a missed close event). Confirmed flat on the exchange by reconciliation. Realized PnL not recorded.",
    leaderSymbol: "PHB/USDT:USDT",
    leaderSide: "LONG",
  } as CopyTradeLogResponseDoc;

  assert.equal(computeEffectiveStatus(row, 0.0048, 0.0046, 500), "closed");
});

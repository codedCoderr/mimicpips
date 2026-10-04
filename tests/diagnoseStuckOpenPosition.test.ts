import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseStuckOpenPosition } from "../lib/copyTradeLogDisplay";

test("leader's position still exists: diagnosed as 'leader hasn't actually closed'", () => {
  const result = diagnoseStuckOpenPosition(true, "flat");
  assert.match(result, /not actually closed yet/);
});

test("cannot determine leader's position (null): diagnosed as a connectivity issue", () => {
  const result = diagnoseStuckOpenPosition(null, "flat");
  assert.match(result, /Could not reach the bot's own database/);
});

test("leader closed, follower confirmed still open: diagnosed as 'reconciliation would close it'", () => {
  const result = diagnoseStuckOpenPosition(false, "open");
  assert.match(result, /follower is STILL confirmed open/);
});

test("leader closed, follower check unknown: diagnosed as blocking, with the reason included", () => {
  const result = diagnoseStuckOpenPosition(false, "unknown", "ETIMEDOUT");
  assert.match(result, /exchange check itself failed: ETIMEDOUT/);
  assert.match(result, /blocks reconciliation/);
});

test("leader closed, follower check unknown, no reason given: falls back to a generic phrase, not 'undefined'", () => {
  const result = diagnoseStuckOpenPosition(false, "unknown");
  assert.doesNotMatch(result, /undefined/);
  assert.match(result, /unknown reason/);
});

test("leader closed AND follower flat: diagnosed as a dashboard-read bug, not a detection failure", () => {
  const result = diagnoseStuckOpenPosition(false, "flat");
  assert.match(result, /confirmed flat on the exchange/);
  assert.match(result, /bug is in how the dashboard reads the log/);
});

test("precedence: leaderStillOpen===true wins even if follower state is also provided", () => {
  // If the leader's own position is still open, that's the whole answer —
  // the follower's flat-state is irrelevant and must not leak into the message.
  const result = diagnoseStuckOpenPosition(true, "open");
  assert.match(result, /not actually closed yet/);
  assert.doesNotMatch(result, /STILL confirmed open/);
});

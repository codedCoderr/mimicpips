import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { _deps, loadClosedLeaderTradeIds } from "../lib/copyTradeReconciliation";

/**
 * This is the PHB regression: a leader trade genuinely closed on the
 * exchange (and in the bot's own futures_positions collection — the
 * document is gone) was NEVER detected as closed by reconciliation, so
 * open_without_close never fired and the follower's copy stayed "open" on
 * the dashboard indefinitely, with no repair path.
 *
 * Root cause: this used to query futures_history (a DIFFERENT collection,
 * written by the bot's own archival process, see futuresTrader.ts) and try
 * to match leaderTradeId (the stringified futures_positions._id) against
 * that collection's _id/tradeId/leaderTradeId/id fields. The bot's own
 * syncToDbStrict explicitly strips _id before every write, so
 * futures_history documents get a brand-new, Mongo-generated _id with NO
 * relationship to the original futures_positions._id — the join could
 * never succeed, for any trade, ever.
 */

interface FakePosition {
  _id: ObjectId;
  symbol: string;
  status: string;
}

class FakeCollection {
  constructor(private docs: FakePosition[]) {}
  find(query: { _id?: { $in: ObjectId[] } }) {
    const ids = query._id?.$in ?? [];
    const matched = this.docs.filter((d) => ids.some((id) => id.equals(d._id)));
    return { toArray: async () => matched };
  }
}

function fakeBotDb(positions: FakePosition[]) {
  const positionsCollection = new FakeCollection(positions);
  const empty = new FakeCollection([]);
  return {
    collection: (name: string) => (name === "futures_positions" ? positionsCollection : empty),
  } as unknown as Awaited<ReturnType<typeof import("../lib/saasDb").getBotDb>>;
}

const restore = { ..._deps };
test.afterEach(() => Object.assign(_deps, restore));

test("a leader trade whose futures_positions document is GONE is reported as closed", async () => {
  const closedTradeId = new ObjectId();
  // The position was deleted from futures_positions when the leader's
  // trade closed (see futuresTrader.ts's deleteFromDb("futures_positions",
  // ...) calls right after each syncToDbStrict("futures_history", ...)) —
  // so the fake bot DB simply has no document for it.
  _deps.getBotDb = async () => fakeBotDb([]);

  const result = await loadClosedLeaderTradeIds([closedTradeId.toString()]);

  assert.ok(result.has(closedTradeId.toString()), "a leader trade with no live futures_positions document must be reported as closed");
});

test("a leader trade whose futures_positions document STILL EXISTS is NOT reported as closed", async () => {
  const openTradeId = new ObjectId();
  _deps.getBotDb = async () => fakeBotDb([{ _id: openTradeId, symbol: "BTC/USDT:USDT", status: "OPEN" }]);

  const result = await loadClosedLeaderTradeIds([openTradeId.toString()]);

  assert.equal(result.has(openTradeId.toString()), false, "a live leader position must not be reported as closed");
});

test("mixed: one open, one closed, correctly distinguished", async () => {
  const openId = new ObjectId();
  const closedId = new ObjectId();
  _deps.getBotDb = async () => fakeBotDb([{ _id: openId, symbol: "ETH/USDT:USDT", status: "OPEN" }]);

  const result = await loadClosedLeaderTradeIds([openId.toString(), closedId.toString()]);

  assert.equal(result.has(openId.toString()), false);
  assert.ok(result.has(closedId.toString()));
});

test("a bot DB connection failure does NOT report every trade as closed (fails safe, flags nothing)", async () => {
  const tradeId = new ObjectId();
  _deps.getBotDb = async () => { throw new Error("ECONNREFUSED"); };

  const result = await loadClosedLeaderTradeIds([tradeId.toString()]);

  assert.equal(result.size, 0, "a connection failure must not be read as 'every trade is closed' — that would wrongly mark every open position closeable");
});

test("a query error (not just connection failure) also fails safe", async () => {
  const tradeId = new ObjectId();
  _deps.getBotDb = async () => ({
    collection: () => ({ find: () => ({ toArray: async () => { throw new Error("query failed"); } }) }),
  } as any);

  const result = await loadClosedLeaderTradeIds([tradeId.toString()]);

  assert.equal(result.size, 0);
});

test("malformed (non-ObjectId) trade ids are skipped, not crashed on", async () => {
  _deps.getBotDb = async () => fakeBotDb([]);
  const result = await loadClosedLeaderTradeIds(["not-an-object-id"]);
  assert.equal(result.size, 0);
});

test("empty input returns empty output without touching the database", async () => {
  let called = false;
  _deps.getBotDb = async () => { called = true; return fakeBotDb([]); };
  const result = await loadClosedLeaderTradeIds([]);
  assert.equal(result.size, 0);
  assert.equal(called, false);
});

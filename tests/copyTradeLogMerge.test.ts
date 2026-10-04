import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { mergeCloseEntries } from "../lib/copyTradeLogDisplay";

interface Row {
  _id: ObjectId;
  action: "OPEN" | "CLOSE";
  leaderTradeId: string;
  createdAt: Date;
}

function row(action: "OPEN" | "CLOSE", leaderTradeId: string, daysAgo: number): Row {
  return {
    _id: new ObjectId(),
    action,
    leaderTradeId,
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  };
}

test("THE PHB REGRESSION: a CLOSE row outside the original window is added, not dropped", () => {
  const leaderTradeId = "leader-pos-phb";
  const openRow = row("OPEN", leaderTradeId, 10); // old trade, still inside a limit-20 window
  const closeRow = row("CLOSE", leaderTradeId, 9); // its close, written later — but NOT in `entries` (simulates falling outside the window)

  // `entries` is what the original capped query returned: only the OPEN
  // row made it in. `closeEntries` is the full supplementary CLOSE fetch
  // for the same leaderTradeIds, which DOES find it.
  const merged = mergeCloseEntries([openRow], [closeRow]);

  assert.equal(merged.length, 2, "the CLOSE row must be added, not silently dropped");
  assert.ok(merged.some((r) => r.action === "CLOSE" && r.leaderTradeId === leaderTradeId));
});

test("a CLOSE row already present in entries is not duplicated", () => {
  const leaderTradeId = "leader-pos-1";
  const openRow = row("OPEN", leaderTradeId, 2);
  const closeRow = row("CLOSE", leaderTradeId, 1);

  const merged = mergeCloseEntries([openRow, closeRow], [closeRow]);

  assert.equal(merged.length, 2, "the same CLOSE row must not appear twice");
});

test("a genuinely still-open trade (no CLOSE row anywhere) is unaffected", () => {
  const openRow = row("OPEN", "leader-pos-open", 0);

  const merged = mergeCloseEntries([openRow], []);

  assert.deepEqual(merged, [openRow]);
});

test("result is sorted by createdAt descending, regardless of input order", () => {
  const a = row("OPEN", "t1", 5);
  const b = row("CLOSE", "t1", 1); // newest
  const c = row("OPEN", "t2", 10); // oldest

  const merged = mergeCloseEntries([a, c], [b]);

  assert.deepEqual(
    merged.map((r) => r._id.toString()),
    [b, a, c].map((r) => r._id.toString())
  );
});

test("multiple trades: each CLOSE row is matched and added independently", () => {
  const open1 = row("OPEN", "trade-1", 8);
  const open2 = row("OPEN", "trade-2", 6);
  const close1 = row("CLOSE", "trade-1", 7); // outside original window
  const close2 = row("CLOSE", "trade-2", 5); // outside original window

  const merged = mergeCloseEntries([open1, open2], [close1, close2]);

  assert.equal(merged.length, 4);
  assert.equal(merged.filter((r) => r.action === "CLOSE").length, 2);
});

test("empty entries, some close entries: all added", () => {
  const close1 = row("CLOSE", "t1", 1);
  const merged = mergeCloseEntries([], [close1]);
  assert.deepEqual(merged, [close1]);
});

test("empty closeEntries: entries returned unchanged (but re-sorted)", () => {
  const a = row("OPEN", "t1", 1);
  const b = row("OPEN", "t2", 5);
  const merged = mergeCloseEntries([b, a], []); // deliberately out of order
  assert.deepEqual(merged.map((r) => r._id.toString()), [a, b].map((r) => r._id.toString()));
});

test("does not mutate either input array", () => {
  const entries = [row("OPEN", "t1", 5)];
  const closeEntries = [row("CLOSE", "t1", 1)];
  const entriesCopy = [...entries];
  const closeCopy = [...closeEntries];

  mergeCloseEntries(entries, closeEntries);

  assert.deepEqual(entries, entriesCopy);
  assert.deepEqual(closeEntries, closeCopy);
});

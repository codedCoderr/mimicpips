import test from "node:test";
import assert from "node:assert/strict";
import { calculateDirectionalPnl } from "../lib/pnlMath";

test("LONG: profit when exit > entry", () => {
  const r = calculateDirectionalPnl(100, 110, 500, "LONG");
  assert.ok(r);
  assert.ok(Math.abs(r!.pnl - 50) < 1e-9);
  assert.ok(Math.abs(r!.roi - 10) < 1e-9);
});

test("LONG: loss when exit < entry", () => {
  const r = calculateDirectionalPnl(100, 90, 500, "LONG");
  assert.ok(Math.abs(r!.pnl - -50) < 1e-9);
});

test("SHORT: profit when exit < entry", () => {
  const r = calculateDirectionalPnl(100, 90, 500, "SHORT");
  assert.ok(Math.abs(r!.pnl - 50) < 1e-9);
});

test("SHORT: loss when exit > entry", () => {
  const r = calculateDirectionalPnl(100, 110, 500, "SHORT");
  assert.ok(Math.abs(r!.pnl - -50) < 1e-9);
});

test("null/undefined side defaults to LONG direction (matches every existing call site's `side === 'SHORT' ? -1 : 1`)", () => {
  const withNull = calculateDirectionalPnl(100, 110, 500, null);
  const withUndef = calculateDirectionalPnl(100, 110, 500, undefined);
  const long = calculateDirectionalPnl(100, 110, 500, "LONG");
  assert.deepEqual(withNull, long);
  assert.deepEqual(withUndef, long);
});

test("returns null for missing, zero, negative, or non-finite entryPrice/exitPrice/notional", () => {
  const bad = [null, undefined, 0, -5, NaN, Infinity];
  for (const v of bad) {
    assert.equal(calculateDirectionalPnl(v as any, 110, 500, "LONG"), null, `entryPrice=${v}`);
    assert.equal(calculateDirectionalPnl(100, v as any, 500, "LONG"), null, `exitPrice=${v}`);
    assert.equal(calculateDirectionalPnl(100, 110, v as any, "LONG"), null, `notional=${v}`);
  }
});

test("no-move trade (exit === entry) is a real zero, not null", () => {
  const r = calculateDirectionalPnl(100, 100, 500, "LONG");
  assert.deepEqual(r, { pnl: 0, roi: 0 });
});

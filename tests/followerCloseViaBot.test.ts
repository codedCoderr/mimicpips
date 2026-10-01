import test from "node:test";
import assert from "node:assert/strict";
import { closeFollowerPositionViaBot } from "../lib/followerCloseViaBot";

const ok = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

function withEnv<T>(fn: () => Promise<T>) {
  const prev = { u: process.env.BOT_SERVER_URL, k: process.env.SAAS_SERVICE_AUTH_KEY };
  process.env.BOT_SERVER_URL = "https://bot.example:3847/";
  process.env.SAAS_SERVICE_AUTH_KEY = "k".repeat(32);
  return fn().finally(() => {
    process.env.BOT_SERVER_URL = prev.u;
    process.env.SAAS_SERVICE_AUTH_KEY = prev.k;
    if (prev.u === undefined) delete process.env.BOT_SERVER_URL;
    if (prev.k === undefined) delete process.env.SAAS_SERVICE_AUTH_KEY;
  });
}

test("closed: a successful close is reported ok with its status", () =>
  withEnv(async () => {
    const r = await closeFollowerPositionViaBot("u1", "leader-pos-1", ok({ ok: true, status: "closed" }));
    assert.deepEqual(r, { ok: true, status: "closed" });
  }));

test("already_flat: also reported as a success (the outcome the caller wanted)", () =>
  withEnv(async () => {
    const r = await closeFollowerPositionViaBot("u1", "leader-pos-1", ok({ ok: true, status: "already_flat" }));
    assert.deepEqual(r, { ok: true, status: "already_flat" });
  }));

test("failure: a bot-reported error is surfaced, not treated as success", () =>
  withEnv(async () => {
    const r = await closeFollowerPositionViaBot(
      "u1",
      "leader-pos-1",
      ok({ ok: false, error: "No open position was found for this trade." }, 404)
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /No open position/);
  }));

test("never ok on a non-2xx response, even with a plausible-looking body", () =>
  withEnv(async () => {
    for (const status of [401, 409, 500, 502]) {
      const r = await closeFollowerPositionViaBot("u1", "leader-pos-1", ok({ ok: true, status: "closed" }, status));
      assert.equal(r.ok, false, `status ${status} must not be trusted as success`);
    }
  }));

test("never ok on malformed or unexpected response bodies", () =>
  withEnv(async () => {
    const bodies: unknown[] = [null, {}, { ok: true }, { ok: true, status: "CLOSED" }, { status: "closed" }, "closed", []];
    for (const b of bodies) {
      const r = await closeFollowerPositionViaBot("u1", "leader-pos-1", ok(b));
      assert.equal(r.ok, false, `body ${JSON.stringify(b)} must not count as success`);
    }
  }));

test("network failure is reported, not thrown", () =>
  withEnv(async () => {
    const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const r = await closeFollowerPositionViaBot("u1", "leader-pos-1", boom);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /ECONNREFUSED/);
  }));

test("missing configuration makes no request and fails closed", async () => {
  const prev = { u: process.env.BOT_SERVER_URL, k: process.env.SAAS_SERVICE_AUTH_KEY };
  delete process.env.BOT_SERVER_URL;
  delete process.env.SAAS_SERVICE_AUTH_KEY;
  let called = false;
  const spy = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  const r = await closeFollowerPositionViaBot("u1", "leader-pos-1", spy);
  assert.equal(r.ok, false);
  assert.equal(called, false);
  if (prev.u !== undefined) process.env.BOT_SERVER_URL = prev.u;
  if (prev.k !== undefined) process.env.SAAS_SERVICE_AUTH_KEY = prev.k;
});

test("request: authenticates with the service key and posts followerId + leaderTradeId", () =>
  withEnv(async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const spy = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true, status: "closed" }));
    }) as unknown as typeof fetch;
    await closeFollowerPositionViaBot("follower-42", "leader-pos-9", spy);
    assert.equal(seen!.url, "https://bot.example:3847/api/saas/close-position");
    assert.equal((seen!.init.headers as Record<string, string>)["X-Service-Key"], "k".repeat(32));
    assert.deepEqual(JSON.parse(String(seen!.init.body)), { followerId: "follower-42", leaderTradeId: "leader-pos-9" });
  }));

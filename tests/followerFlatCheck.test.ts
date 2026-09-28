import test from "node:test";
import assert from "node:assert/strict";
import { checkFollowerFlatViaBot } from "../lib/followerFlatCheck";

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

test("flat: only an explicit flat answer is flat", () =>
  withEnv(async () => {
    const r = await checkFollowerFlatViaBot("u1", "PHB/USDT:USDT", "LONG", ok({ state: "flat" }));
    assert.deepEqual(r, { state: "flat" });
  }));

test("open: a live position is reported open with its size", () =>
  withEnv(async () => {
    const r = await checkFollowerFlatViaBot("u1", "PHB/USDT:USDT", "LONG", ok({ state: "open", contracts: 178048 }));
    assert.deepEqual(r, { state: "open", contracts: 178048 });
  }));

test("unknown: a bot that says unknown stays unknown", () =>
  withEnv(async () => {
    const r = await checkFollowerFlatViaBot("u1", "X", "LONG", ok({ state: "unknown", reason: "ETIMEDOUT" }));
    assert.equal(r.state, "unknown");
  }));

test("unknown, never flat: HTTP errors", () =>
  withEnv(async () => {
    for (const status of [401, 404, 422, 500, 502]) {
      const r = await checkFollowerFlatViaBot("u1", "X", "LONG", ok({ state: "flat" }, status));
      assert.equal(r.state, "unknown", `status ${status} must not be trusted as flat`);
    }
  }));

test("unknown, never flat: network failure", () =>
  withEnv(async () => {
    const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const r = await checkFollowerFlatViaBot("u1", "X", "LONG", boom);
    assert.equal(r.state, "unknown");
  }));

test("unknown, never flat: malformed or unexpected bodies", () =>
  withEnv(async () => {
    const bodies: unknown[] = [null, {}, { state: "FLAT" }, { state: true }, { flat: true }, "flat", []];
    for (const b of bodies) {
      const r = await checkFollowerFlatViaBot("u1", "X", "LONG", ok(b));
      assert.equal(r.state, "unknown", `body ${JSON.stringify(b)} must not count as flat`);
    }
    const notJson = (async () => new Response("<html>gateway</html>", { status: 200 })) as unknown as typeof fetch;
    assert.equal((await checkFollowerFlatViaBot("u1", "X", "LONG", notJson)).state, "unknown");
  }));

test("unknown, never flat: missing configuration makes no request", async () => {
  const prev = { u: process.env.BOT_SERVER_URL, k: process.env.SAAS_SERVICE_AUTH_KEY };
  delete process.env.BOT_SERVER_URL;
  delete process.env.SAAS_SERVICE_AUTH_KEY;
  let called = false;
  const spy = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  const r = await checkFollowerFlatViaBot("u1", "X", "LONG", spy);
  assert.equal(r.state, "unknown");
  assert.equal(called, false);
  if (prev.u !== undefined) process.env.BOT_SERVER_URL = prev.u;
  if (prev.k !== undefined) process.env.SAAS_SERVICE_AUTH_KEY = prev.k;
});

test("request: authenticates with the service key and posts the right body", () =>
  withEnv(async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const spy = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ state: "flat" }));
    }) as unknown as typeof fetch;
    await checkFollowerFlatViaBot("u1", "PHB/USDT:USDT", "SHORT", spy);
    assert.equal(seen!.url, "https://bot.example:3847/api/saas/check-flat", "trailing slash trimmed");
    assert.equal((seen!.init.headers as Record<string, string>)["X-Service-Key"], "k".repeat(32));
    assert.deepEqual(JSON.parse(String(seen!.init.body)), { followerId: "u1", symbol: "PHB/USDT:USDT", side: "SHORT" });
  }));

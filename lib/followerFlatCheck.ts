/**
 * Ask the bot whether a follower is actually flat on a symbol.
 *
 * Used by reconciliation to repair a copied trade that the dashboard still
 * shows as open after the follower closed it by hand on Binance (or after a
 * close event was missed). This app holds no exchange session; only the bot
 * can decrypt the follower's key and query the exchange.
 *
 * The result is three-valued ON PURPOSE. "unknown" covers every failure:
 * bot unreachable, non-2xx, malformed body, bad key, exchange error. Callers
 * must treat "unknown" as "leave the row alone". Reporting a failed check as
 * "flat" would mark a live position closed and hide it from the follower.
 */
export type FollowerFlatState =
  | { state: "flat" }
  | { state: "open"; contracts: number }
  | { state: "unknown"; reason: string };

export async function checkFollowerFlatViaBot(
  followerId: string,
  symbol: string,
  side: "LONG" | "SHORT",
  fetchImpl: typeof fetch = fetch
): Promise<FollowerFlatState> {
  const botUrl = process.env.BOT_SERVER_URL?.trim();
  const serviceKey = process.env.SAAS_SERVICE_AUTH_KEY?.trim();
  if (!botUrl || !serviceKey) {
    return { state: "unknown", reason: "BOT_SERVER_URL / SAAS_SERVICE_AUTH_KEY not configured." };
  }

  try {
    const res = await fetchImpl(`${botUrl.replace(/\/+$/, "")}/api/saas/check-flat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Key": serviceKey },
      body: JSON.stringify({ followerId, symbol, side }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { state: "unknown", reason: `Bot returned ${res.status}.` };
    }

    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (data?.state === "flat") return { state: "flat" };
    if (data?.state === "open") {
      return { state: "open", contracts: Number(data.contracts) || 0 };
    }
    if (data?.state === "unknown") {
      return { state: "unknown", reason: String(data.reason ?? "Bot could not determine position.") };
    }
    return { state: "unknown", reason: "Unrecognised response from bot." };
  } catch (error) {
    return {
      state: "unknown",
      reason: error instanceof Error ? error.message : "Bot request failed.",
    };
  }
}

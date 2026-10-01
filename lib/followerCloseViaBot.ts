/**
 * Ask the bot to place a real close order for a follower's copied
 * position, server-to-server (no follower session — this is called from
 * reconciliation, a cron job, not from the follower's own browser).
 *
 * This calls the exact same bot endpoint the follower dashboard's "Close
 * position" button uses (app/api/saas/close-position/route.ts ->
 * POST /api/saas/close-position), so the same ownership re-verification,
 * in-flight locking, and retry-safety already built and tested for that
 * button apply here unchanged. Reconciliation does not duplicate any of
 * that logic — it only decides WHEN to call this.
 *
 * Three-valued for the same reason checkFollowerFlatViaBot is: "failed"
 * covers every way this can go wrong (bot unreachable, non-2xx, malformed
 * body) and callers must not treat it as success.
 */
export type FollowerCloseResult =
  | { ok: true; status: "closed" | "already_flat" }
  | { ok: false; reason: string };

export async function closeFollowerPositionViaBot(
  followerId: string,
  leaderTradeId: string,
  fetchImpl: typeof fetch = fetch
): Promise<FollowerCloseResult> {
  const botUrl = process.env.BOT_SERVER_URL?.trim();
  const serviceKey = process.env.SAAS_SERVICE_AUTH_KEY?.trim();
  if (!botUrl || !serviceKey) {
    return { ok: false, reason: "BOT_SERVER_URL / SAAS_SERVICE_AUTH_KEY not configured." };
  }

  try {
    const res = await fetchImpl(`${botUrl.replace(/\/+$/, "")}/api/saas/close-position`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Key": serviceKey },
      body: JSON.stringify({ followerId, leaderTradeId }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !data) {
      return { ok: false, reason: `Bot returned ${res.status}${data?.error ? `: ${data.error}` : "."}` };
    }
    if (data.ok === true && (data.status === "closed" || data.status === "already_flat")) {
      return { ok: true, status: data.status };
    }
    return { ok: false, reason: typeof data.error === "string" ? data.error : "Unrecognised response from bot." };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Bot request failed." };
  }
}

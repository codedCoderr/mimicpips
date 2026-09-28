import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { refreshFollowerBalances } from "@/lib/balanceRefresh";

/**
 * Fetches every connected follower's CURRENT balance live from the
 * exchange and updates lastKnownBalanceUSDT — the followers table
 * otherwise only shows whatever balance was captured at key-connection
 * time (or the last billing run), which goes stale fast. This is a
 * manual, on-demand refresh rather than something that runs on every
 * page load, since it's N live exchange calls (real latency, real
 * rate-limit exposure) — the operator triggers it when they actually
 * want current numbers, not implicitly on every visit to the page.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const valid = token ? await verifySessionToken(token) : false;
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Operator-triggered: no cap, they asked for current numbers now.
  const result = await refreshFollowerBalances({ limit: Number.MAX_SAFE_INTEGER });
  return NextResponse.json({ ok: true, updated: result.updated, failed: result.failed, total: result.total });
}

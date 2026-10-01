import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import { isRateLimited } from "@/lib/rateLimit";
import type { CopyTradeLogDoc, CopyTradeLogStatus } from "@/lib/saasTypes";

/**
 * Follower-initiated close — the "Close position" button on the follower
 * dashboard. Places a real market order against the follower's own
 * exchange account via the bot. This is the one write endpoint in the
 * copy-trade system triggered directly by a follower's own click rather
 * than a leader event or reconciliation, so it gets its own full
 * authentication and ownership check here, in addition to (not instead
 * of) the bot independently re-checking the same ownership before it
 * touches the exchange — see closeFollowerPositionById in the bot's
 * copyTradeWorker.ts.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000;

interface BotCloseResponse {
  ok: boolean;
  status?: "closed" | "already_flat";
  error?: string;
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await getUserFromSessionToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const leaderTradeId = typeof body?.leaderTradeId === "string" ? body.leaderTradeId.trim() : "";
  if (!leaderTradeId) {
    return NextResponse.json({ error: "leaderTradeId is required." }, { status: 400 });
  }

  // Rate limit BEFORE the ownership lookup: a per-user key means this
  // can't be used to hammer the database with lookups for made-up trade
  // ids either, not just to spam real closes.
  if (await isRateLimited(`close-position:${user._id}`, MAX_ATTEMPTS, WINDOW_MS)) {
    return NextResponse.json(
      { error: "Too many close attempts. Wait a moment and try again." },
      { status: 429 }
    );
  }

  const db = await getSaasDb();

  // Ownership + "is this actually open" check. The bot re-does this exact
  // check independently before it ever touches the exchange (see its own
  // doc comment) — this copy exists so a follower gets a fast, specific
  // error for someone else's trade id or an already-closed one, rather
  // than a generic failure surfaced from a service-to-service call.
  const openLog = await db.collection<CopyTradeLogDoc>("copy_trade_log").findOne({
    userId: user._id!,
    leaderTradeId,
    action: { $ne: "CLOSE" } as any, // matches "OPEN" and legacy rows with no action field
    status: { $in: ["executed", "failed"] as CopyTradeLogStatus[] },
  });
  if (!openLog) {
    return NextResponse.json(
      { error: "No open position was found for this trade." },
      { status: 404 }
    );
  }

  const alreadyClosed = await db.collection<CopyTradeLogDoc>("copy_trade_log").findOne({
    userId: user._id!,
    leaderTradeId,
    action: "CLOSE",
    status: "closed",
  });
  if (alreadyClosed) {
    return NextResponse.json({ error: "This position is already closed." }, { status: 409 });
  }

  const botUrl = process.env.BOT_SERVER_URL;
  const serviceKey = process.env.SAAS_SERVICE_AUTH_KEY;
  if (!botUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server is not configured (BOT_SERVER_URL / SAAS_SERVICE_AUTH_KEY missing)." },
      { status: 500 }
    );
  }

  let botResponse: BotCloseResponse;
  try {
    const res = await fetch(`${botUrl.replace(/\/+$/, "")}/api/saas/close-position`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Key": serviceKey },
      body: JSON.stringify({ followerId: String(user._id), leaderTradeId }),
      signal: AbortSignal.timeout(30_000),
    });
    botResponse = await res.json().catch(() => ({ ok: false, error: `Bot returned ${res.status}.` }));
    if (!res.ok && botResponse.ok === undefined) {
      botResponse = { ok: false, error: `Bot returned ${res.status}.` };
    }
  } catch {
    // A network failure here is genuinely ambiguous: the bot may have
    // placed the order and the response just never arrived. Do NOT tell
    // the follower it succeeded — say so plainly and point at the
    // position list, which will reflect the true state on next load
    // (via reconciliation if the close row was written but the response
    // was lost) rather than guessing.
    return NextResponse.json(
      {
        error:
          "Could not confirm the close with the trading server. Check your open positions before retrying — the order may have gone through even though this request failed.",
      },
      { status: 502 }
    );
  }

  if (!botResponse.ok) {
    return NextResponse.json({ error: botResponse.error ?? "Close failed." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, status: botResponse.status });
}

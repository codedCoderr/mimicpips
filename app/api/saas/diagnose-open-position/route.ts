import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/saasAuth";
import { getSaasDb, getBotDb } from "@/lib/saasDb";
import { checkFollowerFlatViaBot } from "@/lib/followerFlatCheck";
import { isPossiblyLiveOpenStatus } from "@/lib/copyTradeReconciliation";
import { diagnoseStuckOpenPosition } from "@/lib/copyTradeLogDisplay";
import { ObjectId } from "mongodb";
import type { CopyTradeLogDoc } from "@/lib/saasTypes";

/**
 * Read-only diagnostic, scoped to the logged-in follower's own trades.
 * Added specifically to debug a stuck-open position that survived the
 * copy-trade-log window fix and the futures_positions join fix from prior
 * sessions, without requiring operator access or another round of blind
 * code changes. Shows, for each of the follower's own OPEN rows with no
 * matching CLOSE, exactly what each layer of reconciliation's own logic
 * would conclude — without writing anything or placing any order.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const userId = new ObjectId(session.userId);

  const db = await getSaasDb();
  const logs = await db
    .collection<CopyTradeLogDoc>("copy_trade_log")
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();

  const byTrade = new Map<string, CopyTradeLogDoc[]>();
  for (const log of logs) {
    if (!log.leaderTradeId) continue;
    byTrade.set(log.leaderTradeId, [...(byTrade.get(log.leaderTradeId) ?? []), log]);
  }

  const results = [];
  for (const [leaderTradeId, group] of byTrade) {
    const opens = group.filter((l) => l.action === "OPEN");
    const closes = group.filter((l) => l.action === "CLOSE");
    const executedOpen = opens.find((l) => isPossiblyLiveOpenStatus(l.status));
    const hasClose = closes.some((l) => l.status === "closed" || l.status === "processing");
    if (!executedOpen || hasClose) continue; // only report trades that LOOK stuck open

    // Is the leader's own position still live, per the bot's futures_positions?
    let leaderStillOpen: boolean | null = null;
    try {
      const botDb = await getBotDb();
      const doc = ObjectId.isValid(leaderTradeId)
        ? await botDb.collection("futures_positions").findOne({ _id: new ObjectId(leaderTradeId) })
        : null;
      leaderStillOpen = !!doc;
    } catch {
      leaderStillOpen = null; // could not determine
    }

    // Is the FOLLOWER still flat or open, per the exchange directly?
    const side = executedOpen.leaderSide === "SHORT" ? "SHORT" : "LONG";
    const followerFlatCheck = await checkFollowerFlatViaBot(
      userId.toString(),
      executedOpen.leaderSymbol,
      side
    );

    results.push({
      leaderTradeId,
      symbol: executedOpen.leaderSymbol,
      side,
      openRowStatus: executedOpen.status,
      openRowDetail: executedOpen.detail,
      openRowCreatedAt: executedOpen.createdAt,
      leaderPositionStillInFuturesPositions: leaderStillOpen,
      followerFlatCheck,
      diagnosis: diagnoseStuckOpenPosition(
        leaderStillOpen,
        followerFlatCheck.state,
        "reason" in followerFlatCheck ? followerFlatCheck.reason : undefined
      ),
    });
  }

  return NextResponse.json({ checkedAt: new Date().toISOString(), stuckPositions: results });
}

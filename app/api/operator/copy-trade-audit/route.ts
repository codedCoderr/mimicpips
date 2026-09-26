import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getSaasDb } from "@/lib/saasDb";
import type { CopyTradeAuditEventDoc, CopyTradeLogDoc, UserDoc } from "@/lib/saasTypes";

async function requireOperator(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return token ? !!(await verifySessionToken(token).catch(() => null)) : false;
}

export async function GET(req: NextRequest) {
  if (!(await requireOperator(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leaderTradeId = req.nextUrl.searchParams.get("leaderTradeId")?.trim();
  if (!leaderTradeId) {
    return NextResponse.json({ error: "leaderTradeId is required." }, { status: 400 });
  }

  const db = await getSaasDb();
  const [events, logs] = await Promise.all([
    db
      .collection<CopyTradeAuditEventDoc>("copy_trade_audit_events")
      .find({ leaderTradeId })
      .sort({ createdAt: 1 })
      .limit(250)
      .toArray(),
    db
      .collection<CopyTradeLogDoc>("copy_trade_log")
      .find({ leaderTradeId })
      .sort({ createdAt: 1 })
      .toArray(),
  ]);

  const userIds = Array.from(
    new Set(
      [...events.map((event) => event.userId), ...logs.map((log) => log.userId)]
        .filter((id): id is ObjectId => id instanceof ObjectId)
        .map((id) => id.toString())
    )
  ).map((id) => new ObjectId(id));

  const users = userIds.length
    ? await db.collection<UserDoc>("users").find({ _id: { $in: userIds } }).toArray()
    : [];
  const userById = new Map(users.map((user) => [user._id?.toString(), user]));

  return NextResponse.json({
    leaderTradeId,
    followers: logs.filter((log) => log.userId instanceof ObjectId).map((log) => {
      const user = userById.get(log.userId.toString());
      return {
        userId: log.userId.toString(),
        displayName: user?.displayName ?? user?.email ?? log.userId.toString(),
        email: user?.email ?? null,
        action: log.action === "CLOSE" ? "CLOSE" : "OPEN",
        symbol: log.leaderSymbol || "UNKNOWN",
        status: log.status || "unknown",
        detail: log.detail,
        followerNotional: log.followerNotional,
        followerOrderId: log.followerOrderId,
        realizedPnl: log.realizedPnl ?? null,
        roiPercentage: log.roiPercentage ?? null,
        createdAt: log.createdAt?.toISOString?.() ?? new Date().toISOString(),
        executedAt: log.executedAt?.toISOString?.() ?? null,
      };
    }),
    events: events.filter((event) => event.userId instanceof ObjectId).map((event) => {
      const user = userById.get(event.userId.toString());
      return {
        id: event._id?.toString(),
        userId: event.userId.toString(),
        displayName: user?.displayName ?? user?.email ?? event.userId.toString(),
        email: user?.email ?? null,
        action: event.action === "CLOSE" ? "CLOSE" : "OPEN",
        symbol: event.leaderSymbol || "UNKNOWN",
        type: event.type,
        status: event.status ?? null,
        detail: event.detail,
        metadata: event.metadata ?? null,
        createdAt: event.createdAt?.toISOString?.() ?? new Date().toISOString(),
      };
    }),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import type { SubscriptionDoc } from "@/lib/saasTypes";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await getUserFromSessionToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const db = await getSaasDb();
  const sub = await db
    .collection<SubscriptionDoc>("subscriptions")
    .findOne({ userId: user._id! });

  if (!sub) {
    return NextResponse.json({ subscription: null });
  }

  return NextResponse.json({
    subscription: {
      status: sub.status,
      monthlyFeeNGN: sub.monthlyFeeNGN,
      currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      lastChargedAt: sub.lastChargedAt?.toISOString() ?? null,
    },
  });
}
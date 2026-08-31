import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import type { ExchangeKeyDoc } from "@/lib/saasTypes";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await getUserFromSessionToken(token) : null;

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const db = await getSaasDb();
  const exchangeKey = user._id
    ? await db.collection<ExchangeKeyDoc>("exchange_keys").findOne({ userId: user._id })
    : null;

  return NextResponse.json({
    user: {
      email: user.email,
      displayName: user.displayName,
      copyTradingEnabled: user.copyTradingEnabled,
      emailVerified: user.emailVerified,
      exchangeConnected: Boolean(exchangeKey?.verifiedAt),
      exchange: exchangeKey?.exchange ?? null,
      lastKnownBalanceUSDT: exchangeKey?.lastKnownBalanceUSDT ?? null,
      lastBalanceCheckAt: exchangeKey?.lastBalanceCheckAt?.toISOString() ?? null,
    },
  });
}
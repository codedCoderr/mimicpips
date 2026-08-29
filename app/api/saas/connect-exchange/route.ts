import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import { encryptSecret } from "@/lib/exchangeKeyCrypto";
import { isRateLimited } from "@/lib/rateLimit";
import type { ExchangeKeyDoc } from "@/lib/saasTypes";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface BotVerifyResponse {
  verified: boolean;
  reason: string | null;
  balanceUSDT: number | null;
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await getUserFromSessionToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (isRateLimited(`connect-exchange:${user._id}`, MAX_ATTEMPTS, WINDOW_MS)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a while before trying again." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const apiSecret = typeof body?.apiSecret === "string" ? body.apiSecret.trim() : "";

  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: "API key and secret are required." }, { status: 400 });
  }

  const botUrl = process.env.BOT_SERVER_URL;
  const serviceKey = process.env.SAAS_SERVICE_KEY;
  if (!botUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server is not configured (BOT_SERVER_URL / SAAS_SERVICE_KEY missing)." },
      { status: 500 }
    );
  }

  let verification: BotVerifyResponse;
  try {
    const res = await fetch(`${botUrl.replace(/\/+$/, "")}/api/saas/verify-key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": serviceKey,
      },
      body: JSON.stringify({ apiKey, apiSecret }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Verification service returned an error (${res.status}).` },
        { status: 502 }
      );
    }
    verification = await res.json();
  } catch {
    return NextResponse.json(
      { error: "Could not reach the verification service. Try again shortly." },
      { status: 502 }
    );
  }

  if (!verification.verified) {
    return NextResponse.json(
      { error: verification.reason ?? "Key verification failed." },
      { status: 422 }
    );
  }

  // Encrypt AFTER verification succeeds — never encrypt-and-store a key
  // that failed the permission/balance check.
  const apiKeyEncrypted = await encryptSecret(apiKey);
  const apiSecretEncrypted = await encryptSecret(apiSecret);

  const db = await getSaasDb();
  const now = new Date();

  await db.collection<ExchangeKeyDoc>("exchange_keys").updateOne(
    { userId: user._id! },
    {
      $set: {
        userId: user._id!,
        exchange: "binance",
        apiKeyEncrypted,
        apiSecretEncrypted,
        verifiedAt: now,
        lastKnownBalanceUSDT: verification.balanceUSDT,
        lastBalanceCheckAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  return NextResponse.json({
    ok: true,
    balanceUSDT: verification.balanceUSDT,
  });
}

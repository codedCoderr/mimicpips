import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import { initializeSubscriptionCheckout } from "@/lib/paystack";
import { convertUsdToNgn } from "@/lib/exchangeRate";
import { getErrorMessage } from "@/lib/errorMessage";
import type { SubscriptionDoc } from "@/lib/saasTypes";

const MONTHLY_FEE_USD = 19;

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await getUserFromSessionToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { error: "Server is not configured (NEXT_PUBLIC_APP_URL missing)." },
      { status: 500 }
    );
  }

  const db = await getSaasDb();

  const existing = await db
    .collection<SubscriptionDoc>("subscriptions")
    .findOne({ userId: user._id! });

  if (existing?.status === "ACTIVE") {
    return NextResponse.json({ error: "Already subscribed." }, { status: 409 });
  }
  if (existing?.status === "PENDING_PAYMENT") {
    return NextResponse.json(
      { error: "A subscription checkout is already pending. Complete it or try again later." },
      { status: 409 }
    );
  }

  const reference = `SUB-PAY-${user._id}-${randomUUID().slice(0, 8)}`;
  const now = new Date();

  let monthlyFeeNGN: number;
  try {
    monthlyFeeNGN = convertUsdToNgn(MONTHLY_FEE_USD);
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err, "Could not calculate pricing.") }, { status: 500 });
  }

  await db.collection<SubscriptionDoc>("subscriptions").updateOne(
    { userId: user._id! },
    {
      $set: {
        status: "PENDING_PAYMENT",
        monthlyFeeNGN,
        updatedAt: now,
      },
      $setOnInsert: {
        userId: user._id!,
        paystackCustomerCode: null,
        paystackAuthorizationCode: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        lastChargedAt: null,
        failedChargeCount: 0,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  try {
    const checkout = await initializeSubscriptionCheckout({
      email: user.email,
      amountNGN: monthlyFeeNGN,
      reference,
      callbackUrl: `${appUrl}/app/billing/callback`,
      metadata: { userId: user._id!.toString(), type: "subscription" },
    });

    return NextResponse.json({
      authorizationUrl: checkout.authorizationUrl,
      accessCode: checkout.accessCode,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Could not start checkout.") },
      { status: 502 }
    );
  }
}

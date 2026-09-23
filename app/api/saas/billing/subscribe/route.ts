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

  const reference = `SUB-PAY-${user._id}-${randomUUID().slice(0, 8)}`;
  const now = new Date();

  let monthlyFeeNGN: number;
  try {
    monthlyFeeNGN = convertUsdToNgn(MONTHLY_FEE_USD);
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err, "Could not calculate pricing.") }, { status: 500 });
  }

  const claimedSubscription = await db.collection<SubscriptionDoc>("subscriptions").findOneAndUpdate(
    {
      userId: user._id!,
      status: { $nin: ["ACTIVE", "PENDING_PAYMENT", "RENEWING"] },
    },
    {
      $set: {
        status: "PENDING_PAYMENT",
        monthlyFeeNGN,
        paystackReference: reference,
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
    { returnDocument: "after" }
  );

  let claimSucceeded = !!claimedSubscription;

  if (!claimSucceeded) {
    const insertDoc: SubscriptionDoc = {
      userId: user._id!,
      status: "PENDING_PAYMENT",
      monthlyFeeNGN,
      paystackReference: reference,
      paystackCustomerCode: null,
      paystackAuthorizationCode: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      lastChargedAt: null,
      failedChargeCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await db.collection<SubscriptionDoc>("subscriptions").insertOne(insertDoc);
      claimSucceeded = true;
    } catch (err: unknown) {
      const code = typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : null;
      if (code !== 11000) throw err;
    }
  }

  if (!claimSucceeded) {
    const existing = await db
      .collection<SubscriptionDoc>("subscriptions")
      .findOne({ userId: user._id! });
    const message =
      existing?.status === "ACTIVE"
        ? "Already subscribed."
        : "A subscription checkout is already pending. Complete it or try again later.";
    return NextResponse.json({ error: message }, { status: 409 });
  }

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
    await db.collection<SubscriptionDoc>("subscriptions").updateOne(
      { userId: user._id!, status: "PENDING_PAYMENT", paystackReference: reference },
      { $set: { status: "EXPIRED", paystackReference: null, updatedAt: new Date() } }
    );
    return NextResponse.json(
      { error: getErrorMessage(err, "Could not start checkout.") },
      { status: 502 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import { initializeSubscriptionCheckout } from "@/lib/paystack";
import { isSubscriptionActiveForGates } from "@/lib/subscriptionGates";
import { convertUsdToNgn } from "@/lib/exchangeRate";
import { getErrorMessage } from "@/lib/errorMessage";
import type { SubscriptionDoc } from "@/lib/saasTypes";

const MONTHLY_FEE_USD = 19;

// How long a PENDING_PAYMENT claim is honored before it's considered
// abandoned and reclaimable. Nothing else ever clears a PENDING_PAYMENT
// row — only a successful Paystack webhook (-> ACTIVE) does. If the user
// closes the checkout tab, the payment fails silently, or the webhook
// never arrives, the row sat in PENDING_PAYMENT permanently and every
// future subscribe attempt was rejected as "already pending" with no way
// out. 30 minutes is generous for a real checkout session while still
// being short enough that a genuinely abandoned one doesn't block the
// user for days.
const PENDING_PAYMENT_STALE_MS = 30 * 60 * 1000;

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
      $or: [
        { status: { $nin: ["ACTIVE", "PENDING_PAYMENT", "RENEWING"] } },
        // A PENDING_PAYMENT (or RENEWING — the same "a charge attempt
        // claimed this row and never resolved it" shape) older than the
        // staleness window is treated as abandoned and reclaimable, so a
        // genuinely stuck checkout doesn't block the user forever. Still
        // protected against a double-submit race: a claim from seconds
        // ago is correctly rejected by this same condition. This filter
        // must match isPendingPaymentReclaimable's semantics in
        // subscriptionGates.ts (tested there) — kept as a raw Mongo
        // condition here, rather than calling that function, because this
        // needs to run as part of a single atomic findOneAndUpdate rather
        // than a separate read-then-decide step, which would reopen the
        // exact double-submit race this guards against.
        {
          status: { $in: ["PENDING_PAYMENT", "RENEWING"] },
          updatedAt: { $lt: new Date(now.getTime() - PENDING_PAYMENT_STALE_MS) },
        },
      ],
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
    // Checking status alone would block a user whose subscription has
    // genuinely lapsed (currentPeriodEnd passed, but the monthly billing
    // cron hasn't flipped status away from "ACTIVE" yet) from resubscribing
    // at all — telling them "Already subscribed" when resubscribing is
    // exactly the right action for them to take. See
    // isSubscriptionActiveForGates's doc comment.
    const message =
      isSubscriptionActiveForGates(existing)
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

import { NextRequest, NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { verifyWebhookSignature } from "@/lib/paystack";
import { getSaasDb } from "@/lib/saasDb";
import type { SubscriptionDoc, PerformanceFeeInvoiceDoc, HighWaterMarkDoc } from "@/lib/saasTypes";

interface PaystackWebhookData {
  reference?: string;
  amount?: number;
  currency?: string;
  metadata?: {
    type?: string;
    userId?: string;
    invoiceId?: string;
  };
  authorization?: {
    authorization_code?: string;
  };
  customer?: {
    customer_code?: string;
  };
}

interface PaystackWebhookEvent {
  event?: string;
  data?: PaystackWebhookData;
}

/**
 * Paystack webhook — the source of truth for payment confirmation.
 * NEVER trust the client-side redirect after checkout as proof of
 * payment; this webhook is what actually marks something paid.
 *
 * Routes by reference prefix, same convention as the e-commerce
 * platform: "SUB-PAY-" for the flat monthly fee, "PERF-FEE-" for
 * performance fee invoices.
 */
export async function POST ( req: NextRequest ) {
  // Signature verification requires the RAW body — reading it via
  // req.json() first and re-serializing would break the HMAC check.
  const rawBody = await req.text();
  const signature = req.headers.get( "x-paystack-signature" );

  if ( !verifyWebhookSignature( rawBody, signature ) ) {
    return NextResponse.json( { error: "Invalid signature." }, { status: 401 } );
  }

  let event: PaystackWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const eventType = event?.event;
  const reference: string | undefined = event?.data?.reference;

  if ( !reference ) {
    return NextResponse.json( { ok: true } ); // nothing to route, acknowledge and move on
  }

  if ( eventType !== "charge.success" ) {
    // Other event types (failures, disputes, etc.) — acknowledged but
    // not yet acted on. Extend here as needed once failure handling for
    // PAST_DUE subscriptions is built out.
    return NextResponse.json( { ok: true } );
  }

  const db = await getSaasDb();

  if ( reference.startsWith( "SUB-PAY-" ) ) {
    await handleSubscriptionPayment( db, event.data );
  } else if ( reference.startsWith( "PERF-FEE-" ) ) {
    await handlePerformanceFeePayment( db, event.data );
  }

  return NextResponse.json( { ok: true } );
}

async function handleSubscriptionPayment ( db: Db, data: PaystackWebhookData | undefined ) {
  const userId = data?.metadata?.userId;
  if ( !userId ) return;
  if ( !ObjectId.isValid( userId ) ) return;
  if (data?.metadata?.type !== "subscription") return;
  if (data?.currency && data.currency !== "NGN") return;

  const authorizationCode = data?.authorization?.authorization_code ?? null;
  const customerCode = data?.customer?.customer_code ?? null;
  const now = new Date();
  const periodEnd = new Date( now );
  periodEnd.setMonth( periodEnd.getMonth() + 1 );

  const amountNGN = typeof data?.amount === "number" ? data.amount / 100 : null;

  await db.collection<SubscriptionDoc>( "subscriptions" ).updateOne(
    {
      userId: new ObjectId( userId ),
      ...(amountNGN !== null ? { monthlyFeeNGN: amountNGN } : {}),
    },
    {
      $set: {
        status: "ACTIVE",
        paystackAuthorizationCode: authorizationCode,
        paystackCustomerCode: customerCode,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        lastChargedAt: now,
        failedChargeCount: 0,
        updatedAt: now,
      },
    }
  );
}

async function handlePerformanceFeePayment ( db: Db, data: PaystackWebhookData | undefined ) {
  const reference = data?.reference;
  if (!reference) return;
  if (data?.metadata?.type !== "performance_fee") return;
  if (data?.currency && data.currency !== "NGN") return;
  const now = new Date();

  // 1. Fetch invoice document first to ensure it exists and get userId/newPeakBalanceUSD
  const invoice = await db.collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" ).findOne( {
    paystackReference: reference,
  } );

  if ( !invoice ) {
    console.warn( `[handlePerformanceFeePayment] Invoice not found for reference: ${ reference }` );
    return;
  }
  if (typeof data?.amount === "number" && Math.round(invoice.feeAmountNGN * 100) !== data.amount) {
    console.warn(`[handlePerformanceFeePayment] Amount mismatch for reference: ${reference}`);
    return;
  }

  // 2. Idempotency check — skip if already processed
  if ( invoice.status === "PAID" ) {
    return;
  }

  // 3. Mark invoice as PAID
  await db.collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" ).updateOne(
    { _id: invoice._id },
    {
      $set: {
        status: "PAID",
        paidAt: now,
        updatedAt: now,
      },
    }
  );

  // 4. Safely update the high-water mark now that payment is confirmed
  await db.collection<HighWaterMarkDoc>( "high_water_marks" ).updateOne(
    { userId: invoice.userId },
    {
      $set: {
        peakBalanceUSD: invoice.newPeakBalanceUSD,
        peakSetAt: now,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

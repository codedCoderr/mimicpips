import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import { initializePerformanceFeeCheckout } from "@/lib/paystack";
import { getErrorMessage } from "@/lib/errorMessage";
import type { PerformanceFeeInvoiceDoc } from "@/lib/saasTypes";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await getUserFromSessionToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : null;
  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId is required." }, { status: 400 });
  }

  let objectId: ObjectId;
  try {
    objectId = new ObjectId(invoiceId);
  } catch {
    return NextResponse.json({ error: "Invalid invoiceId." }, { status: 400 });
  }

  const db = await getSaasDb();
  const invoice = await db
    .collection<PerformanceFeeInvoiceDoc>("performance_fee_invoices")
    .findOne({ _id: objectId, userId: user._id! });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }
  if (invoice.status !== "PENDING_APPROVAL") {
    return NextResponse.json(
      { error: `This invoice is already ${invoice.status.toLowerCase()}.` },
      { status: 409 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { error: "Server is not configured (NEXT_PUBLIC_APP_URL missing)." },
      { status: 500 }
    );
  }

  const reference = `PERF-FEE-${invoiceId}-${randomUUID().slice(0, 8)}`;
  const claimed = await db.collection<PerformanceFeeInvoiceDoc>("performance_fee_invoices").findOneAndUpdate(
    { _id: objectId, userId: user._id!, status: "PENDING_APPROVAL" },
    { $set: { status: "APPROVED", paystackReference: reference, updatedAt: new Date() } },
    { returnDocument: "after" }
  );

  if (!claimed) {
    return NextResponse.json(
      { error: "This invoice is already being paid or has been paid." },
      { status: 409 }
    );
  }

  try {
    const checkout = await initializePerformanceFeeCheckout({
      email: user.email,
      amountNGN: invoice.feeAmountNGN,
      reference,
      callbackUrl: `${appUrl}/app/billing/callback`,
      metadata: { userId: user._id!.toString(), invoiceId, type: "performance_fee" },
    });

    return NextResponse.json({
      authorizationUrl: checkout.authorizationUrl,
      accessCode: checkout.accessCode,
    });
  } catch (err: unknown) {
    await db.collection<PerformanceFeeInvoiceDoc>("performance_fee_invoices").updateOne(
      { _id: objectId, paystackReference: reference, status: "APPROVED" },
      { $set: { status: "PENDING_APPROVAL", paystackReference: null, updatedAt: new Date() } }
    );
    return NextResponse.json(
      { error: getErrorMessage(err, "Could not start checkout.") },
      { status: 502 }
    );
  }
}

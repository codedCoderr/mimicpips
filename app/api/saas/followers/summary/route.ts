import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getSaasDb } from "@/lib/saasDb";
import type { UserDoc, SubscriptionDoc, PerformanceFeeInvoiceDoc } from "@/lib/saasTypes";

async function requireOperator(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return token ? !!(await verifySessionToken(token)) : false;
}

export interface FollowerSummary {
  totalFollowers: number;
  exchangeConnected: number;
  copyTradingActive: number;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  pendingInvoices: number;
  pendingInvoiceTotalNGN: number;
}

export async function GET(req: NextRequest) {
  if (!(await requireOperator(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getSaasDb();

  const [
    totalFollowers,
    exchangeConnected,
    copyTradingActive,
    activeSubscriptions,
    pastDueSubscriptions,
    pendingInvoices,
  ] = await Promise.all([
    db.collection<UserDoc>("users").countDocuments({ role: "follower" }),
    db.collection("exchange_keys").countDocuments({ verifiedAt: { $ne: null } }),
    db.collection<UserDoc>("users").countDocuments({ role: "follower", copyTradingEnabled: true }),
    db.collection<SubscriptionDoc>("subscriptions").countDocuments({ status: "ACTIVE" }),
    db.collection<SubscriptionDoc>("subscriptions").countDocuments({ status: "PAST_DUE" }),
    db
      .collection<PerformanceFeeInvoiceDoc>("performance_fee_invoices")
      .find({ status: "PENDING_APPROVAL" })
      .toArray(),
  ]);

  const pendingInvoiceTotalNGN = pendingInvoices.reduce(
    (sum, inv) => sum + (inv.feeAmountNGN ?? 0),
    0
  );

  const summary: FollowerSummary = {
    totalFollowers,
    exchangeConnected,
    copyTradingActive,
    activeSubscriptions,
    pastDueSubscriptions,
    pendingInvoices: pendingInvoices.length,
    pendingInvoiceTotalNGN,
  };

  return NextResponse.json(summary);
}

import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getSaasDb } from "@/lib/saasDb";
import type { UserDoc, SubscriptionDoc, PerformanceFeeInvoiceDoc } from "@/lib/saasTypes";
import { calculateFollowerHealth } from "@/lib/followerHealth";

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
  atRiskFollowers: number;
  anxiousFollowers: number;
  averageHealthScore: number;
}

export async function GET(req: NextRequest) {
  if (!(await requireOperator(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getSaasDb();

  const followerDocs = await db.collection<UserDoc>("users").find({ role: "follower" }).toArray();

  const [
    totalFollowers,
    exchangeConnected,
    copyTradingActive,
    activeSubscriptions,
    pastDueSubscriptions,
    pendingInvoices,
  ] = await Promise.all([
    Promise.resolve(followerDocs.length),
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

  const healthScores = await Promise.all( followerDocs.map( ( user ) => calculateFollowerHealth( db, user as UserDoc & { _id: ObjectId } ) ) );
  const atRiskFollowers = healthScores.filter( ( health ) => health.band === "likely_to_churn" ).length;
  const anxiousFollowers = healthScores.filter( ( health ) => health.band === "anxious" ).length;
  const averageHealthScore = healthScores.length > 0
    ? Math.round( healthScores.reduce( ( sum, health ) => sum + health.score, 0 ) / healthScores.length )
    : 100;

  const summary: FollowerSummary = {
    totalFollowers,
    exchangeConnected,
    copyTradingActive,
    activeSubscriptions,
    pastDueSubscriptions,
    pendingInvoices: pendingInvoices.length,
    pendingInvoiceTotalNGN,
    atRiskFollowers,
    anxiousFollowers,
    averageHealthScore,
  };

  return NextResponse.json(summary);
}

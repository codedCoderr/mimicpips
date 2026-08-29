import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import type { PerformanceFeeInvoiceDoc } from "@/lib/saasTypes";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await getUserFromSessionToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const db = await getSaasDb();
  const invoices = await db
    .collection<PerformanceFeeInvoiceDoc>("performance_fee_invoices")
    .find({ userId: user._id! })
    .sort({ createdAt: -1 })
    .toArray();

  return NextResponse.json({
    invoices: invoices.map((inv) => ({
      id: inv._id!.toString(),
      periodStart: inv.periodStart.toISOString(),
      periodEnd: inv.periodEnd.toISOString(),
      startBalanceUSD: inv.startBalanceUSD,
      endBalanceUSD: inv.endBalanceUSD,
      priorPeakBalanceUSD: inv.priorPeakBalanceUSD,
      profitAboveHighWaterMarkUSD: inv.profitAboveHighWaterMarkUSD,
      feePercent: inv.feePercent,
      feeAmountUSD: inv.feeAmountUSD,
      feeAmountNGN: inv.feeAmountNGN,
      usdToNgnRateAtInvoice: inv.usdToNgnRateAtInvoice,
      status: inv.status,
      createdAt: inv.createdAt.toISOString(),
      paidAt: inv.paidAt?.toISOString() ?? null,
    })),
  });
}
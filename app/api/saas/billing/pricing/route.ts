import { NextResponse } from "next/server";
import { convertUsdToNgn } from "@/lib/exchangeRate";
import { getErrorMessage } from "@/lib/errorMessage";

const MONTHLY_FEE_USD = 19;

export async function GET() {
  try {
    const monthlyFeeNGN = convertUsdToNgn(MONTHLY_FEE_USD);
    return NextResponse.json({ monthlyFeeUSD: MONTHLY_FEE_USD, monthlyFeeNGN });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err, "Could not load pricing.") }, { status: 500 });
  }
}

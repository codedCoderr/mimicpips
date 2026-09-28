import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { autoEnableCopyTradingGates, enforceCopyTradingGates } from "@/lib/cron/billingCron";

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enforcement = await enforceCopyTradingGates();
  const autoEnable = await autoEnableCopyTradingGates();

  return NextResponse.json({
    ok: true,
    enforcement,
    autoEnable,
  });
}

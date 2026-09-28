import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runBillingAndGateCycle } from "@/lib/cron/billingCron";

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runBillingAndGateCycle();
  return NextResponse.json({ ok: true, ...results });
}

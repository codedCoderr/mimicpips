import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runMarketingAutomationCycle } from "@/lib/marketingAutomation";

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runMarketingAutomationCycle();
  return NextResponse.json({ ok: true, results });
}

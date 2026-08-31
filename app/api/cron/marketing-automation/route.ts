import { NextRequest, NextResponse } from "next/server";
import { runMarketingAutomationCycle } from "@/lib/marketingAutomation";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runMarketingAutomationCycle();
  return NextResponse.json({ ok: true, results });
}

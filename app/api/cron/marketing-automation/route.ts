import { NextRequest, NextResponse } from "next/server";
import { runMarketingAutomationCycle } from "@/lib/marketingAutomation";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;

  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token === secret;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runMarketingAutomationCycle();
  return NextResponse.json({ ok: true, results });
}

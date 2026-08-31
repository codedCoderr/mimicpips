import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { runMarketingAutomationCycle } from "@/lib/marketingAutomation";

async function requireOperator(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return token ? !!(await verifySessionToken(token).catch(() => null)) : false;
}

export async function POST(req: NextRequest) {
  if (!(await requireOperator(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runMarketingAutomationCycle();
  return NextResponse.json({ ok: true, results });
}

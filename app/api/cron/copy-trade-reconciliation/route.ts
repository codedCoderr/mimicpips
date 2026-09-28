import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runCopyTradeReconciliation } from "@/lib/copyTradeReconciliation";

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 7;

  const report = await runCopyTradeReconciliation({
    days,
    applyRepairs: true,
  });

  return NextResponse.json({ ok: true, ...report });
}

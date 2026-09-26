import { NextRequest, NextResponse } from "next/server";
import { runCopyTradeReconciliation } from "@/lib/copyTradeReconciliation";

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

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 7;

  const report = await runCopyTradeReconciliation({
    days,
    applyRepairs: true,
  });

  return NextResponse.json({ ok: true, ...report });
}

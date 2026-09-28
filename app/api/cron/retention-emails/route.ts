import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { runRetentionEmailCycle } from "@/lib/retentionEmails";

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "true";
  const results = await runRetentionEmailCycle({ dryRun });
  return NextResponse.json({ ok: true, dryRun, results });
}

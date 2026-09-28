import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { refreshFollowerBalances } from "@/lib/balanceRefresh";
import { getErrorMessage } from "@/lib/errorMessage";

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await refreshFollowerBalances({ limit: 25 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: getErrorMessage(error, "Balance refresh failed.") }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { runCopyTradeReconciliation } from "@/lib/copyTradeReconciliation";
import { getErrorMessage } from "@/lib/errorMessage";

async function requireOperator(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return token ? !!(await verifySessionToken(token).catch(() => null)) : false;
}

function readDays(req: NextRequest): number {
  const days = Number(req.nextUrl.searchParams.get("days"));
  return Number.isFinite(days) && days > 0 ? days : 7;
}

export async function GET(req: NextRequest) {
  if (!(await requireOperator(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await runCopyTradeReconciliation({
      days: readDays(req),
      applyRepairs: false,
    });
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Copy-trade reconciliation failed.") },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!(await requireOperator(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await runCopyTradeReconciliation({
      days: readDays(req),
      applyRepairs: true,
    });
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Copy-trade reconciliation failed.") },
      { status: 500 }
    );
  }
}

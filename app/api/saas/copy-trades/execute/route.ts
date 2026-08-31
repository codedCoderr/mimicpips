import { NextRequest, NextResponse } from "next/server";
import { executeCopyTradeFanOut, hasStopLossProtection, parseLeaderTradeEvent } from "@/lib/copyTradeWorker";
import { getErrorMessage } from "@/lib/errorMessage";

interface BrokerEnvelope {
  payload?: unknown;
  data?: unknown;
}

function verifyServiceKey(req: NextRequest): boolean {
  const expected = process.env.SAAS_SERVICE_KEY;
  if (!expected) return false;
  return req.headers.get("x-service-key") === expected;
}

export async function POST(req: NextRequest) {
  if (!verifyServiceKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const envelope = body && typeof body === "object" ? body as BrokerEnvelope : null;
  const event = parseLeaderTradeEvent(envelope?.payload ?? envelope?.data ?? body);
  if (!event) {
    return NextResponse.json(
      {
        error:
          "Invalid leader trade event. Expected leaderTradeId, action, symbol, side, leaderNotional, and leaderBalance.",
      },
      { status: 400 }
    );
  }

  try {
    const results = await executeCopyTradeFanOut(event);
    const summary = {
      ok: true,
      leaderTradeId: event.leaderTradeId,
      action: event.action,
      totalFollowers: results.length,
      executed: results.filter((result) => result.status === "executed" || result.status === "closed").length,
      skipped: results.filter((result) => result.status.startsWith("skipped_")).length,
      failed: results.filter((result) => result.status === "failed").length,
      stopLossProtection: {
        present: hasStopLossProtection(event),
        type: event.stopLossType ?? null,
        price: event.stopLossPrice ?? null,
        atrPeriod: event.atrPeriod ?? null,
        atrMultiplier: event.atrMultiplier ?? null,
      },
      warnings:
        event.action === "OPEN" && !hasStopLossProtection(event)
          ? [
              "Bot payload did not include stopLossPrice, stopLoss, atrStopLoss, or atrStopLossPrice. Follower dashboard will show stop data as pending.",
            ]
          : [],
      results,
    };

    console.log(
      `[CopyTrade] ${event.action} ${event.symbol}: ${summary.executed} executed, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.totalFollowers} total.`
    );
    const firstIssue = results.find((result) => result.status !== "executed" && result.status !== "closed");
    if (firstIssue?.detail) {
      console.log(`[CopyTrade] first non-executed result: ${firstIssue.status} - ${firstIssue.detail}`);
    }
    if (summary.warnings.length > 0) {
      console.warn(`[CopyTrade] ${event.action} ${event.symbol}: ${summary.warnings[0]}`);
    }

    return NextResponse.json(summary);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Copy-trade fan-out failed.") },
      { status: 500 }
    );
  }
}

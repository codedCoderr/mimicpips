import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { executeCopyTradeFanOut, hasStopLossProtection, parseLeaderTradeEvent } from "@/lib/copyTradeWorker";
import { getErrorMessage } from "@/lib/errorMessage";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Receives position events from the bot's outbox and fans them out to
 * followers. This is the DEFAULT follower executor ("webhook" mode).
 *
 * If the bot is switched to COPY_TRADE_EXECUTOR=inprocess it stops calling
 * this route and executes followers itself. The two are mutually exclusive:
 * both active would place every follower order twice, so do not reconnect
 * this route to a bot that is running the in-process worker.
 * ─────────────────────────────────────────────────────────────────────────
 */

interface BrokerEnvelope {
  payload?: unknown;
  data?: unknown;
}

function verifyServiceKey(req: NextRequest): boolean {
  const expected = process.env.SAAS_SERVICE_AUTH_KEY;
  if (!expected) return false;
  const presented = req.headers.get("x-service-key");
  if (!presented) return false;

  // Timing-safe comparison, not === : a plain string equality check
  // short-circuits on the first mismatched character, leaking timing
  // information about how many leading characters were correct. Same
  // reasoning as lib/paystack.ts's verifyWebhookSignature. Both buffers
  // must be equal length or timingSafeEqual throws, so that's checked
  // first — a length mismatch is already definitive proof of an invalid
  // key, no timing risk there.
  const expectedBuffer = Buffer.from(expected);
  const presentedBuffer = Buffer.from(presented);
  if (expectedBuffer.length !== presentedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, presentedBuffer);
}

function isActionableIssue(status: string): boolean {
  return status === "failed" || (status.startsWith("skipped_") && status !== "skipped_duplicate");
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
          "Invalid leader trade event. Expected leaderTradeId, action, symbol, and side. OPEN events also require leaderNotional and leaderBalance.",
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
      skipped: results.filter((result) => result.status.startsWith("skipped_") && result.status !== "skipped_duplicate").length,
      alreadyHandled: results.filter((result) => result.status === "skipped_duplicate").length,
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
      `[CopyTrade] ${event.action} ${event.symbol}: ${summary.executed} executed, ${summary.skipped} skipped, ${summary.alreadyHandled} already handled, ${summary.failed} failed, ${summary.totalFollowers} total.`
    );
    const firstIssue = results.find((result) => isActionableIssue(result.status));
    if (firstIssue?.detail) {
      console.log(`[CopyTrade] first actionable issue: ${firstIssue.status} - ${firstIssue.detail}`);
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

import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getBotDb, getSaasDb } from "@/lib/saasDb";
import { getErrorMessage } from "@/lib/errorMessage";
import type { CopyTradeLogDoc, CopyTradeLogStatus } from "@/lib/saasTypes";
import { ObjectId, type Document } from "mongodb";

type CopyTradeLogResponseDoc = CopyTradeLogDoc & {
  symbol?: string;
  side?: "LONG" | "SHORT";
  entryPrice?: number;
  exitPrice?: number;
  stopLossPrice?: number | null;
  stopLossType?: "ATR" | "manual" | "unknown" | null;
  atrPeriod?: number | null;
  atrMultiplier?: number | null;
  marginAllocated?: number;
  realizedPnl?: number;
  roiPercentage?: number;
  roi?: number;
  pnl?: number;
  status?: CopyTradeLogStatus | "SUCCESS";
  executedAt?: Date;
};

const BOT_TRADES_COLLECTION = "futures_history";

function toBinanceSymbol(symbol: string): string {
  return symbol.replace(":USDT", "").replace("/", "");
}

async function fetchBinanceFuturesPrice(symbol: string): Promise<number | null> {
  const marketSymbol = toBinanceSymbol(symbol);
  if (!/^[A-Z0-9]+USDT$/.test(marketSymbol)) return null;

  const baseUrl =
    process.env.TRADING_MODE === "LIVE"
      ? "https://fapi.binance.com"
      : "https://demo-fapi.binance.com";

  const response = await fetch(`${baseUrl}/fapi/v1/ticker/price?symbol=${marketSymbol}`, {
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;

  const data = await response.json().catch(() => null) as { price?: string } | null;
  const price = Number(data?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function calculateUnrealizedPnl(entry: CopyTradeLogResponseDoc, markPrice: number | null): {
  pnl: number;
  roi: number;
} {
  const entryPrice = Number(entry.entryPrice ?? 0);
  const notional = Number(entry.followerNotional ?? entry.marginAllocated ?? 0);
  if (
    entry.action !== "OPEN" ||
    entry.status !== "executed" ||
    !markPrice ||
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(notional) ||
    notional <= 0
  ) {
    return {
      pnl: Number(entry.realizedPnl ?? entry.pnl ?? 0) || 0,
      roi: Number(entry.roiPercentage ?? entry.roi ?? 0) || 0,
    };
  }

  const direction = entry.leaderSide === "SHORT" || entry.side === "SHORT" ? -1 : 1;
  const pnl = ((markPrice - entryPrice) / entryPrice) * notional * direction;
  return {
    pnl,
    roi: (pnl / notional) * 100,
  };
}

function calculateClosedPnlFromPrices(
  entry: CopyTradeLogResponseDoc,
  entryPrice: number,
  exitPrice: number,
  notional: number
): { pnl: number; roi: number } | null {
  if (
    entry.action !== "CLOSE" ||
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(exitPrice) ||
    exitPrice <= 0 ||
    !Number.isFinite(notional) ||
    notional <= 0
  ) {
    return null;
  }

  const direction = entry.leaderSide === "SHORT" || entry.side === "SHORT" ? -1 : 1;
  const pnl = ((exitPrice - entryPrice) / entryPrice) * notional * direction;
  return {
    pnl,
    roi: (pnl / notional) * 100,
  };
}

function readPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function leaderHistoryPrices(doc: Document | undefined): {
  entryPrice: number | null;
  exitPrice: number | null;
} {
  if (!doc) {
    return {
      entryPrice: null,
      exitPrice: null,
    };
  }

  return {
    entryPrice: readPositiveNumber(doc.entryPrice, doc.avgEntryPrice),
    exitPrice: readPositiveNumber(doc.exitPrice, doc.stopLossHitPrice, doc.stopLoss, doc.avgExitPrice),
  };
}

function userFacingCopyTradeDetail(status: string, detail: string | null | undefined): string | null {
  if (!detail) return null;
  const lower = detail.toLowerCase();

  if (lower.includes("request timed out") || lower.includes("fetch failed") || lower.includes("econnreset")) {
    return "Binance demo did not respond in time. The system will retry automatically when the connection is stable.";
  }
  if (
    lower.includes("invalid api-key") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid api-key id") ||
    lower.includes("api-key") ||
    lower.includes("apikey") ||
    lower.includes("authentication") ||
    lower.includes("credential") ||
    lower.includes("permission")
  ) {
    return "Your Binance Futures API key could not be used. Reconnect a valid key with Futures permission enabled and withdrawals disabled.";
  }
  if (lower.includes("already flat") || lower.includes("no matching follower position is open")) {
    return "Follower position is already closed.";
  }
  if (status.startsWith("skipped_")) {
    return detail.replace(/^skipped[_\s-]*/i, "");
  }
  return detail.length > 140 ? `${detail.slice(0, 137)}...` : detail;
}

function isAlreadyClosedDetail(detail: string | null | undefined): boolean {
  if (!detail) return false;
  const lower = detail.toLowerCase();
  return lower.includes("already flat") ||
    lower.includes("already closed") ||
    lower.includes("no matching follower position is open");
}

export async function GET ( req: NextRequest ) {
  const token = req.cookies.get( COOKIE_NAME )?.value;
  let user = null;
  try {
    user = token ? await getUserFromSessionToken( token ) : null;
  } catch ( error ) {
    console.error( "GET /api/saas/copy-trade-log auth error:", getErrorMessage( error, "database unavailable" ) );
    return NextResponse.json(
      { error: "Dashboard database is temporarily unavailable." },
      { status: 503 }
    );
  }
  if ( !user ) {
    return NextResponse.json( { error: "Not signed in." }, { status: 401 } );
  }

  const limitParam = Number( req.nextUrl.searchParams.get( "limit" ) );
  const limit = Number.isFinite( limitParam ) && limitParam > 0 ? Math.min( limitParam, 50 ) : 20;

  try {
    const db = await getSaasDb();
    const entries = await db
      .collection<CopyTradeLogResponseDoc>( "copy_trade_log" )
      .find( { userId: user._id! } )
      .sort( { createdAt: -1 } )
      .limit( limit )
      .toArray();

    const leaderTradeIds = Array.from(
      new Set(entries.map((entry) => entry.leaderTradeId).filter(Boolean))
    );
    const openEntries = leaderTradeIds.length > 0
      ? await db
          .collection<CopyTradeLogResponseDoc>("copy_trade_log")
          .find({
            userId: user._id!,
            action: "OPEN",
            leaderTradeId: { $in: leaderTradeIds },
          })
          .toArray()
      : [];
    const openByLeaderTradeId = new Map(
      openEntries.map((entry) => [entry.leaderTradeId, entry])
    );
    const objectLeaderTradeIds = leaderTradeIds.filter((id): id is string => (
      typeof id === "string" && ObjectId.isValid(id)
    )).map((id) => new ObjectId(id));
    const leaderHistoryDocs = leaderTradeIds.length > 0
      ? await (await getBotDb())
          .collection<Document>(BOT_TRADES_COLLECTION)
          .find({
            $or: [
              { tradeId: { $in: leaderTradeIds } },
              { leaderTradeId: { $in: leaderTradeIds } },
              { id: { $in: leaderTradeIds } },
              ...(objectLeaderTradeIds.length > 0 ? [{ _id: { $in: objectLeaderTradeIds } }] : []),
            ],
          })
          .toArray()
      : [];
    const leaderHistoryByTradeId = new Map<string, Document>();
    for (const doc of leaderHistoryDocs) {
      for (const key of [doc._id?.toString(), doc.tradeId, doc.leaderTradeId, doc.id]) {
        if (typeof key === "string" && key) leaderHistoryByTradeId.set(key, doc);
      }
    }

    const priceBySymbol = new Map<string, number | null>();
    await Promise.all(
      Array.from(new Set(entries.map((entry) => entry.leaderSymbol).filter(Boolean))).map(async (symbol) => {
        priceBySymbol.set(symbol, await fetchBinanceFuturesPrice(symbol));
      })
    );

    return NextResponse.json( {
      entries: entries.map( ( e ) => {
        const symbol = e.symbol || e.leaderSymbol || "UNKNOWN";
        const openEntry = e.leaderTradeId ? openByLeaderTradeId.get(e.leaderTradeId) : undefined;
        const leaderPrices = leaderHistoryPrices(
          e.leaderTradeId ? leaderHistoryByTradeId.get(e.leaderTradeId) : undefined
        );
        const entryPrice = e.entryPrice ?? openEntry?.entryPrice ?? leaderPrices.entryPrice ?? 0;
        const stopLossPrice = e.stopLossPrice ?? openEntry?.stopLossPrice ?? null;
        const recordedExitPrice = e.exitPrice ?? 0;
        const exitPrice = e.action === "CLOSE" && (!recordedExitPrice || recordedExitPrice <= 0)
          ? leaderPrices.exitPrice ?? stopLossPrice ?? 0
          : recordedExitPrice;
        const notional = e.marginAllocated ?? e.followerNotional ?? openEntry?.followerNotional ?? openEntry?.marginAllocated ?? 0;
        const storedPnl = Number(e.realizedPnl ?? e.pnl ?? 0) || 0;
        const storedRoi = Number(e.roiPercentage ?? e.roi ?? 0) || 0;
        const priceBasedClose = calculateClosedPnlFromPrices(e, entryPrice, exitPrice, notional);
        const shouldRepairClosePnl = e.action === "CLOSE" && priceBasedClose && Math.abs(storedPnl) < 0.000001;
        const { pnl, roi } = shouldRepairClosePnl
          ? priceBasedClose
          : calculateUnrealizedPnl(e, priceBySymbol.get(symbol) ?? null);
        const closeResolvedFromPrices = e.action === "CLOSE" && !!priceBasedClose;
        const effectiveStatus = closeResolvedFromPrices && e.status === "failed"
          ? "closed"
          : e.status || "SUCCESS";
        const effectiveDetail = closeResolvedFromPrices && (e.status === "failed" || isAlreadyClosedDetail(e.detail))
          ? null
          : userFacingCopyTradeDetail(e.status || "SUCCESS", e.detail);
        return {
          id: e._id!.toString(),
          leaderTradeId: e.leaderTradeId,
          action: e.action ?? "OPEN",
          symbol,
          side: e.side || e.leaderSide || "LONG",
          entryPrice,
          exitPrice,
          stopLossPrice,
          stopLossType: e.stopLossType ?? openEntry?.stopLossType ?? null,
          atrPeriod: e.atrPeriod ?? openEntry?.atrPeriod ?? null,
          atrMultiplier: e.atrMultiplier ?? openEntry?.atrMultiplier ?? null,
          marginAllocated: notional,
          followerNotional: notional,
          realizedPnl: Number.isFinite(pnl) ? pnl : storedPnl,
          roiPercentage: Number.isFinite(roi) ? roi : storedRoi,
          status: effectiveStatus,
          detail: effectiveDetail,
          executedAt: e.executedAt
            ? new Date( e.executedAt ).toISOString()
            : e.createdAt
              ? new Date( e.createdAt ).toISOString()
              : new Date().toISOString(),
          createdAt: e.createdAt ? new Date( e.createdAt ).toISOString() : new Date().toISOString(),
        };
      } ),
    } );
  } catch ( error ) {
    console.error( "GET /api/saas/copy-trade-log error:", getErrorMessage( error, "database unavailable" ) );
    return NextResponse.json(
      { error: "Copy-trade activity is temporarily unavailable." },
      { status: 503 }
    );
  }
}

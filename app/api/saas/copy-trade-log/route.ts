import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import { getErrorMessage } from "@/lib/errorMessage";
import type { CopyTradeLogDoc, CopyTradeLogStatus } from "@/lib/saasTypes";

type CopyTradeLogResponseDoc = CopyTradeLogDoc & {
  symbol?: string;
  side?: "LONG" | "SHORT";
  entryPrice?: number;
  exitPrice?: number;
  marginAllocated?: number;
  realizedPnl?: number;
  roiPercentage?: number;
  roi?: number;
  pnl?: number;
  status?: CopyTradeLogStatus | "SUCCESS";
  executedAt?: Date;
};

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

    const priceBySymbol = new Map<string, number | null>();
    await Promise.all(
      Array.from(new Set(entries.map((entry) => entry.leaderSymbol).filter(Boolean))).map(async (symbol) => {
        priceBySymbol.set(symbol, await fetchBinanceFuturesPrice(symbol));
      })
    );

    return NextResponse.json( {
      entries: entries.map( ( e ) => {
        const symbol = e.symbol || e.leaderSymbol || "UNKNOWN";
        const { pnl, roi } = calculateUnrealizedPnl(e, priceBySymbol.get(symbol) ?? null);
        return {
          id: e._id!.toString(),
          leaderTradeId: e.leaderTradeId,
          action: e.action ?? "OPEN",
          symbol,
          side: e.side || e.leaderSide || "LONG",
          entryPrice: e.entryPrice ?? 0,
          exitPrice: e.exitPrice ?? 0,
          marginAllocated: e.marginAllocated ?? e.followerNotional ?? 0,
          followerNotional: e.followerNotional ?? e.marginAllocated ?? 0,
          realizedPnl: pnl,
          roiPercentage: roi,
          status: e.status || "SUCCESS",
          detail: userFacingCopyTradeDetail(e.status || "SUCCESS", e.detail),
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

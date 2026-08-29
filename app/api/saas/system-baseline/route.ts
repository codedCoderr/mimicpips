import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, getUserFromSessionToken } from "@/lib/saasAuth";
import {
  getCopyTradeMinActivationBalanceUSDT,
  getCopyTradePauseBalanceUSDT,
  getCopyTradeWarnBalanceUSDT,
  getMinimumCopyTradeOrderNotionalUSDT,
} from "@/lib/copyTradeSizing";

interface BotSystemBaselineResponse {
  days: number;
  totalTrades: number;
  historicalWinRatePct: number | null;
  maxDrawdownPct: number | null;
  riskPerTradePct: number | null;
  maxAccountExposurePct: number | null;
  maxPositions: number | null;
  marginMode: string | null;
  source: string;
  minCopyTradeNotionalUSDT?: number;
  minActivationBalanceUSDT?: number;
  warnBalanceUSDT?: number;
  pauseBalanceUSDT?: number;
  minOrderNotionalUSDT?: number;
}

const DEFAULT_DAYS = 180;

export async function GET ( req: NextRequest ) {
  const token = req.cookies.get( COOKIE_NAME )?.value;
  const user = token ? await getUserFromSessionToken( token ) : null;
  if ( !user ) {
    return NextResponse.json( { error: "Not signed in." }, { status: 401 } );
  }

  const botUrl = process.env.BOT_SERVER_URL;
  const serviceKey = process.env.SAAS_SERVICE_KEY;
  if ( !botUrl || !serviceKey ) {
    return NextResponse.json(
      { error: "Server is not configured (BOT_SERVER_URL / SAAS_SERVICE_KEY missing)." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL( req.url );
  const requestedDays = Number( searchParams.get( "days" ) );
  const days = Number.isFinite( requestedDays ) && requestedDays > 0
    ? Math.min( requestedDays, 3650 )
    : DEFAULT_DAYS;

  try {
    const res = await fetch(
      `${ botUrl.replace( /\/+$/, "" ) }/api/saas/system-baseline?days=${ days }`,
      {
        headers: {
          "X-Service-Key": serviceKey,
        },
        cache: "no-store",
      }
    );

    if ( !res.ok ) {
      return NextResponse.json(
        { error: `Baseline service returned an error (${ res.status }).` },
        { status: 502 }
      );
    }

    const baseline = ( await res.json() ) as BotSystemBaselineResponse;
    return NextResponse.json( {
      ...baseline,
      minCopyTradeNotionalUSDT: getCopyTradeMinActivationBalanceUSDT(),
      minActivationBalanceUSDT: getCopyTradeMinActivationBalanceUSDT(),
      warnBalanceUSDT: getCopyTradeWarnBalanceUSDT(),
      pauseBalanceUSDT: getCopyTradePauseBalanceUSDT(),
      minOrderNotionalUSDT: getMinimumCopyTradeOrderNotionalUSDT(),
    } );
  } catch {
    return NextResponse.json(
      { error: "Could not reach the baseline service. Try again shortly." },
      { status: 502 }
    );
  }
}

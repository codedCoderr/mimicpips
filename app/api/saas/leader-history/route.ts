import { NextRequest, NextResponse } from "next/server";
import type { Document, Filter } from "mongodb";
import { COOKIE_NAME, verifySessionToken } from "@/lib/saasAuth";
import { getBotDb } from "@/lib/saasDb";

const BOT_TRADES_COLLECTION = "futures_history";

function getStartDate ( filter: string ): Date | null {
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Create a clean date object representing today at midnight
  const now = new Date();
  now.setHours( 0, 0, 0, 0 );

  switch ( filter ) {
    case "7D":
      // Goes back 7 full days from midnight today
      return new Date( now.getTime() - 7 * DAY_MS );
    case "1M":
      return new Date( now.getTime() - 30 * DAY_MS );
    case "3M":
      return new Date( now.getTime() - 90 * DAY_MS );
    case "1Y":
      return new Date( now.getTime() - 365 * DAY_MS );
    case "ALL":
    default:
      return null;
  }
}

function cleanSymbol ( rawSymbol?: string ): string {
  if ( !rawSymbol ) return "UNKNOWN";
  // Transforms "BOME/USDT:USDT" -> "BOME/USDT"
  return rawSymbol.split( ":" )[ 0 ];
}

export async function GET ( req: NextRequest ) {
  try {
    const token = req.cookies.get( COOKIE_NAME )?.value;
    if ( !token ) {
      return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
    }

    const session = await verifySessionToken( token );
    if ( !session ) {
      return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
    }

    const { searchParams } = new URL( req.url );
    const filter = ( searchParams.get( "filter" ) || "1M" ).toUpperCase();
    const startDate = getStartDate( filter );

    const db = await getBotDb();
    const collection = db.collection( BOT_TRADES_COLLECTION );

    // Build query matching either closedAt or exitTime if a date filter exists
    const baseQuery: Filter<Document> = {
      status: { $in: [ "CLOSED", "closed" ] },
    };

    let matchQuery = baseQuery;
    if ( startDate ) {
      matchQuery = {
        ...baseQuery,
        $or: [
          { closedAt: { $gte: startDate } },
          { exitTime: { $gte: startDate } }
        ]
      };
    }

    // Expression to dynamically compute ROI % if not present in doc
    const computedRoiExpr = {
      $ifNull: [
        "$roiPercentage",
        {
          $ifNull: [
            "$roi",
            {
              $cond: [
                { $gt: [ { $ifNull: [ "$marginUsed", 0 ] }, 0 ] },
                {
                  $multiply: [
                    {
                      $divide: [
                        { $ifNull: [ "$realizedPnL", { $ifNull: [ "$pnl", 0 ] } ] },
                        "$marginUsed",
                      ],
                    },
                    100,
                  ],
                },
                0,
              ],
            },
          ],
        },
      ],
    };

    const statsAggregation = await collection
      .aggregate( [
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalTrades: { $sum: 1 },
            winningTrades: {
              $sum: {
                $cond: [
                  { $gt: [ { $ifNull: [ "$realizedPnL", { $ifNull: [ "$pnl", 0 ] } ] }, 0 ] },
                  1,
                  0,
                ],
              },
            },
            totalProfitPercent: {
              $sum: computedRoiExpr,
            },
            totalPnl: {
              $sum: { $ifNull: [ "$realizedPnL", { $ifNull: [ "$pnl", 0 ] } ] },
            },
          },
        },
      ] )
      .toArray();

    const rawStats = statsAggregation[ 0 ] || {
      totalTrades: 0,
      winningTrades: 0,
      totalProfitPercent: 0,
      totalPnl: 0,
    };

    const winRate =
      rawStats.totalTrades > 0
        ? Number( ( ( rawStats.winningTrades / rawStats.totalTrades ) * 100 ).toFixed( 2 ) )
        : 0;

    const stats = {
      winRate,
      totalProfitPercent: Number( rawStats.totalProfitPercent.toFixed( 2 ) ),
      totalTrades: rawStats.totalTrades,
      pnl: Number( rawStats.totalPnl.toFixed( 2 ) ),
    };

    const tradeDocs = await collection
      .find( matchQuery )
      .sort( { closedAt: -1, exitTime: -1 } ) // Sort safely by whichever exists
      .limit( 100 )
      .toArray();

    const trades = tradeDocs.map( ( doc ) => {
      const pnl = doc.realizedPnL ?? doc.pnl ?? 0;
      const margin = doc.marginUsed || 0;

      let roi = doc.roiPercentage ?? doc.roi;
      if ( roi === undefined || roi === null ) {
        roi = margin > 0 ? ( pnl / margin ) * 100 : 0;
      }

      const exitPrice =
        doc.exitPrice && doc.exitPrice > 0
          ? doc.exitPrice
          : doc.stopLossHitPrice || doc.stopLoss || doc.avgExitPrice || 0;

      // Fallback timestamp for mapping
      const timestampField = doc.closedAt || doc.exitTime;

      return {
        id: doc._id.toString(),
        symbol: cleanSymbol( doc.symbol || doc.leaderSymbol ),
        side: doc.side || doc.leaderSide || "LONG",
        entryPrice: doc.entryPrice ?? doc.avgEntryPrice ?? 0,
        exitPrice,
        roiPercentage: Number( Number( roi ).toFixed( 2 ) ),
        realizedPnl: Number( Number( pnl ).toFixed( 2 ) ),
        closedAt: timestampField
          ? new Date( timestampField ).toISOString()
          : new Date().toISOString(),
      };
    } );

    return NextResponse.json( {
      filter,
      stats,
      trades,
    } );
  } catch ( error ) {
    console.error( "GET /api/saas/leader-history error:", error );
    return NextResponse.json(
      { error: "Failed to fetch leader performance history." },
      { status: 500 }
    );
  }
}

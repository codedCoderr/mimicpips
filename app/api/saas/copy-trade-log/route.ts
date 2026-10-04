import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getBotDb, getSaasDb } from "@/lib/saasDb";
import { getErrorMessage } from "@/lib/errorMessage";
import type { CopyTradeLogStatus } from "@/lib/saasTypes";
import { ObjectId, type Document } from "mongodb";
import {
  BOT_TRADES_COLLECTION,
  fetchBinanceFuturesPrice,
  leaderHistoryPrices,
  calculateUnrealizedPnl,
  calculateClosedPnlFromPrices,
  userFacingCopyTradeDetail,
  isAlreadyClosedDetail,
  isResolvedStaleOpenDetail,
  isPnlOnlyCloseFailure,
  mergeCloseEntries,
  type CopyTradeLogResponseDoc,
} from "@/lib/copyTradeLogDisplay";

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

    // Fetch CLOSE rows for every leaderTradeId seen above, the same way
    // openEntries fetches OPEN rows — but UNION the result into what's
    // actually sent to the client, not just used for enrichment.
    //
    // Without this, a trade whose OPEN row is recent enough to fall inside
    // the top-`limit` entries (sorted by createdAt desc) but whose CLOSE
    // row is older or was written separately (e.g. by reconciliation, on
    // its own schedule, well after the OPEN) can have its CLOSE row fall
    // OUTSIDE that same window. The dashboard's own OPEN/CLOSE pairing
    // logic is correct — a CLOSE row always wins when present — but it has
    // nothing to pair against if the CLOSE row was never sent to the
    // client at all. That produced exactly this symptom: a trade genuinely
    // closed on the exchange, with a CLOSE row already correctly written
    // in the database (by last session's reconciliation fix), still shown
    // as "open" on the dashboard — not because detection or the close
    // itself failed, but because this endpoint dropped the proof of it.
    const closeEntries = leaderTradeIds.length > 0
      ? await db
          .collection<CopyTradeLogResponseDoc>("copy_trade_log")
          .find({
            userId: user._id!,
            action: "CLOSE",
            leaderTradeId: { $in: leaderTradeIds },
          })
          .toArray()
      : [];
    const mergedEntries = mergeCloseEntries(entries, closeEntries);
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
      entries: mergedEntries.map( ( e ) => {
        const symbol = e.symbol || e.leaderSymbol || "UNKNOWN";
        const markPrice = e.action === "OPEN"
          ? priceBySymbol.get(e.leaderSymbol) ?? priceBySymbol.get(symbol) ?? null
          : null;
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
        // Only ever repair PnL on a row that is ALREADY "closed" (or on
        // the one named pnl-not-recorded failure case below) — never on
        // an arbitrary "failed" row just because a price happens to be
        // available. See closeResolvedFromPrices below for why this
        // matters: this flag used to feed a status upgrade too.
        const shouldRepairClosePnl =
          e.action === "CLOSE" &&
          priceBasedClose &&
          Math.abs(storedPnl) < 0.000001 &&
          (e.status === "closed" || isPnlOnlyCloseFailure(e.detail));
        const { pnl, roi } = shouldRepairClosePnl
          ? priceBasedClose
          : calculateUnrealizedPnl(e, markPrice);
        // Narrowed on purpose: this used to be "any failed CLOSE we can
        // compute a plausible price for", which silently relabelled real
        // close failures (couldn't read positions, order rejected, etc.)
        // as "Closed" and erased the detail explaining why — hiding a
        // follower's live, possibly unprotected position from both the
        // dashboard and reconciliation. It now only resolves the one
        // documented case: the order closed but PnL wasn't recorded.
        const closeResolvedFromPrices =
          e.action === "CLOSE" && !!priceBasedClose && isPnlOnlyCloseFailure(e.detail);
        const staleOpenResolved = e.action === "OPEN" && e.status === "failed" && isResolvedStaleOpenDetail(e.detail);
        let effectiveStatus: CopyTradeLogStatus | "SUCCESS" = e.status || "SUCCESS";
        let effectiveDetail = userFacingCopyTradeDetail(e.status || "SUCCESS", e.detail);

        if (closeResolvedFromPrices && e.status === "failed") {
          effectiveStatus = "closed";
        }
        if (staleOpenResolved) {
          effectiveStatus = "skipped_duplicate";
        }
        if (
          staleOpenResolved ||
          (closeResolvedFromPrices && (e.status === "failed" || isAlreadyClosedDetail(e.detail)))
        ) {
          effectiveDetail = null;
        }
        return {
          id: e._id!.toString(),
          leaderTradeId: e.leaderTradeId,
          action: e.action ?? "OPEN",
          symbol,
          side: e.side || e.leaderSide || "LONG",
          entryPrice,
          markPrice,
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

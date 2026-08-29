import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";

// Ensure this points strictly to saasAuth
import { COOKIE_NAME as SAAS_COOKIE_NAME, verifySessionToken } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import type {
  UserDoc,
  ExchangeKeyDoc,
  SubscriptionDoc,
  PerformanceFeeInvoiceDoc,
} from "@/lib/saasTypes";
import {
  getCopyTradeMinActivationBalanceUSDT,
  getCopyTradePauseBalanceUSDT,
  getCopyTradeWarnBalanceUSDT,
} from "@/lib/copyTradeSizing";

async function getSessionUser ( req: NextRequest ) {
  const token = req.cookies.get( SAAS_COOKIE_NAME )?.value;
  if ( !token ) return null;

  const session = await verifySessionToken( token );
  if ( !session ) return null;

  const userId = session.userId;
  if ( !userId || typeof userId !== "string" ) return null;

  try {
    return { userId, objectId: new ObjectId( userId ) };
  } catch {
    return null;
  }
}

export async function GET ( req: NextRequest ) {
  try {
    const sessionUser = await getSessionUser( req );
    if ( !sessionUser ) {
      return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
    }

    const db = await getSaasDb();
    const { objectId } = sessionUser;

    const [ user, key, sub, pendingInvoice ] = await Promise.all( [
      db.collection<UserDoc>( "users" ).findOne( { _id: objectId } ),
      db.collection<ExchangeKeyDoc>( "exchange_keys" ).findOne( { userId: objectId } ),
      db.collection<SubscriptionDoc>( "subscriptions" ).findOne( { userId: objectId } ),
      db
        .collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" )
        .findOne( { userId: objectId, status: { $in: [ "PENDING_APPROVAL", "APPROVED" ] } } ),
    ] );

    if ( !user ) {
      return NextResponse.json( { error: "User not found." }, { status: 404 } );
    }

    const emailVerified = !!user.emailVerified;
    const exchangeConnected = !!key?.verifiedAt;
    const minActivationBalanceUSDT = getCopyTradeMinActivationBalanceUSDT();
    const warnBalanceUSDT = getCopyTradeWarnBalanceUSDT();
    const pauseBalanceUSDT = getCopyTradePauseBalanceUSDT();
    const minimumBalanceMet = exchangeConnected && Number( key?.lastKnownBalanceUSDT ?? 0 ) >= minActivationBalanceUSDT;
    const subscriptionActive = sub?.status === "ACTIVE";
    const noPendingInvoice = !pendingInvoice;
    const allGatesMet = emailVerified && exchangeConnected && minimumBalanceMet && subscriptionActive && noPendingInvoice;

    return NextResponse.json( {
      copyTradingEnabled: !!user.copyTradingEnabled,
      gates: {
        emailVerified,
        exchangeConnected,
        minimumBalanceMet,
        minCopyTradeNotionalUSDT: minActivationBalanceUSDT,
        minActivationBalanceUSDT,
        warnBalanceUSDT,
        pauseBalanceUSDT,
        subscriptionActive,
        noPendingInvoice,
        allGatesMet,
      },
    } );
  } catch ( error ) {
    console.error( "GET /api/saas/copy-trading error:", error );
    return NextResponse.json( { error: "Internal server error" }, { status: 500 } );
  }
}

export async function POST ( req: NextRequest ) {
  try {
    const sessionUser = await getSessionUser( req );
    if ( !sessionUser ) {
      return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
    }

    const body = await req.json().catch( () => null );
    const enabled = typeof body?.enabled === "boolean" ? body.enabled : null;

    if ( enabled === null ) {
      return NextResponse.json(
        { error: "enabled (boolean) is required." },
        { status: 400 }
      );
    }

    const db = await getSaasDb();
    const { objectId } = sessionUser;

    const [ user, key, sub, pendingInvoice ] = await Promise.all( [
      db.collection<UserDoc>( "users" ).findOne( { _id: objectId } ),
      db.collection<ExchangeKeyDoc>( "exchange_keys" ).findOne( { userId: objectId } ),
      db.collection<SubscriptionDoc>( "subscriptions" ).findOne( { userId: objectId } ),
      db
        .collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" )
        .findOne( { userId: objectId, status: { $in: [ "PENDING_APPROVAL", "APPROVED" ] } } ),
    ] );

    if ( !user ) {
      return NextResponse.json( { error: "User not found." }, { status: 404 } );
    }

    const emailVerified = !!user.emailVerified;
    const exchangeConnected = !!key?.verifiedAt;
    const minActivationBalanceUSDT = getCopyTradeMinActivationBalanceUSDT();
    const warnBalanceUSDT = getCopyTradeWarnBalanceUSDT();
    const pauseBalanceUSDT = getCopyTradePauseBalanceUSDT();
    const minimumBalanceMet = exchangeConnected && Number( key?.lastKnownBalanceUSDT ?? 0 ) >= minActivationBalanceUSDT;
    const subscriptionActive = sub?.status === "ACTIVE";
    const noPendingInvoice = !pendingInvoice;
    const allGatesMet = emailVerified && exchangeConnected && minimumBalanceMet && subscriptionActive && noPendingInvoice;

    const gates = {
      emailVerified,
      exchangeConnected,
      minimumBalanceMet,
      minCopyTradeNotionalUSDT: minActivationBalanceUSDT,
      minActivationBalanceUSDT,
      warnBalanceUSDT,
      pauseBalanceUSDT,
      subscriptionActive,
      noPendingInvoice,
      allGatesMet,
    };

    if ( enabled && !allGatesMet ) {
      const missing: string[] = [];
      if ( !emailVerified ) missing.push( "email verification" );
      if ( !exchangeConnected ) missing.push( "connected exchange key" );
      if ( exchangeConnected && !minimumBalanceMet ) missing.push( `at least $${ minActivationBalanceUSDT.toFixed( 2 ) } available balance to start` );
      if ( !subscriptionActive ) missing.push( "active subscription" );
      if ( !noPendingInvoice ) missing.push( "settled invoices" );

      return NextResponse.json(
        {
          error: `Cannot enable copy trading. Missing: ${ missing.join( ", " ) }.`,
          gates,
        },
        { status: 409 }
      );
    }

    await db
      .collection<UserDoc>( "users" )
      .updateOne( { _id: objectId }, { $set: { copyTradingEnabled: enabled } } );

    return NextResponse.json( {
      ok: true,
      copyTradingEnabled: enabled,
      gates,
    } );
  } catch ( error ) {
    console.error( "POST /api/saas/copy-trading error:", error );
    return NextResponse.json( { error: "Internal server error" }, { status: 500 } );
  }
}

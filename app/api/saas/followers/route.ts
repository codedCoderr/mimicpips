import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getSaasDb } from "@/lib/saasDb";
import { getCopyTradeMinActivationBalanceUSDT } from "@/lib/copyTradeSizing";
import type { UserDoc, ExchangeKeyDoc, SubscriptionDoc, PerformanceFeeInvoiceDoc } from "@/lib/saasTypes";
import { calculateFollowerHealth, type FollowerHealthScore } from "@/lib/followerHealth";

async function requireOperator ( req: NextRequest ): Promise<boolean> {
  try {
    const token = req.cookies.get( COOKIE_NAME )?.value;
    return token ? !!await verifySessionToken( token ) : false;
  } catch {
    return false;
  }
}

export interface FollowerListItem {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  emailVerified: boolean;
  exchangeConnected: boolean;
  lastKnownBalanceUSDT: number | null;
  lastBalanceCheckAt: string | null;
  copyTradingEnabled: boolean;
  subscriptionStatus: string | null;
  pendingInvoiceCount: number;
  pendingInvoiceTotalNGN: number;
  health: FollowerHealthScore;
}

export async function GET ( req: NextRequest ) {
  try {
    if ( !( await requireOperator( req ) ) ) {
      return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
    }

    const db = await getSaasDb();
    const users = await db
      .collection<UserDoc>( "users" )
      .find( { role: "follower" } )
      .sort( { createdAt: -1 } )
      .toArray();

    const userIds = users.map( ( u ) => u._id! );

    const [ keyDocs, subDocs, pendingInvoices ] = await Promise.all( [
      userIds.length > 0
        ? db.collection<ExchangeKeyDoc>( "exchange_keys" ).find( { userId: { $in: userIds } } ).toArray()
        : [],
      userIds.length > 0
        ? db.collection<SubscriptionDoc>( "subscriptions" ).find( { userId: { $in: userIds } } ).toArray()
        : [],
      userIds.length > 0
        ? db.collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" ).find( { userId: { $in: userIds }, status: { $in: [ "PENDING_APPROVAL", "APPROVED" ] } } ).toArray()
        : [],
    ] );

    const keyByUser = new Map( keyDocs.map( ( k ) => [ k.userId.toString(), k ] ) );
    const subByUser = new Map( subDocs.map( ( s ) => [ s.userId.toString(), s ] ) );

    const pendingByUser = new Map<string, { count: number; totalNGN: number }>();
    for ( const inv of pendingInvoices ) {
      const key = inv.userId.toString();
      const existing = pendingByUser.get( key ) ?? { count: 0, totalNGN: 0 };
      existing.count += 1;
      existing.totalNGN += inv.feeAmountNGN ?? 0;
      pendingByUser.set( key, existing );
    }

    const healthByUser = new Map<string, FollowerHealthScore>();
    await Promise.all( users.map( async ( u ) => {
      if ( u._id ) healthByUser.set( u._id.toString(), await calculateFollowerHealth( db, u as UserDoc & { _id: ObjectId } ) );
    } ) );

    const followers: FollowerListItem[] = users.map( ( u ) => {
      const key = keyByUser.get( u._id!.toString() );
      const sub = subByUser.get( u._id!.toString() );
      const pending = pendingByUser.get( u._id!.toString() );

      // Safe date formatting helpers
      const createdAtIso = u.createdAt ? new Date( u.createdAt ).toISOString() : new Date().toISOString();
      const lastCheckIso = key?.lastBalanceCheckAt ? new Date( key.lastBalanceCheckAt ).toISOString() : null;

      return {
        id: u._id!.toString(),
        email: u.email ?? "",
        displayName: u.displayName ?? u.email ?? "Unknown",
        createdAt: createdAtIso,
        emailVerified: !!u.emailVerified,
        exchangeConnected: !!key?.verifiedAt,
        lastKnownBalanceUSDT: key?.lastKnownBalanceUSDT ?? null,
        lastBalanceCheckAt: lastCheckIso,
        copyTradingEnabled: !!u.copyTradingEnabled,
        subscriptionStatus: sub?.status ?? null,
        pendingInvoiceCount: pending?.count ?? 0,
        pendingInvoiceTotalNGN: pending?.totalNGN ?? 0,
        health: healthByUser.get( u._id!.toString() )!,
      };
    } );

    return NextResponse.json( { followers } );
  } catch ( err: unknown ) {
    console.error( "Error in GET /api/saas/followers:", err );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch followers from database." },
      { status: 500 }
    );
  }
}

export async function PATCH ( req: NextRequest ) {
  try {
    if ( !( await requireOperator( req ) ) ) {
      return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
    }

    const body = await req.json().catch( () => null );
    const userId = typeof body?.userId === "string" ? body.userId : null;
    const copyTradingEnabled = typeof body?.copyTradingEnabled === "boolean" ? body.copyTradingEnabled : null;

    if ( !userId || copyTradingEnabled === null ) {
      return NextResponse.json(
        { error: "userId and copyTradingEnabled (boolean) are required." },
        { status: 400 }
      );
    }

    let objectId: ObjectId;
    try {
      objectId = new ObjectId( userId );
    } catch {
      return NextResponse.json( { error: "Invalid userId." }, { status: 400 } );
    }

    const db = await getSaasDb();
    const minActivationBalanceUSDT = getCopyTradeMinActivationBalanceUSDT();

    if ( copyTradingEnabled ) {
      const [ user, key, sub, pendingInvoice ] = await Promise.all( [
        db.collection<UserDoc>( "users" ).findOne( { _id: objectId } ),
        db.collection<ExchangeKeyDoc>( "exchange_keys" ).findOne( { userId: objectId } ),
        db.collection<SubscriptionDoc>( "subscriptions" ).findOne( { userId: objectId } ),
        db
          .collection<PerformanceFeeInvoiceDoc>( "performance_fee_invoices" )
          .findOne( { userId: objectId, status: { $in: [ "PENDING_APPROVAL", "APPROVED" ] } } ),
      ] );

      if ( !user?.emailVerified ) {
        return NextResponse.json(
          { error: "This follower's email is not verified yet." },
          { status: 409 }
        );
      }
      if ( !key?.verifiedAt ) {
        return NextResponse.json(
          { error: "This follower has not connected a verified exchange key yet." },
          { status: 409 }
        );
      }
      if ( Number( key.lastKnownBalanceUSDT ?? 0 ) < minActivationBalanceUSDT ) {
        return NextResponse.json(
          { error: `This follower needs at least $${ minActivationBalanceUSDT.toFixed( 2 ) } available balance to start copy trading.` },
          { status: 409 }
        );
      }
      if ( sub?.status !== "ACTIVE" ) {
        return NextResponse.json(
          { error: "This follower does not have an active subscription." },
          { status: 409 }
        );
      }
      if ( pendingInvoice ) {
        return NextResponse.json(
          { error: "This follower has an unpaid performance fee invoice." },
          { status: 409 }
        );
      }
    }

    const result = await db
      .collection<UserDoc>( "users" )
      .updateOne( { _id: objectId }, { $set: { copyTradingEnabled } } );

    if ( result.matchedCount === 0 ) {
      return NextResponse.json( { error: "Follower not found." }, { status: 404 } );
    }

    return NextResponse.json( { ok: true, copyTradingEnabled } );
  } catch ( err: unknown ) {
    console.error( "Error in PATCH /api/saas/followers:", err );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "An error occurred while updating the follower." },
      { status: 500 }
    );
  }
}
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getSaasDb } from "@/lib/saasDb";
import { calculateFollowerHealth } from "@/lib/followerHealth";
import type { UserDoc } from "@/lib/saasTypes";

const eventTypes = new Set( [
  "monthly_gain_milestone",
  "crisis_averted",
  "new_equity_high",
  "drawdown_recovery",
  "risk_guard_triggered",
  "extended_drawdown",
  "technical_disruption", "retention_followup"
] );

async function requireOperator ( req: NextRequest ): Promise<boolean> {
  const token = req.cookies.get( COOKIE_NAME )?.value;
  return token ? !!( await verifySessionToken( token ).catch( () => null ) ) : false;
}

function cleanText ( value: unknown, fallback = "" ): string {
  return typeof value === "string" ? value.trim().slice( 0, 240 ) : fallback;
}

function suggestedRetentionMessage (
  displayName: string,
  drivers: string[],
  action: string,
  health: { score: number; label: string; netPnl30d: number; recentDashboardViews: number; recentRiskActions: number; daysUntilRenewal: number | null }
): string {
  const primaryDriver = drivers[ 0 ] ?? "Your account has a few signals worth reviewing.";
  const pnl = `${ health.netPnl30d >= 0 ? "+" : "" }$${ health.netPnl30d.toFixed( 2 ) }`;
  const renewal = health.daysUntilRenewal === null ? "no active renewal window" : `${ health.daysUntilRenewal } day${ health.daysUntilRenewal === 1 ? "" : "s" } to renewal`;

  return [
    `Hi ${ displayName }, here is a plain Mimic Pips account update before you make any decision from emotion.`,
    `Main signal: ${ primaryDriver }`,
    `Your current follower health readout is ${ health.score }/100 (${ health.label }). In the last 30 days, copied PnL is ${ pnl }, dashboard checks in the last week are ${ health.recentDashboardViews }, and recent risk actions are ${ health.recentRiskActions }. Renewal context: ${ renewal }.`,
    `What this means: Risk Guard is watching payment status, exchange connection, invoices, and copy-trading state before live entries. If any gate is unsettled, the safer outcome is to slow down or pause execution instead of forcing trades through silently.`,
    `Recommended next step: ${ action }`,
  ].join( "\n\n" );
}

export async function GET ( req: NextRequest ) {
  if ( !( await requireOperator( req ) ) ) {
    return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
  }

  const limitParam = Number( req.nextUrl.searchParams.get( "limit" ) );
  const limit = Number.isFinite( limitParam ) && limitParam > 0 ? Math.min( limitParam, 50 ) : 20;
  const db = await getSaasDb();
  const [ events, followers ] = await Promise.all( [
    db.collection( "marketing_events" ).find( {} ).sort( { createdAt: -1 } ).limit( limit ).toArray(),
    db.collection<UserDoc>( "users" ).find( { role: "follower" } ).sort( { createdAt: -1 } ).limit( 100 ).toArray(),
  ] );

  const opportunities = ( await Promise.all(
    followers.map( async ( user ) => {
      if ( !user._id ) return null;
      const health = await calculateFollowerHealth( db, user as UserDoc & { _id: NonNullable<UserDoc[ "_id" ]> } );
      if ( ![ "likely_to_churn", "anxious", "watching" ].includes( health.band ) ) return null;
      return {
        userId: user._id.toString(),
        displayName: user.displayName || user.email,
        email: user.email,
        score: health.score,
        band: health.band,
        drivers: health.drivers,
        recommendedAction: health.recommendedAction,
        suggestedMessage: suggestedRetentionMessage( user.displayName || "there", health.drivers, health.recommendedAction, health ),
      };
    } )
  ) )
    .filter( ( item ): item is NonNullable<typeof item> => item !== null )
    .sort( ( a, b ) => a.score - b.score )
    .slice( 0, 12 );

  return NextResponse.json( {
    opportunities,
    events: events.map( ( event ) => ( {
      id: event._id?.toString(),
      type: event.type,
      title: event.title,
      summary: event.summary,
      metricLabel: event.metricLabel,
      metricValue: event.metricValue,
      audience: event.audience,
      createdAt: event.createdAt?.toISOString?.() ?? new Date().toISOString(),
    } ) ),
  } );
}

export async function POST ( req: NextRequest ) {
  if ( !( await requireOperator( req ) ) ) {
    return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
  }

  const body = await req.json().catch( () => null );
  const type = cleanText( body?.type );
  if ( !eventTypes.has( type ) ) {
    return NextResponse.json( { error: "Unsupported marketing event type." }, { status: 400 } );
  }

  const event = {
    type,
    title: cleanText( body?.title, "Mimic Pips update" ),
    summary: cleanText( body?.summary, "A notable system event is ready for review." ),
    metricLabel: cleanText( body?.metricLabel ),
    metricValue: cleanText( body?.metricValue ),
    audience: cleanText( body?.audience, "public" ),
    source: "operator",
    createdAt: new Date(),
  };

  const db = await getSaasDb();
  const result = await db.collection( "marketing_events" ).insertOne( event );
  return NextResponse.json( { ok: true, event: { ...event, id: result.insertedId.toString() } } );
}

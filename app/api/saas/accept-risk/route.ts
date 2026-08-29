import { NextResponse } from "next/server";
import { headers } from "next/headers";
import mongoose from "mongoose";
import { getSaasDb } from "@/lib/saasDb";
import { getSession } from "@/lib/auth";
import type { RiskDisclosureLogDoc, UserDoc } from "@/lib/saasTypes";

export const DISCLOSURE_VERSION = "v1.0.0";

// Immutable content snapshot attached to this version log
export const DISCLOSURE_SNAPSHOT = {
  riskDisclosure:
    "Cryptocurrency futures and perpetual contracts carry extreme market volatility and leverage risks. You can lose a substantial portion or the entirety of your allocated balance in a short period. All past performance metrics, historical win rates, and backtested results are provided for informational context only.",
  termsOfService:
    "This platform is provided strictly as an automated algorithmic execution tool. It does not provide personalized financial, investment, or legal advice. Under no circumstances shall the platform or its operators be held liable for capital losses, system downtime, order rejection, or indirect damages.",
  privacyPolicy:
    "We collect essential account data and API public/secret key pairs required to execute trades. All API keys are encrypted using AES-256-GCM prior to storage in our database. Timestamped risk acceptance events, IP addresses, and user-agent strings are logged strictly for legal compliance and audit defense.",
};

function getNormalizedIp ( headerList: Headers ): string {
  const forwarded = headerList.get( "x-forwarded-for" );
  let ip = forwarded
    ? forwarded.split( "," )[ 0 ].trim()
    : headerList.get( "x-real-ip" ) || "127.0.0.1";

  // Normalize local IPv6 loopback to IPv4 format for clean local log output
  if ( ip === "::1" || ip === "::ffff:127.0.0.1" ) {
    return "127.0.0.1";
  }

  return ip;
}

export async function POST () {
  try {
    const session = await getSession();
    if ( !session?.userId ) {
      return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
    }

    const headerList = await headers();
    const ipAddress = getNormalizedIp( headerList );
    const userAgent = headerList.get( "user-agent" ) || "unknown";

    const db = await getSaasDb();
    const userObjectId = new mongoose.Types.ObjectId( session.userId );

    // 1. Immutable audit record with full content snapshot
    await db.collection<RiskDisclosureLogDoc>( "risk_disclosure_logs" ).insertOne( {
      userId: userObjectId,
      version: DISCLOSURE_VERSION,
      contentSnapshot: DISCLOSURE_SNAPSHOT,
      ipAddress,
      userAgent,
      acceptedAt: new Date(),
    } );

    // 2. Update user state
    await db.collection<UserDoc>( "users" ).updateOne(
      { _id: userObjectId },
      {
        $set: {
          riskDisclosureAccepted: true,
          riskDisclosureVersion: DISCLOSURE_VERSION,
          riskDisclosureAcceptedAt: new Date(),
        },
      }
    );

    return NextResponse.json( { success: true, version: DISCLOSURE_VERSION } );
  } catch ( error ) {
    console.error( "Failed to record risk acceptance:", error );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
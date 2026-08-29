import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { ObjectId } from "mongodb";
import { getSaasDb } from "@/lib/saasDb";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { DISCLOSURE_VERSION, getLegalSnapshot } from "@/lib/legalConstants";
import type { RiskDisclosureLogDoc, UserDoc } from "@/lib/saasTypes";

function getNormalizedIp ( headerList: Headers ): string {
  const forwarded = headerList.get( "x-forwarded-for" );
  const ip = forwarded
    ? forwarded.split( "," )[ 0 ].trim()
    : headerList.get( "x-real-ip" ) || "127.0.0.1";

  if ( ip === "::1" || ip === "::ffff:127.0.0.1" ) {
    return "127.0.0.1";
  }

  return ip;
}

export async function POST(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie") ?? "";
    const token = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);
    const user = token ? await getUserFromSessionToken(decodeURIComponent(token)) : null;
    if (!user?._id) {
      return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
    }

    const headerList = await headers();
    const ipAddress = getNormalizedIp( headerList );
    const userAgent = headerList.get( "user-agent" ) || "unknown";

    const db = await getSaasDb();
    const userObjectId = new ObjectId(user._id);

    // Snapshot matching exact modal popup text
    const contentSnapshot = getLegalSnapshot();

    await db.collection<RiskDisclosureLogDoc>( "risk_disclosure_logs" ).insertOne( {
      userId: userObjectId,
      version: DISCLOSURE_VERSION,
      contentSnapshot,
      ipAddress,
      userAgent,
      acceptedAt: new Date(),
    } );

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

import { NextRequest, NextResponse } from "next/server";
import { verifyEmailToken } from "@/lib/emailVerification";

export async function GET ( req: NextRequest ) {
  const token = req.nextUrl.searchParams.get( "token" );
  if ( !token ) {
    return NextResponse.json( { error: "Missing token." }, { status: 400 } );
  }

  const result = await verifyEmailToken( token );
  if ( !result.success ) {
    return NextResponse.json(
      { error: "This verification link is invalid or has expired." },
      { status: 400 }
    );
  }

  return NextResponse.json( { ok: true } );
}
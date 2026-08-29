import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { sendVerificationEmail } from "@/lib/emailVerification";
import { isRateLimited } from "@/lib/rateLimit";
import { getErrorMessage } from "@/lib/errorMessage";

const MAX_ATTEMPTS = 3;
const WINDOW_MS = 15 * 60 * 1000;

export async function POST ( req: NextRequest ) {
  const token = req.cookies.get( COOKIE_NAME )?.value;
  const user = token ? await getUserFromSessionToken( token ) : null;
  if ( !user ) {
    return NextResponse.json( { error: "Not signed in." }, { status: 401 } );
  }

  if ( user.emailVerified ) {
    return NextResponse.json( { error: "Email is already verified." }, { status: 409 } );
  }

  if ( isRateLimited( `resend-verification:${ user._id }`, MAX_ATTEMPTS, WINDOW_MS ) ) {
    return NextResponse.json(
      { error: "Too many resend attempts. Wait a while before trying again." },
      { status: 429 }
    );
  }

  try {
    await sendVerificationEmail( user._id!, user.email );
    return NextResponse.json( { ok: true } );
  } catch ( err: unknown ) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Could not send verification email.") },
      { status: 500 }
    );
  }
}

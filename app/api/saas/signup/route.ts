import { NextRequest, NextResponse } from "next/server";
import { createUser, createSession, COOKIE_NAME, SESSION_TTL_MS } from "@/lib/saasAuth";
import { isRateLimited } from "@/lib/rateLimit";
import { sendVerificationEmail } from "@/lib/emailVerification";
import { getErrorMessage } from "@/lib/errorMessage";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function isValidEmail ( email: string ): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test( email );
}

export async function POST ( req: NextRequest ) {
  const ip = req.headers.get( "x-forwarded-for" ) ?? "unknown";
  if ( isRateLimited( `signup:${ ip }`, MAX_ATTEMPTS, WINDOW_MS ) ) {
    return NextResponse.json(
      { error: "Too many signup attempts. Try again later." },
      { status: 429 }
    );
  }

  const body = await req.json().catch( () => null );
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";

  if ( !isValidEmail( email ) ) {
    return NextResponse.json( { error: "Enter a valid email address." }, { status: 400 } );
  }
  if ( password.length < 10 ) {
    return NextResponse.json(
      { error: "Password must be at least 10 characters." },
      { status: 400 }
    );
  }
  if ( !displayName ) {
    return NextResponse.json( { error: "Name is required." }, { status: 400 } );
  }

  try {
    const user = await createUser( email, password, displayName );
    const { token } = await createSession( user._id! );

    // Fire the verification email but never let a mail failure block
    // signup — the account still needs to exist even if SMTP is
    // misconfigured or the send fails; the user can request a resend.
    sendVerificationEmail( user._id!, user.email ).catch( ( err ) => {
      console.error( "Failed to send verification email:", err.message );
    } );

    const res = NextResponse.json( {
      ok: true,
      user: { email: user.email, displayName: user.displayName },
    } );
    res.cookies.set( COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    } );
    return res;
  } catch ( err: unknown ) {
    const message = getErrorMessage(err, "Signup failed.");
    const status = message.includes( "already exists" ) ? 409 : 500;
    return NextResponse.json( { error: message }, { status } );
  }
}

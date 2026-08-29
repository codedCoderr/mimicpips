import { SignJWT, jwtVerify, JWTPayload } from "jose";

const COOKIE_NAME = "operator_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

export interface SessionPayload extends JWTPayload {
  userId?: string;
  role?: string;
}

function getSecret (): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if ( !secret || secret.length < 32 ) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Set a 32+ character random value in .env.local."
    );
  }
  return new TextEncoder().encode( secret );
}

export async function createSessionToken(userId = "operator"): Promise<string> {
  return new SignJWT({ userId, role: "operator" })
    .setProtectedHeader( { alg: "HS256" } )
    .setSubject( userId ) // Sets "sub" claim as standard fallback
    .setIssuedAt()
    .setExpirationTime( `${ SESSION_TTL_SECONDS }s` )
    .sign( getSecret() );
}

export async function verifySessionToken ( token: string ): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify( token, getSecret() );
    if ( payload.role !== "operator" ) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export { COOKIE_NAME, SESSION_TTL_SECONDS };

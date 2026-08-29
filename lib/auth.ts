import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "controlroom_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function getSecret (): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if ( !secret || secret.length < 32 ) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Set a 32+ character random value in .env.local."
    );
  }
  return new TextEncoder().encode( secret );
}

export async function createSessionToken (): Promise<string> {
  return new SignJWT( { role: "operator" } )
    .setProtectedHeader( { alg: "HS256" } )
    .setIssuedAt()
    .setExpirationTime( `${ SESSION_TTL_SECONDS }s` )
    .sign( getSecret() );
}

export async function verifySessionToken ( token: string ): Promise<boolean> {
  try {
    await jwtVerify( token, getSecret() );
    return true;
  } catch {
    return false;
  }
}

export { COOKIE_NAME, SESSION_TTL_SECONDS };

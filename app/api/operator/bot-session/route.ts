import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import {
  BOT_SESSION_COOKIE,
  BOT_SESSION_TTL_SECONDS,
  createOperatorBotSessionToken,
  verifyOperatorBotSessionToken,
} from "@/lib/operatorBotSession";
import { normalizeBaseUrl } from "@/lib/url";

const BOT_CONNECT_TIMEOUT_MS = 5000;

async function requireOperator ( req: NextRequest ): Promise<boolean> {
  const token = req.cookies.get( COOKIE_NAME )?.value;
  return token ? !!( await verifySessionToken( token ) ) : false;
}

function isPrivateIPv4 ( address: string ): boolean {
  const parts = address.split( "." ).map( Number );
  if ( parts.length !== 4 || parts.some( ( part ) => !Number.isInteger( part ) || part < 0 || part > 255 ) ) {
    return false;
  }
  const [ a, b ] = parts;
  return (
    a === 10 ||
    a === 127 ||
    ( a === 172 && b >= 16 && b <= 31 ) ||
    ( a === 192 && b === 168 ) ||
    ( a === 169 && b === 254 ) ||
    a === 0
  );
}

function isPrivateIPv6 ( address: string ): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith( "fc" ) ||
    normalized.startsWith( "fd" ) ||
    normalized.startsWith( "fe80:" )
  );
}

function isPrivateAddress ( address: string ): boolean {
  const version = isIP( address );
  if ( version === 4 ) return isPrivateIPv4( address );
  if ( version === 6 ) return isPrivateIPv6( address );
  return false;
}

async function validateBotBaseUrl ( baseUrl: string ): Promise<{ ok: true; url: URL } | { ok: false; error: string; status: number }> {
  let url: URL;
  try {
    url = new URL( baseUrl );
  } catch {
    return { ok: false, error: "Server address is not a valid URL.", status: 400 };
  }

  if ( url.username || url.password || url.hash ) {
    return { ok: false, error: "Server address cannot include credentials or a fragment.", status: 400 };
  }
  if ( url.protocol !== "http:" && url.protocol !== "https:" ) {
    return { ok: false, error: "Server address must start with http:// or https://.", status: 400 };
  }

  // Replace the strict HTTPS check with an environment flag bypass:
  const allowHttp = process.env.ALLOW_HTTP_BOT_URL === "true" || process.env.NODE_ENV !== "production";
  if ( !allowHttp && url.protocol !== "https:" ) {
    return { ok: false, error: "Server address must use https:// in production.", status: 400 };
  }

  const allowPrivate = process.env.ALLOW_PRIVATE_BOT_URLS === "true" || process.env.NODE_ENV !== "production";
  if ( !allowPrivate ) {
    const addresses = isIP( url.hostname )
      ? [ { address: url.hostname } ]
      : await lookup( url.hostname, { all: true } ).catch( () => [] );
    if ( addresses.length === 0 ) {
      return { ok: false, error: "Could not resolve the bot server address.", status: 400 };
    }
    if ( addresses.some( ( { address } ) => isPrivateAddress( address ) ) ) {
      return { ok: false, error: "Bot server address resolves to a private or local network address.", status: 400 };
    }
  }

  return { ok: true, url };
}

export async function POST ( req: NextRequest ) {
  if ( !( await requireOperator( req ) ) ) {
    return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
  }

  const body = await req.json().catch( () => null );
  const baseUrl = typeof body?.baseUrl === "string" ? normalizeBaseUrl( body.baseUrl ) : "";
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

  if ( !baseUrl || !apiKey ) {
    return NextResponse.json( { error: "Server address and API key are required." }, { status: 400 } );
  }
  const validation = await validateBotBaseUrl( baseUrl );
  if ( !validation.ok ) {
    return NextResponse.json( { error: validation.error }, { status: validation.status } );
  }

  const controller = new AbortController();
  const timeout = setTimeout( () => controller.abort(), BOT_CONNECT_TIMEOUT_MS );
  const upstream = await fetch( new URL( "/api/snapshot", validation.url ), {
    headers: { "X-API-Key": apiKey },
    signal: controller.signal,
  } ).catch( () => null );
  clearTimeout( timeout );

  if ( !upstream ) {
    return NextResponse.json(
      { error: "Could not reach the bot. Check the server address and that it's running." },
      { status: 502 }
    );
  }
  if ( upstream.status === 401 ) {
    return NextResponse.json( { error: "API key rejected." }, { status: 401 } );
  }
  if ( !upstream.ok ) {
    return NextResponse.json( { error: `Request failed (${ upstream.status }).` }, { status: 502 } );
  }

  const sessionToken = await createOperatorBotSessionToken( { baseUrl: validation.url.origin, apiKey } );
  const res = NextResponse.json( { ok: true } );
  res.cookies.set( BOT_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: BOT_SESSION_TTL_SECONDS,
  } );
  return res;
}

export async function GET ( req: NextRequest ) {
  if ( !( await requireOperator( req ) ) ) {
    return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
  }
  const connected = !!await verifyOperatorBotSessionToken( req.cookies.get( BOT_SESSION_COOKIE )?.value );
  return NextResponse.json( { connected } );
}

export async function DELETE ( req: NextRequest ) {
  if ( !( await requireOperator( req ) ) ) {
    return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
  }
  const res = NextResponse.json( { ok: true } );
  res.cookies.set( BOT_SESSION_COOKIE, "", { path: "/", maxAge: 0 } );
  return res;
}

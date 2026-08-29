import { SignJWT, jwtVerify } from "jose";

export const BOT_SESSION_COOKIE = "operator_bot_session";
const BOT_SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface OperatorBotSession {
  baseUrl: string;
  apiKey: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET is missing or too short.");
  }
  return new TextEncoder().encode(secret);
}

export async function createOperatorBotSessionToken(
  session: OperatorBotSession
): Promise<string> {
  return new SignJWT({ ...session, scope: "operator_bot" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${BOT_SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyOperatorBotSessionToken(
  token: string | undefined
): Promise<OperatorBotSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.scope !== "operator_bot") return null;
    if (typeof payload.baseUrl !== "string" || typeof payload.apiKey !== "string") return null;
    return { baseUrl: payload.baseUrl, apiKey: payload.apiKey };
  } catch {
    return null;
  }
}

export { BOT_SESSION_TTL_SECONDS };

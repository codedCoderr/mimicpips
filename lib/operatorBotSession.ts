import { SignJWT, jwtVerify } from "jose";

export const BOT_SESSION_COOKIE = "operator_bot_session";
const BOT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

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

/**
 * Server-configured default bot connection. When BOT_SERVER_URL and
 * BOT_DASHBOARD_API_KEY are set in the app's environment, the operator
 * never has to type them: the address and key belong to the deployment,
 * not to a person, and re-entering them on every login (logout clears
 * the per-browser cookie) is pure friction. The manual /setup form
 * still works and, when used, takes priority for that browser.
 *
 * BOT_DASHBOARD_API_KEY is the bot's DASHBOARD_API_KEY (the operator
 * credential), deliberately NOT SAAS_SERVICE_AUTH_KEY (service-to-service).
 * It stays server-side only and is never sent to the browser.
 */
export function getDefaultOperatorBotSession(): OperatorBotSession | null {
  const baseUrl = process.env.BOT_SERVER_URL?.trim();
  const apiKey = process.env.BOT_DASHBOARD_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  try {
    return { baseUrl: new URL(baseUrl).origin, apiKey };
  } catch {
    return null;
  }
}

/** Per-browser override cookie first, then the server default. */
export async function resolveOperatorBotSession(
  cookieValue: string | undefined
): Promise<OperatorBotSession | null> {
  return (
    (await verifyOperatorBotSessionToken(cookieValue)) ??
    getDefaultOperatorBotSession()
  );
}

export { BOT_SESSION_TTL_SECONDS };

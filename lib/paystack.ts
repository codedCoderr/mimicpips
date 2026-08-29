import { createHmac } from "node:crypto";

/**
 * Server-side Paystack client. Mirrors the e-commerce platform's proven
 * patterns (reference-prefix routing, webhook-driven confirmation)
 * rather than inventing a new billing flow — see
 * /areas/futures-trading-bot.md for the established conventions.
 *
 * All amounts here are in NGN (Naira), not USD. This account is
 * Nigeria-registered, and Paystack settles in the currency of business
 * registration — sending USD-denominated amounts without the account
 * being explicitly enabled for USD would charge the wrong figure
 * entirely (kobo is 1/100 of a Naira, not a cent). The bot's own PnL is
 * USD-denominated (USDT balances), so the performance fee's USD profit
 * is converted to NGN at invoice-creation time using a configurable
 * exchange rate (see lib/exchangeRate.ts) — the flat monthly fee is
 * priced directly in NGN and never touches a conversion.
 *
 * Two distinct payment shapes used here:
 *   - Flat monthly fee: charge a saved authorization directly
 *     (charge_authorization) — no checkout page, fully automatic.
 *   - Performance fee: standard initialize_transaction flow — the
 *     follower sees the exact amount and completes checkout themselves.
 */

const PAYSTACK_BASE = "https://api.paystack.co";
const CURRENCY = "NGN";

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set.");
  return key;
}

async function paystackRequest<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => null) as {
    status?: boolean;
    message?: string;
    data?: unknown;
  } | null;
  if (!res.ok || !data?.status) {
    throw new Error(data?.message ?? `Paystack request failed (${res.status}).`);
  }
  return data.data as T;
}

/**
 * Converts a Naira amount to kobo (Paystack's smallest-unit
 * requirement — 1 Naira = 100 kobo, NOT the same conversion as USD
 * cents). Rounds to avoid floating-point amounts like 1899999.9999999.
 */
function nairaToKobo(amountNGN: number): number {
  return Math.round(amountNGN * 100);
}

/**
 * Initializes a transaction for the flat monthly fee's FIRST charge —
 * this is the one time the follower goes through Paystack checkout, to
 * establish a reusable authorization for future automatic charges.
 * Reference prefix "SUB-PAY-" matches the e-commerce platform's
 * convention for routing webhook events by type.
 */
export async function initializeSubscriptionCheckout(params: {
  email: string;
  amountNGN: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}): Promise<{ authorizationUrl: string; accessCode: string; reference: string }> {
  const data = await paystackRequest<{
    authorization_url: string;
    access_code: string;
    reference: string;
  }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: params.email,
      amount: nairaToKobo(params.amountNGN),
      currency: CURRENCY,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    }),
  });

  return {
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
    reference: data.reference,
  };
}

/**
 * Charges a previously-saved authorization directly — no checkout page.
 * Used for the automatic monthly renewal once the first charge above
 * has established the authorization_code.
 */
export async function chargeSavedAuthorization(params: {
  email: string;
  amountNGN: number;
  authorizationCode: string;
  reference: string;
}): Promise<{ status: string; reference: string }> {
  const data = await paystackRequest<{ status: string; reference: string }>(
    "/transaction/charge_authorization",
    {
      method: "POST",
      body: JSON.stringify({
        email: params.email,
        amount: nairaToKobo(params.amountNGN),
        currency: CURRENCY,
        authorization_code: params.authorizationCode,
        reference: params.reference,
      }),
    }
  );
  return data;
}

/**
 * Initializes checkout for a performance fee invoice — the follower
 * reviews the calculated amount and completes payment themselves.
 * Reference prefix "PERF-FEE-" for webhook routing.
 */
export async function initializePerformanceFeeCheckout(params: {
  email: string;
  amountNGN: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}): Promise<{ authorizationUrl: string; accessCode: string; reference: string }> {
  const data = await paystackRequest<{
    authorization_url: string;
    access_code: string;
    reference: string;
  }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: params.email,
      amount: nairaToKobo(params.amountNGN),
      currency: CURRENCY,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    }),
  });

  return {
    authorizationUrl: data.authorization_url,
    accessCode: data.access_code,
    reference: data.reference,
  };
}

export async function verifyTransaction(reference: string): Promise<{
  status: "success" | "failed" | "abandoned";
  amount: number; // kobo
  customer: { email: string };
  authorization?: { authorization_code: string };
}> {
  return paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
}

/**
 * Verifies a Paystack webhook's signature using the raw request body.
 * Must be called with the UNPARSED body — HMAC verification breaks if
 * the JSON is re-serialized before checking, since whitespace/key-order
 * differences change the byte sequence being signed.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return false;
  const hash = createHmac("sha512", secret).update(rawBody).digest("hex");
  return hash === signatureHeader;
}

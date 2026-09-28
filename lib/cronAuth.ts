import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Shared auth for /api/cron/* routes. Requires CRON_SECRET (>=16 chars)
 * as a Bearer token. Comparison is timing-safe: a plain === short-circuits
 * on the first differing character and leaks how much of the secret was
 * right. Lengths are compared first because timingSafeEqual throws on
 * unequal-length buffers, and a length mismatch is already a definitive
 * non-match.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;

  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();

  const expected = Buffer.from(secret);
  const presented = Buffer.from(token);
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}

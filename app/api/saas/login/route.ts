import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, createSession, COOKIE_NAME, SESSION_TTL_MS } from "@/lib/saasAuth";
import { isRateLimited, isCurrentlyLimited, recordFailedAttempt } from "@/lib/rateLimit";

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (isRateLimited(`login:ip:${ip}`, MAX_ATTEMPTS, WINDOW_MS)) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required." }, { status: 400 });
  }

  // Per-account limiter, in addition to the per-IP one above: the IP
  // check alone doesn't stop a credential-stuffing attempt that spreads
  // requests across many IPs against one target account. Keyed on the
  // normalized email so it can't be sidestepped by casing/whitespace
  // tricks. Checked read-only here (isCurrentlyLimited) — BEFORE the
  // slow bcrypt.compare in verifyPassword — so a locked-out account is
  // rejected immediately rather than paying the bcrypt cost every time,
  // and so this check itself doesn't count as an extra attempt.
  const accountKey = `login:account:${email}`;
  if (isCurrentlyLimited(accountKey, MAX_ATTEMPTS)) {
    return NextResponse.json(
      { error: "Too many login attempts for this account. Try again later." },
      { status: 429 }
    );
  }

  const user = await verifyPassword(email, password);
  if (!user) {
    // Only a CONFIRMED wrong password counts against the account-level
    // limiter — a request that never gets this far (rejected above, or
    // missing fields) doesn't count, so legitimate use (retyping a
    // password once, logging in from a new device) isn't punished.
    recordFailedAttempt(accountKey, WINDOW_MS);
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  const { token } = await createSession(user._id!);
  const res = NextResponse.json({
    ok: true,
    user: { email: user.email, displayName: user.displayName },
  });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
}
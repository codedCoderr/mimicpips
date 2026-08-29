import { NextRequest, NextResponse } from "next/server";
import { revokeSession, COOKIE_NAME } from "@/lib/saasAuth";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (token) {
    await revokeSession(token);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
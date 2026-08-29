import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await getUserFromSessionToken(token) : null;

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      email: user.email,
      displayName: user.displayName,
      copyTradingEnabled: user.copyTradingEnabled,
      emailVerified: user.emailVerified,
    },
  });
}
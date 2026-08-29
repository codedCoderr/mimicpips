import { NextRequest, NextResponse } from "next/server";
import { getUserFromSessionToken, COOKIE_NAME } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import type { UserDoc } from "@/lib/saasTypes";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await getUserFromSessionToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const db = await getSaasDb();
  await db
    .collection<UserDoc>("users")
    .updateOne({ _id: user._id! }, { $set: { hasSeenOnboarding: true } });

  return NextResponse.json({ ok: true });
}
import { NextRequest, NextResponse } from "next/server";
import type { ObjectId } from "mongodb";
import { COOKIE_NAME, getUserFromSessionToken } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import { calculateFollowerHealth } from "@/lib/followerHealth";
import type { UserDoc } from "@/lib/saasTypes";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await getUserFromSessionToken(token).catch(() => null) : null;
  if (!user?._id) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const db = await getSaasDb();
  const health = await calculateFollowerHealth(db, user as UserDoc & { _id: ObjectId });
  return NextResponse.json({ health });
}

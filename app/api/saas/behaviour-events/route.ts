import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, getUserFromSessionToken } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import type { BehaviourEventType, FollowerBehaviourEventDoc } from "@/lib/followerHealth";

const allowedTypes = new Set<BehaviourEventType>([
  "dashboard_view",
  "copy_trading_enabled",
  "copy_trading_disabled",
  "profile_view",
  "billing_view",
  "performance_view",
  "support_intent",
  "risk_settings_view",
  "pnl_card_generated",
]);

function safeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_.-]{1,40}$/.test(key)) continue;
    if (["string", "number", "boolean"].includes(typeof raw)) {
      output[key] = typeof raw === "string" ? raw.slice(0, 160) : raw;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await getUserFromSessionToken(token).catch(() => null) : null;
  if (!user?._id) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type as BehaviourEventType : null;
  if (!type || !allowedTypes.has(type)) {
    return NextResponse.json({ error: "A valid behaviour event type is required." }, { status: 400 });
  }

  const db = await getSaasDb();
  await db.collection<FollowerBehaviourEventDoc>("follower_behaviour_events").insertOne({
    userId: user._id,
    type,
    metadata: safeMetadata(body?.metadata),
    createdAt: new Date(),
  });

  return NextResponse.json({ ok: true });
}

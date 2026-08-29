import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { BOT_SESSION_COOKIE, verifyOperatorBotSessionToken } from "@/lib/operatorBotSession";

const BOT_EVENTS_TIMEOUT_MS = 60_000;

async function requireOperator(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return token ? !!(await verifySessionToken(token)) : false;
}

export async function GET(req: NextRequest) {
  if (!(await requireOperator(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const botSession = await verifyOperatorBotSessionToken(req.cookies.get(BOT_SESSION_COOKIE)?.value);
  if (!botSession) {
    return NextResponse.json({ error: "Bot connection is not configured." }, { status: 401 });
  }
  const serviceKey = process.env.SAAS_SERVICE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Event stream is not configured." }, { status: 500 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BOT_EVENTS_TIMEOUT_MS);
  const upstream = await fetch(new URL("/api/events", botSession.baseUrl), {
    headers: {
      Accept: "text/event-stream",
      "X-Service-Key": serviceKey,
    },
    signal: controller.signal,
  }).catch(() => null);
  clearTimeout(timeout);

  if (!upstream?.ok || !upstream.body) {
    return NextResponse.json(
      { error: "Live bot events are not available." },
      { status: upstream?.status === 401 ? 401 : 502 }
    );
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

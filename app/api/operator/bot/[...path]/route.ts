import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { BOT_SESSION_COOKIE, verifyOperatorBotSessionToken } from "@/lib/operatorBotSession";

const BOT_PROXY_TIMEOUT_MS = 10000;

async function requireOperator(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return token ? !!(await verifySessionToken(token)) : false;
}

async function proxyBot(req: NextRequest, path: string[]) {
  if (!(await requireOperator(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const botSession = await verifyOperatorBotSessionToken(req.cookies.get(BOT_SESSION_COOKIE)?.value);
  if (!botSession) {
    return NextResponse.json({ error: "Bot connection is not configured." }, { status: 401 });
  }

  const upstreamUrl = new URL(`/${path.join("/")}`, botSession.baseUrl);
  req.nextUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));

  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BOT_PROXY_TIMEOUT_MS);
  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers: {
      "Content-Type": req.headers.get("content-type") ?? "application/json",
      "X-API-Key": botSession.apiKey,
    },
    body,
    signal: controller.signal,
  }).catch(() => null);
  clearTimeout(timeout);

  if (!upstream) {
    return NextResponse.json(
      { error: "Could not reach the bot. Check the server address and that it's running." },
      { status: 502 }
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("text/csv")) {
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": contentType },
    });
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": contentType || "application/json" },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyBot(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyBot(req, (await ctx.params).path);
}

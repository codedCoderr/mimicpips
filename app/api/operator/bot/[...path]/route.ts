import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { BOT_SESSION_COOKIE, resolveOperatorBotSession } from "@/lib/operatorBotSession";

const DEFAULT_BOT_PROXY_TIMEOUT_MS = 15000;
const REPORT_BOT_PROXY_TIMEOUT_MS = 60000;

async function requireOperator(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return token ? !!(await verifySessionToken(token)) : false;
}

async function proxyBot(req: NextRequest, path: string[]) {
  if (!(await requireOperator(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const botSession = await resolveOperatorBotSession(req.cookies.get(BOT_SESSION_COOKIE)?.value);
  if (!botSession) {
    return NextResponse.json({ error: "Bot connection is not configured." }, { status: 401 });
  }

  const upstreamUrl = new URL(`/${path.join("/")}`, botSession.baseUrl);
  req.nextUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));

  const routePath = `/${path.join("/")}`;
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
  const controller = new AbortController();
  const timeoutMs = routePath.startsWith("/api/ledger") || routePath.startsWith("/api/performance")
    ? REPORT_BOT_PROXY_TIMEOUT_MS
    : DEFAULT_BOT_PROXY_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let didTimeout = false;
  controller.signal.addEventListener("abort", () => {
    didTimeout = true;
  });
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
      {
        error: didTimeout
          ? "The bot server took too long to generate this report. Try a shorter date range, then retry the larger export later."
          : "Could not complete the request to the bot server. Check the server address and that it's running.",
      },
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

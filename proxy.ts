import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { COOKIE_NAME as SAAS_COOKIE_NAME } from "@/lib/saasAuth";

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Public SaaS auth pages — never gate these, and never fall through
  // into the operator check below.
  if (path === "/app/login" || path === "/app/signup") {
    return NextResponse.next();
  }

  if (path.startsWith("/app")) {
    const hasCookie = !!req.cookies.get(SAAS_COOKIE_NAME)?.value;
    if (!hasCookie) {
      const url = req.nextUrl.clone();
      url.pathname = "/app/login";
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Operator dashboard — unchanged.
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const valid = token ? await verifySessionToken(token) : false;

  if (!valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/setup/:path*", "/app/:path*"],
};
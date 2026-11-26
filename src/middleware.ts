import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/auth-guard";
import { isAuthConfigured } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/cron", "/api/health"];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  if (!isAuthConfigured()) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error:
            "Autenticação não configurada. Configure AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET e ALLOWED_EMAIL no .env.local.",
        },
        { status: 503 }
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("setup", "1");
    return NextResponse.redirect(url);
  }

  const email = req.auth?.user?.email;
  if (!req.auth || !isAllowedEmail(email, process.env.ALLOWED_EMAIL)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

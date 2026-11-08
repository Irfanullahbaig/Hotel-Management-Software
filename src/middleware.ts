import { NextResponse, type NextRequest } from "next/server";

// Cheap edge gate: no session cookie → login. Full validation happens server-side on every request.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/_next") || pathname.startsWith("/api/public") || pathname === "/favicon.ico") return NextResponse.next();
  if (!req.cookies.get("hms_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };

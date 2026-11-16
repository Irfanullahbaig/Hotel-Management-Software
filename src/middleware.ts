import { NextResponse, type NextRequest } from "next/server";
import { pendingModuleFor } from "@/lib/modules";

// Cheap edge gate: no session cookie → login. Full validation happens server-side on every request.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Modules switched off (see src/lib/modules.ts) show a "Pending" page instead.
  const pending = pendingModuleFor(pathname);
  if (pending) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "This module is pending and not enabled yet." }, { status: 404 });
    const url = req.nextUrl.clone();
    url.search = "";
    if (pending === "booking") {
      url.pathname = "/unavailable";
      return NextResponse.rewrite(url);
    }
    if (req.cookies.get("hms_session")) {
      url.pathname = `/pending/${pending}`;
      return NextResponse.rewrite(url);
    }
  }

  if (pathname.startsWith("/login") || pathname.startsWith("/_next") || pathname.startsWith("/api/public") || pathname.startsWith("/book") || pathname.startsWith("/unavailable") || pathname === "/favicon.ico") return NextResponse.next();
  if (!req.cookies.get("hms_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };

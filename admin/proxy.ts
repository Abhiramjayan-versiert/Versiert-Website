import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, unseal } from "@/lib/session-core";

/** Everything except the login page and auth endpoints requires a session. */
export async function proxy(req: NextRequest) {
  const session = await unseal(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return new NextResponse("Unauthorized", { status: 401 });
  const url = new URL("/login", req.url);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};

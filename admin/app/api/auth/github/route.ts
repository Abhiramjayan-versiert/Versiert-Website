import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";

export async function GET(req: NextRequest) {
  if (!env.githubClientId) return NextResponse.redirect(new URL("/login?error=config", req.url));
  const state = randomBytes(16).toString("hex");
  const redirectUri = new URL("/api/auth/callback", req.url).toString();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.githubClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  // "repo" lets the admin commit website content and read/write the private SaaS repo.
  url.searchParams.set("scope", "repo read:user");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  const res = NextResponse.redirect(url);
  res.cookies.set("va_oauth_state", state, { httpOnly: true, secure: env.isProd, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}

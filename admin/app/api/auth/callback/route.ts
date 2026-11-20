import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { loginAllowed } from "@/lib/session-core";
import { startSession } from "@/lib/session";

const fail = (req: NextRequest, code: string) => {
  const res = NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
  res.cookies.delete("va_oauth_state");
  return res;
};

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") || "";
  const expected = req.cookies.get("va_oauth_state")?.value || "";
  if (!code || !expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected)))
    return fail(req, "state");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.githubClientId,
      client_secret: env.githubClientSecret,
      code,
      redirect_uri: new URL("/api/auth/callback", req.url).toString(),
    }),
    cache: "no-store",
  });
  const tok = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tok.access_token) return fail(req, "token");

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "versiert-admin" },
    cache: "no-store",
  });
  const user = (await userRes.json().catch(() => ({}))) as { login?: string; name?: string; avatar_url?: string };
  if (!user.login) return fail(req, "user");
  if (!loginAllowed(user.login, env.allowedLogins, false)) return fail(req, "not_allowed");

  await startSession({ login: user.login, name: user.name || user.login, avatar: user.avatar_url, token: tok.access_token });
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.delete("va_oauth_state");
  return res;
}

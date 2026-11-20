import "server-only";
import { cookies } from "next/headers";
import { env } from "./env";
import { SESSION_COOKIE, SESSION_HOURS, loginAllowed, seal, unseal, type Session } from "./session-core";

export async function getSession(): Promise<Session | null> {
  const s = await unseal((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return null;
  if (s.dev && !env.devLogin) return null;
  if (!loginAllowed(s.login, env.allowedLogins, Boolean(s.dev && env.devLogin))) return null;
  return s;
}

/** Call at the top of every server action / route that reads or writes data. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("Your session has expired. Please sign in again.");
  return s;
}

export async function startSession(s: Session) {
  (await cookies()).set(SESSION_COOKIE, await seal(s), {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Session sealing shared by proxy.ts and server code (no next/headers here).
 * The cookie is an encrypted JWT (A256GCM) so the GitHub token inside it is
 * never readable by the browser.
 */
import { EncryptJWT, jwtDecrypt } from "jose";

export const SESSION_COOKIE = "va_session";
export const SESSION_HOURS = 12;

export type Session = { login: string; name?: string; avatar?: string; token?: string; dev?: boolean };

let cachedKey: Uint8Array | null = null;

async function key(): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;
  let secret = process.env.SESSION_SECRET || "";
  if (secret.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be at least 32 characters.");
    secret = "local-development-only-secret-not-for-production-use";
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  cachedKey = new Uint8Array(digest);
  return cachedKey;
}

export async function seal(s: Session): Promise<string> {
  return new EncryptJWT({ ...s })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .encrypt(await key());
}

export async function unseal(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, await key());
    if (typeof payload.login !== "string") return null;
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

export function loginAllowed(login: string, allowList: string[], isDev: boolean): boolean {
  if (isDev) return true;
  return allowList.includes(login.toLowerCase());
}

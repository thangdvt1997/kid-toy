import "server-only";
import { cookies } from "next/headers";
import {
  ACCESS_MAX_AGE_SECONDS,
  REFRESH_MAX_AGE_SECONDS,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  sessionCookieAttributes,
} from "./session-cookies";

/**
 * httpOnly, sameSite lax, secure-in-production session cookies. Plan 09
 * writes these cookies on login/refresh/logout; Plan 09A's proxy.ts writes
 * the SAME cookies (same names/attributes, imported from session-cookies.ts)
 * for the pre-render refresh path, since `cookies()` here is not reachable
 * from proxy. The `server-only` import above makes any accidental
 * client-component import of this module (or of anything that imports it,
 * e.g. api-client.ts) fail at build time rather than leaking a
 * token-reading code path into the browser bundle (T-01-60).
 */
export { SESSION_COOKIE, REFRESH_COOKIE };

/** Reads the access token from the httpOnly session cookie. Server-only. */
export async function getAccessToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

/** Reads the refresh token from the httpOnly refresh cookie. Server-only. */
export async function getRefreshToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value;
}

/**
 * Writes both tokens as httpOnly cookies. Only callable from a Server
 * Function or Route Handler (next/headers' cookie-writing rule) — never
 * during plain Server Component rendering.
 */
export async function setSession(tokens: {
  accessToken: string;
  refreshToken: string;
}): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, tokens.accessToken, sessionCookieAttributes(ACCESS_MAX_AGE_SECONDS));
  store.set(REFRESH_COOKIE, tokens.refreshToken, sessionCookieAttributes(REFRESH_MAX_AGE_SECONDS));
}

/** Clears both session cookies. Never throws. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(REFRESH_COOKIE);
}

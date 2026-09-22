import "server-only";
import { cookies } from "next/headers";

/**
 * httpOnly, sameSite lax, secure-in-production session cookies. Plan 09
 * writes these cookies on login/refresh/logout. The `server-only` import
 * above makes any accidental client-component import of this module (or of
 * anything that imports it, e.g. api-client.ts) fail at build time rather
 * than leaking a token-reading code path into the browser bundle (T-01-60).
 */
export const SESSION_COOKIE = "kt_session";
export const REFRESH_COOKIE = "kt_refresh";

const ACCESS_MAX_AGE_SECONDS = 15 * 60; // 15 minutes — matches the API's access token TTL
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days — matches the API's refresh token TTL

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    path: "/",
    // secure-in-production only: this dev environment (and the VPS's
    // internal Next.js<->Caddy hop) may be plain HTTP.
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}

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
  store.set(SESSION_COOKIE, tokens.accessToken, cookieOptions(ACCESS_MAX_AGE_SECONDS));
  store.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE_SECONDS));
}

/** Clears both session cookies. Never throws. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(REFRESH_COOKIE);
}

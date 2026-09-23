/**
 * Cookie names, TTLs, and cookie-attribute defaults for the httpOnly
 * session pair. Deliberately has NO dependency on `next/headers` (unlike
 * session.ts) so it can be imported from BOTH a Server Component/Server
 * Function/Route Handler context (via session.ts's `cookies()`-based
 * writers) AND `proxy.ts`, which runs before any request-scoped
 * `cookies()`/`headers()` context exists and must write cookies through the
 * raw `NextRequest`/`NextResponse` `.cookies` API instead (01-09A Task 1).
 * Keeping the attributes in one place guarantees both write paths issue
 * byte-identical cookies.
 */
export const SESSION_COOKIE = "kt_session";
export const REFRESH_COOKIE = "kt_refresh";

export const ACCESS_MAX_AGE_SECONDS = 15 * 60; // 15 minutes — matches the API's access token TTL
export const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days — matches the API's refresh token TTL

export interface SessionCookieAttributes {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
}

export function sessionCookieAttributes(maxAge: number): SessionCookieAttributes {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // secure-in-production only: this dev environment (and the VPS's
    // internal Next.js<->Caddy hop) may be plain HTTP.
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}

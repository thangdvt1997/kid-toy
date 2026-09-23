import { NextResponse } from "next/server";
import type { AuthTokens } from "@kid-toy/shared-types";
import { apiSend } from "@/lib/api-client";
import { clearSession, getRefreshToken, setSession } from "@/lib/session";

/**
 * Rotates the refresh token for a new access/refresh pair. A Route Handler
 * is a legitimate place to write cookies (unlike a Server Component), so
 * this stays available for any CLIENT COMPONENT that wants to force a
 * rotation via a real browser fetch (the resulting Set-Cookie headers reach
 * the actual browser response here, unlike a server-to-server self-fetch).
 *
 * This is NOT the path used for the page-render-time transparent refresh
 * described in current-user.ts (01-09A Task 1) — that refresh happens in
 * `proxy.ts`, which calls the NestJS API directly via session-refresh.ts
 * rather than through this route, so the rotated cookies are visible to the
 * SAME navigation's Server Component render (a self-fetch to this route
 * would only expose Set-Cookie on an inner Response nothing else sees).
 *
 * Always ends with either a fresh cookie pair (204) or both cookies
 * cleared (401) — never a half-updated session.
 */
export async function POST(): Promise<Response> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    await clearSession();
    return new NextResponse(null, { status: 401 });
  }
  try {
    const tokens = await apiSend<AuthTokens>("POST", "/api/auth/refresh", { refreshToken });
    await setSession(tokens);
    return new NextResponse(null, { status: 204 });
  } catch {
    await clearSession();
    return new NextResponse(null, { status: 401 });
  }
}

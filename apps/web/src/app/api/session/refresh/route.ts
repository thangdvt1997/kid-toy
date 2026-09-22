import { NextResponse } from "next/server";
import type { AuthTokens } from "@kid-toy/shared-types";
import { apiSend } from "@/lib/api-client";
import { clearSession, getRefreshToken, setSession } from "@/lib/session";

/**
 * Rotates the refresh token for a new access/refresh pair. Called by
 * current-user.ts's transparent-refresh path and available directly for any
 * client that wants to force a rotation. Always ends with either a fresh
 * cookie pair (204) or both cookies cleared (401) — never a half-updated
 * session.
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

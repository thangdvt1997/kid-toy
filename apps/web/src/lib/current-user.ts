import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { AuthenticatedAccount, AuthTokens, StaffRole } from "@kid-toy/shared-types";
import { apiGet, apiSend, ApiError } from "./api-client";
import { clearSession, getAccessToken, getRefreshToken, setSession } from "./session";

async function tryRefresh(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return false;
  try {
    const tokens = await apiSend<AuthTokens>("POST", "/api/auth/refresh", { refreshToken });
    await setSession(tokens);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the authenticated account for the current request, or `undefined`
 * when anonymous. Never throws. Memoized per request via React `cache()` so
 * several components calling this in one render (e.g. AccountNav +
 * a page's own call) produce exactly one API round trip.
 *
 * Transparent refresh: when the access cookie is missing/expired but the
 * refresh cookie is still valid, this silently rotates both cookies and
 * retries once before giving up.
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedAccount | undefined> => {
  let accessToken = await getAccessToken();
  if (!accessToken) {
    if (!(await tryRefresh())) return undefined;
    accessToken = await getAccessToken();
    if (!accessToken) return undefined;
  }

  try {
    return await apiGet<AuthenticatedAccount>("/api/auth/me", { auth: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && (await tryRefresh())) {
      try {
        return await apiGet<AuthenticatedAccount>("/api/auth/me", { auth: true });
      } catch {
        await clearSession();
        return undefined;
      }
    }
    await clearSession();
    return undefined;
  }
});

/**
 * UX convenience only — the API's `RolesGuard` is the actual enforcement
 * point (AUTH-04). Every admin API call must still be independently
 * authorized server-side; this only prevents an unauthenticated or
 * wrong-role visitor from seeing an admin page shell before their first API
 * call would 401/403.
 *
 * Redirects to `/[locale]/login?next=<current path>` when anonymous, and
 * calls `notFound()` (never merely hides a control) when authenticated with
 * an insufficient role.
 */
export async function requireStaff(roles: StaffRole[]): Promise<AuthenticatedAccount> {
  const account = await getCurrentUser();
  const locale = await getLocale();
  // Stamped by proxy.ts (next-intl's middleware wrapper) — Server Components
  // have no other built-in way to read the current request's pathname.
  const headersList = await headers();
  const currentPath = headersList.get("x-pathname") ?? `/${locale}`;

  if (!account) {
    redirect(`/${locale}/login?next=${encodeURIComponent(currentPath)}`);
  }
  if (account.type !== "STAFF" || !account.role || !roles.includes(account.role)) {
    notFound();
  }
  return account;
}

import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { AuthenticatedAccount, StaffRole } from "@kid-toy/shared-types";
import { apiGet } from "./api-client";
import { getAccessToken } from "./session";

/**
 * Returns the authenticated account for the current request, or `undefined`
 * when anonymous. Never throws. Memoized per request via React `cache()` so
 * several components calling this in one render (e.g. AccountNav + a page's
 * own call) produce exactly one API round trip.
 *
 * Deliberately does NOT attempt to refresh an expired/missing access token
 * (01-09A Task 1, fixing a Plan 09 defect): Next.js forbids writing cookies
 * during Server Component rendering — `cookies().set()`/`.delete()` throw
 * outside a Server Function or Route Handler — and this function is called
 * from plain Server Components (AccountNav, account/page.tsx, requireStaff
 * below). Transparent rotation now happens exclusively in `proxy.ts`, which
 * runs BEFORE this render starts: it sets the browser-visible cookies on
 * its own response AND rewrites the in-flight request's cookies so a
 * successful rotation is visible to this same navigation. If the access
 * cookie is still missing here, the visitor is anonymous for this render —
 * the next navigation's proxy pass will either have a fresh cookie (if
 * rotation just succeeded) or none (the session is genuinely over).
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedAccount | undefined> => {
  const accessToken = await getAccessToken();
  if (!accessToken) return undefined;

  try {
    return await apiGet<AuthenticatedAccount>("/api/auth/me", { auth: true });
  } catch {
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

import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import {
  ACCESS_MAX_AGE_SECONDS,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  sessionCookieAttributes,
} from "./lib/session-cookies";
import { refreshSession } from "./lib/session-refresh";

const handleI18nRouting = createMiddleware(routing);

/**
 * Wraps next-intl's routing middleware to also:
 *
 * 1. Transparently rotate the session BEFORE rendering (01-09A Task 1,
 *    fixing a Plan 09 defect): Next.js forbids writing cookies during
 *    Server Component rendering (`cookies().set()` throws outside a Server
 *    Function/Route Handler), so `getCurrentUser()` (current-user.ts) no
 *    longer attempts a reactive refresh — this proxy, which runs BEFORE any
 *    render starts, is the only place that legitimately does it. When the
 *    access cookie is missing but a refresh cookie is present, this
 *    exchanges it directly against the API (see session-refresh.ts) and:
 *      - sets the browser-visible cookies on the outgoing response, AND
 *      - rewrites the in-flight request's own cookies so `getCurrentUser()`
 *        sees the rotated session on THIS SAME navigation, not just the
 *        next one (a self-fetch to `/api/session/refresh` would only
 *        surface Set-Cookie headers on an unrelated inner Response the
 *        browser never sees — see session-refresh.ts's doc comment).
 *    An invalid/expired refresh cookie clears both cookies instead; a
 *    transient failure (network/5xx) leaves cookies untouched so a later
 *    request can retry rather than dropping a possibly-valid session.
 * 2. Stamps the resolved request pathname as an UPSTREAM REQUEST header
 *    (fixing a second Plan 09 defect) so a plain Server Component
 *    (current-user.ts's `requireStaff`) can read the current request's
 *    pathname to build a correct `next=` redirect target — `next/headers`'
 *    `headers()` only exposes what the render actually received. This must
 *    be set on `request.headers` BEFORE delegating to next-intl: next-intl
 *    copies `request.headers` into its own Headers instance and forwards it
 *    upstream via `NextResponse`'s `{ request: { headers } }` option (see
 *    node_modules/next-intl/dist/esm/production/middleware/middleware.js) —
 *    only that path reaches a Server Component's `headers()`. Setting it on
 *    the RESPONSE instead (the Plan 09 bug) only makes it visible to the
 *    browser's network tab, never to the render.
 */
export default async function proxy(request: NextRequest) {
  const hasAccessCookie = request.cookies.has(SESSION_COOKIE);
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  let rotated: { accessToken: string; refreshToken: string } | undefined;
  let invalidRefresh = false;

  if (!hasAccessCookie && refreshToken) {
    const outcome = await refreshSession(refreshToken);
    if (outcome.ok) {
      rotated = outcome.tokens;
    } else if (outcome.reason === "invalid") {
      invalidRefresh = true;
    }
    // outcome.reason === "transient": leave cookies untouched; this render
    // is anonymous, but the refresh cookie may still be valid for a
    // subsequent request.
  }

  if (rotated) {
    request.cookies.set(SESSION_COOKIE, rotated.accessToken);
    request.cookies.set(REFRESH_COOKIE, rotated.refreshToken);
  } else if (invalidRefresh) {
    request.cookies.delete(SESSION_COOKIE);
    request.cookies.delete(REFRESH_COOKIE);
  }

  request.headers.set("x-pathname", request.nextUrl.pathname);

  const response = handleI18nRouting(request);

  if (rotated) {
    response.cookies.set(SESSION_COOKIE, rotated.accessToken, sessionCookieAttributes(ACCESS_MAX_AGE_SECONDS));
    response.cookies.set(REFRESH_COOKIE, rotated.refreshToken, sessionCookieAttributes(REFRESH_MAX_AGE_SECONDS));
  } else if (invalidRefresh) {
    response.cookies.delete(SESSION_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
  }

  return response;
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};

import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

/**
 * Wraps next-intl's routing middleware to also stamp the resolved request
 * pathname into an `x-pathname` response header. Server Components have no
 * built-in way to read the current URL's pathname (next/headers' headers()
 * only exposes HTTP request headers) — current-user.ts's requireStaff()
 * needs it to build a correct `next=` redirect target for an
 * unauthenticated staff visitor (Plan 09).
 */
export default function proxy(request: NextRequest) {
  const response = handleI18nRouting(request);
  response.headers.set("x-pathname", request.nextUrl.pathname);
  return response;
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};

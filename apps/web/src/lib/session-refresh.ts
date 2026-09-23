/**
 * Pre-render session refresh, used exclusively by `proxy.ts` (01-09A Task
 * 1). Deliberately has NO dependency on `next/headers` — proxy runs before
 * any request-scoped `cookies()`/`headers()` context exists, so this module
 * only ever touches a raw refresh-token string and `fetch`, never
 * `next/headers`' cookies() (see session.ts for the Server
 * Function/Route Handler cookie writers).
 */

export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
}

export type RefreshOutcome =
  | { ok: true; tokens: RefreshedTokens }
  | { ok: false; reason: "invalid" | "transient" };

// Keyed by the raw refresh-token string presented on the incoming request.
// See refreshSession()'s doc comment for why this de-duplication exists.
const inFlight = new Map<string, Promise<RefreshOutcome>>();

/**
 * Exchanges a refresh token for a new access+refresh pair by calling the
 * NestJS API DIRECTLY — never through this app's own
 * `/api/session/refresh` route handler. A proxy-to-route-handler self-fetch
 * would only give this function the INNER Response's Set-Cookie headers,
 * which is not the outgoing response the browser actually receives;
 * calling the real API directly and letting the caller (proxy.ts) write
 * cookies onto its own NextResponse — and onto the in-flight NextRequest,
 * so the SAME navigation's Server Component render sees the rotated
 * session too — is the one request-scoped path that actually works.
 *
 * De-duplicates concurrent calls for the SAME raw refresh-token value: the
 * API's refresh rotation is single-use (the presented token is revoked the
 * instant it is exchanged — see apps/api's token.service.ts
 * `rotateRefreshToken`), so two concurrent navigations racing to refresh
 * the same token would otherwise have one succeed and the other receive a
 * spurious 401 for an otherwise-valid session. Concurrent callers instead
 * await the one in-flight exchange and share its result. This coalescing
 * is in-memory and per-process — correct for this project's single-VPS,
 * single-instance deployment target (see STACK.md); a future
 * horizontally-scaled deployment would need a cross-process lock instead.
 */
export function refreshSession(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
  baseUrl: string | undefined = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL,
): Promise<RefreshOutcome> {
  const existing = inFlight.get(refreshToken);
  if (existing) return existing;

  const promise = performRefresh(refreshToken, fetchImpl, baseUrl).finally(() => {
    inFlight.delete(refreshToken);
  });
  inFlight.set(refreshToken, promise);
  return promise;
}

async function performRefresh(
  refreshToken: string,
  fetchImpl: typeof fetch,
  baseUrl: string | undefined,
): Promise<RefreshOutcome> {
  if (!baseUrl) return { ok: false, reason: "transient" };
  try {
    const res = await fetchImpl(new URL("/api/auth/refresh", baseUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });
    // A genuinely invalid/expired/already-rotated refresh token — the
    // session really is over, the caller should clear both cookies.
    if (res.status === 401) return { ok: false, reason: "invalid" };
    // Any other non-2xx (5xx, network hiccup surfaced as a bad status) is
    // treated as transient: leave the existing cookies alone so a later
    // request can retry, rather than logging out a possibly-still-valid
    // session because of a momentary API blip.
    if (!res.ok) return { ok: false, reason: "transient" };

    const body = (await res.json()) as Partial<RefreshedTokens>;
    if (!body.accessToken || !body.refreshToken) {
      return { ok: false, reason: "transient" };
    }
    return { ok: true, tokens: { accessToken: body.accessToken, refreshToken: body.refreshToken } };
  } catch {
    return { ok: false, reason: "transient" };
  }
}

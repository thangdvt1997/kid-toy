import "server-only";
import { cookies } from "next/headers";

/**
 * httpOnly, sameSite lax, secure-in-production session cookie. Plan 09
 * writes this cookie on login; this plan only reads it. The `server-only`
 * import above makes any accidental client-component import of this module
 * (or of anything that imports it, e.g. api-client.ts) fail at build time
 * rather than leaking a token-reading code path into the browser bundle
 * (T-01-60).
 */
export const SESSION_COOKIE = "kt_session";

/** Reads the access token from the httpOnly session cookie. Server-only. */
export async function getAccessToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

/**
 * HTTP-level regression coverage for the 01-09A auth/session defects,
 * exercised against a REAL running preview of apps/web (proxy.ts +
 * Route Handlers all live) backed by the real API and the dedicated
 * `kidtoy_test` dataset — never against mocks. This is the
 * "browser/HTTP regression coverage for cookie refresh and login
 * redirects" artifact this plan's frontmatter promises.
 *
 * NOT run as part of `pnpm test` (see jest.config.ts's "e2e" project,
 * selected only via `pnpm --filter web test:e2e`) and NOT run by this
 * execution — 01-09A's own deviation note defers all VPS/live-stack
 * verification to the orchestrator, exactly as every backend-dependent
 * plan since Plan 03 has. Requires:
 *   - E2E_WEB_BASE_URL: an internal-only apps/web preview, e.g.
 *     http://127.0.0.1:3100 (bound to 127.0.0.1, torn down afterward).
 *   - E2E_API_BASE_URL: the API instance that preview points at.
 *   - E2E_SEED_EMAIL / E2E_SEED_PASSWORD: a seeded RETAIL_CUSTOMER
 *     account's credentials (see apps/api/prisma/seed.ts /
 *     SEED_DEFAULT_PASSWORD) — e.g. customer@kidtoy.local.
 * No default/fallback base URL is provided on purpose: a misconfigured
 * env here must fail loudly rather than silently probing an unintended
 * (possibly production) host.
 *
 * Deliberately OUT of scope for this file (see redirect-target.test.ts and
 * proxy.test.ts for their unit-level coverage instead):
 *   - Exhaustive `next=` rejection-class coverage — that's fully covered
 *     as pure-function unit tests in redirect-target.test.ts; reproducing
 *     it here would additionally require driving a real Next.js Server
 *     Action's action-id RPC protocol from outside a browser, which is a
 *     manual/Playwright-level check, not a plain-fetch one.
 *   - The real `/admin/*` + requireStaff() round trip — that route doesn't
 *     exist until Plan 10 (see this plan's `must_haves.truths`).
 */

interface CookieJar {
  [name: string]: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Refusing to run auth-session e2e tests: ${name} is not set. This suite requires an ` +
        "internal-only preview of apps/web (bound to 127.0.0.1) and its backing API, running " +
        "against the dedicated kidtoy_test dataset — see README.md's Testing section. Set " +
        "E2E_WEB_BASE_URL, E2E_API_BASE_URL, E2E_SEED_EMAIL, and E2E_SEED_PASSWORD before " +
        "running `pnpm --filter web test:e2e`.",
    );
  }
  return value;
}

/** Parses `Set-Cookie` response headers into a flat name->value map. */
function parseSetCookies(res: Response): CookieJar {
  const jar: CookieJar = {};
  const setCookies =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie()
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
  for (const raw of setCookies) {
    const pair = raw.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

/** Reads a required cookie value out of a jar, throwing if absent — keeps
 * TypeScript's `noUncheckedIndexedAccess` happy without a `!` assertion. */
function requireCookie(jar: CookieJar, name: string): string {
  const value = jar[name];
  if (!value) throw new Error(`Expected cookie "${name}" to be present in the jar`);
  return value;
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

describe("auth session (cookie refresh + login redirects)", () => {
  let webBaseUrl: string;
  let apiBaseUrl: string;
  let seedEmail: string;
  let seedPassword: string;

  beforeAll(() => {
    webBaseUrl = requiredEnv("E2E_WEB_BASE_URL");
    apiBaseUrl = requiredEnv("E2E_API_BASE_URL");
    seedEmail = requiredEnv("E2E_SEED_EMAIL");
    seedPassword = requiredEnv("E2E_SEED_PASSWORD");
    void apiBaseUrl; // reserved for a future direct-API assertion, e.g. token revocation state
  });

  async function login(): Promise<CookieJar> {
    const res = await fetch(new URL("/api/session", webBaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: seedEmail, password: seedPassword }),
      redirect: "manual",
    });
    expect(res.status).toBe(204);
    const jar = parseSetCookies(res);
    expect(jar.kt_session).toBeTruthy();
    expect(jar.kt_refresh).toBeTruthy();
    return jar;
  }

  it("a valid session cookie renders the authenticated account page with no cookie churn", async () => {
    const jar = await login();

    const res = await fetch(new URL("/vi/account", webBaseUrl), {
      headers: { Cookie: cookieHeader(jar) },
      redirect: "manual",
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(seedEmail);
    // Not toBeNull() on the whole header: next-intl legitimately sets its
    // own NEXT_LOCALE cookie on render, unrelated to auth. The actual
    // "no cookie churn" claim is specifically about the SESSION cookies —
    // a valid, non-expired session must not be rewritten on every render.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("kt_session=");
    expect(setCookie).not.toContain("kt_refresh=");
  });

  it("an expired access cookie with a valid refresh cookie yields a new cookie pair and an authenticated page on the SAME navigation", async () => {
    const jar = await login();
    // simulate an expired/absent access cookie
    const staleJar: CookieJar = { kt_refresh: requireCookie(jar, "kt_refresh") };

    const res = await fetch(new URL("/vi/account", webBaseUrl), {
      headers: { Cookie: cookieHeader(staleJar) },
      redirect: "manual",
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(seedEmail);
    const rotated = parseSetCookies(res);
    expect(rotated.kt_session).toBeTruthy();
    expect(rotated.kt_refresh).toBeTruthy();
    expect(rotated.kt_refresh).not.toBe(jar.kt_refresh); // single-use rotation
  });

  it("an invalid/garbage refresh cookie (no access cookie) yields an anonymous redirect, never a 500", async () => {
    const res = await fetch(new URL("/vi/account", webBaseUrl), {
      headers: { Cookie: "kt_refresh=not-a-real-token" },
      redirect: "manual",
    });

    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toMatch(/\/vi\/login\?next=/);
  });

  it("two concurrent requests refreshing the SAME refresh cookie both end up authenticated (no self-inflicted revocation)", async () => {
    const jar = await login();
    const staleJar: CookieJar = { kt_refresh: requireCookie(jar, "kt_refresh") };

    const [resA, resB] = await Promise.all([
      fetch(new URL("/vi/account", webBaseUrl), {
        headers: { Cookie: cookieHeader(staleJar) },
        redirect: "manual",
      }),
      fetch(new URL("/vi/account", webBaseUrl), {
        headers: { Cookie: cookieHeader(staleJar) },
        redirect: "manual",
      }),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const [bodyA, bodyB] = await Promise.all([resA.text(), resB.text()]);
    expect(bodyA).toContain(seedEmail);
    expect(bodyB).toContain(seedEmail);
  });

  it("logout clears both cookies", async () => {
    const jar = await login();

    const res = await fetch(new URL("/api/session", webBaseUrl), {
      method: "DELETE",
      headers: { Cookie: cookieHeader(jar) },
    });

    expect(res.status).toBe(204);
    const cleared = parseSetCookies(res);
    expect(cleared.kt_session).toBe("");
    expect(cleared.kt_refresh).toBe("");
  });
});

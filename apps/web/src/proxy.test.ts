import { NextRequest, NextResponse } from "next/server";

// `proxy.ts` calls `createMiddleware(routing)` exactly ONCE at module load
// (its result is cached in a top-level const), so the mocked `default`
// export below returns a STABLE wrapper that reads `handleI18nRoutingMock`
// lazily on each invocation, via `.mockImplementation()` in each test —
// never by reassigning this binding. The wrapper only dereferences
// `handleI18nRoutingMock` when actually CALLED (i.e. during a real
// `proxy()` call in a test body), by which point the module has finished
// initializing, so `import`/`require` hoisting running this mock factory
// before this line executes is not a problem (the outer arrow below merely
// returns a closure without invoking it).
const handleI18nRoutingMock: jest.Mock = jest.fn(() => NextResponse.next());

jest.mock("next-intl/middleware", () => ({
  __esModule: true,
  default: jest.fn(() => (req: unknown) => handleI18nRoutingMock(req)),
}));

// `./i18n/routing` transitively imports next-intl's ESM-only `routing.js`,
// which Jest's CJS transform can't parse under this project's config. The
// real `routing` value is irrelevant here since next-intl/middleware's own
// `createMiddleware` is mocked above — only its call signature matters.
jest.mock("./i18n/routing", () => ({ routing: {} }));

jest.mock("./lib/session-refresh", () => ({
  refreshSession: jest.fn(),
}));

import proxy from "./proxy";
import { refreshSession } from "./lib/session-refresh";
import { SESSION_COOKIE, REFRESH_COOKIE } from "./lib/session-cookies";

const refreshSessionMock = refreshSession as jest.Mock;

function buildRequest(pathname: string, cookieHeader?: string): NextRequest {
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  return new NextRequest(new URL(`http://localhost${pathname}`), { headers });
}

describe("proxy", () => {
  beforeEach(() => {
    refreshSessionMock.mockReset();
    handleI18nRoutingMock.mockReset();
    handleI18nRoutingMock.mockImplementation(() => NextResponse.next());
  });

  it("forwards x-pathname as an UPSTREAM REQUEST header to next-intl's middleware, not as a response header", async () => {
    const request = buildRequest("/vi/login");
    let observedRequestHeader: string | null = null;
    handleI18nRoutingMock.mockImplementation((req: NextRequest) => {
      observedRequestHeader = req.headers.get("x-pathname");
      return NextResponse.next();
    });

    const response = await proxy(request);

    expect(observedRequestHeader).toBe("/vi/login");
    // The Plan 09 bug set this on the RESPONSE instead — a Server
    // Component's headers() never sees a response header, so asserting
    // it's absent here is the regression guard for that defect.
    expect(response.headers.get("x-pathname")).toBeNull();
  });

  it("does not call refreshSession when the access cookie is already present", async () => {
    const request = buildRequest("/vi/account", `${SESSION_COOKIE}=valid-access-token`);

    await proxy(request);

    expect(refreshSessionMock).not.toHaveBeenCalled();
  });

  it("does not call refreshSession when neither cookie is present (anonymous)", async () => {
    const request = buildRequest("/vi/login");

    await proxy(request);

    expect(refreshSessionMock).not.toHaveBeenCalled();
  });

  it("rotates cookies on the response AND forwards them to the in-flight request when refresh succeeds", async () => {
    refreshSessionMock.mockResolvedValue({
      ok: true,
      tokens: { accessToken: "new-access", refreshToken: "new-refresh" },
    });
    const request = buildRequest("/vi/account", `${REFRESH_COOKIE}=old-refresh`);
    let forwardedAccessToken: string | undefined;
    handleI18nRoutingMock.mockImplementation((req: NextRequest) => {
      forwardedAccessToken = req.cookies.get(SESSION_COOKIE)?.value;
      return NextResponse.next();
    });

    const response = await proxy(request);

    expect(refreshSessionMock).toHaveBeenCalledWith("old-refresh");
    // Same-navigation visibility: the render (represented here by what
    // next-intl's middleware receives) sees the rotated token immediately.
    expect(forwardedAccessToken).toBe("new-access");
    // Browser-visible Set-Cookie on the response for future navigations.
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=new-access`);
    expect(setCookie).toContain(`${REFRESH_COOKIE}=new-refresh`);
    expect(setCookie).toContain("HttpOnly");
  });

  it("clears both cookies when the refresh token is invalid/expired", async () => {
    refreshSessionMock.mockResolvedValue({ ok: false, reason: "invalid" });
    const request = buildRequest("/vi/account", `${REFRESH_COOKIE}=revoked-refresh`);

    const response = await proxy(request);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=;`);
    expect(setCookie).toContain(`${REFRESH_COOKIE}=;`);
  });

  it("leaves cookies untouched on a transient refresh failure (never revokes a possibly-valid session)", async () => {
    refreshSessionMock.mockResolvedValue({ ok: false, reason: "transient" });
    const request = buildRequest("/vi/account", `${REFRESH_COOKIE}=some-refresh`);

    const response = await proxy(request);

    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

import { refreshSession } from "./session-refresh";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

describe("session-refresh", () => {
  it("calls the API's /api/auth/refresh directly with the refresh token", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse({ accessToken: "new-access", refreshToken: "new-refresh" }));

    const outcome = await refreshSession("old-refresh", fetchImpl, "http://api.internal");

    expect(outcome).toEqual({
      ok: true,
      tokens: { accessToken: "new-access", refreshToken: "new-refresh" },
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.internal/api/auth/refresh");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: "old-refresh" });
  });

  it("reports an invalid refresh token as reason 'invalid' on a 401", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 401 }));

    const outcome = await refreshSession("revoked-token", fetchImpl, "http://api.internal");

    expect(outcome).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports a non-401 failure as reason 'transient' (never clears a possibly-valid session)", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));

    const outcome = await refreshSession("some-token", fetchImpl, "http://api.internal");

    expect(outcome).toEqual({ ok: false, reason: "transient" });
  });

  it("reports a network failure as reason 'transient'", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const outcome = await refreshSession("some-other-token", fetchImpl, "http://api.internal");

    expect(outcome).toEqual({ ok: false, reason: "transient" });
  });

  it("reports reason 'transient' when neither API_INTERNAL_URL nor NEXT_PUBLIC_API_URL is configured", async () => {
    const fetchImpl = jest.fn();

    const outcome = await refreshSession("token-no-base-url", fetchImpl, undefined);

    expect(outcome).toEqual({ ok: false, reason: "transient" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("de-duplicates concurrent calls for the SAME refresh-token value into a single fetch", async () => {
    let resolveFetch!: (res: Response) => void;
    const fetchImpl = jest.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = refreshSession("shared-token", fetchImpl, "http://api.internal");
    const second = refreshSession("shared-token", fetchImpl, "http://api.internal");

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse({ accessToken: "a", refreshToken: "b" }));
    const [firstOutcome, secondOutcome] = await Promise.all([first, second]);

    expect(firstOutcome).toEqual(secondOutcome);
    expect(firstOutcome).toEqual({ ok: true, tokens: { accessToken: "a", refreshToken: "b" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not de-duplicate calls for DIFFERENT refresh-token values", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ accessToken: "a", refreshToken: "b" }));

    await Promise.all([
      refreshSession("token-1", fetchImpl, "http://api.internal"),
      refreshSession("token-2", fetchImpl, "http://api.internal"),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("allows a later call with the same token to retry once the in-flight promise has settled", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "a", refreshToken: "b" }));

    const first = await refreshSession("retry-token", fetchImpl, "http://api.internal");
    expect(first).toEqual({ ok: false, reason: "invalid" });

    const second = await refreshSession("retry-token", fetchImpl, "http://api.internal");
    expect(second).toEqual({ ok: true, tokens: { accessToken: "a", refreshToken: "b" } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

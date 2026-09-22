import { apiGet, apiSend, ApiError } from "./api-client";

jest.mock("./session", () => ({
  getAccessToken: jest.fn(),
}));

const { getAccessToken } = jest.requireMock("./session") as {
  getAccessToken: jest.Mock;
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.ok === false ? "Error" : "OK",
    json: async () => body,
  } as Response;
}

describe("api-client", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_API_URL: "http://localhost:4000",
      API_INTERNAL_URL: "http://localhost:4000",
    };
    global.fetch = jest.fn();
    getAccessToken.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("apiGet", () => {
    it("builds the URL from the search params, dropping undefined and empty values", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ items: [] }));

      await apiGet("/api/catalog/products", {
        searchParams: { locale: "vi", brandId: undefined, search: "", page: 2 },
      });

      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/api/catalog/products");
      expect(parsed.searchParams.get("locale")).toBe("vi");
      expect(parsed.searchParams.get("page")).toBe("2");
      expect(parsed.searchParams.has("brandId")).toBe(false);
      expect(parsed.searchParams.has("search")).toBe(false);
    });

    it("defaults cache to no-store", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}));

      await apiGet("/api/catalog/products");

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      expect(init.cache).toBe("no-store");
    });

    it("attaches Authorization when auth is true and a session token exists", async () => {
      getAccessToken.mockResolvedValue("token-123");
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}));

      await apiGet("/api/catalog/products", { auth: true });

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(init.headers.Authorization).toBe("Bearer token-123");
    });

    it("never sends the literal 'Bearer undefined' — omits the header entirely when there is no session", async () => {
      getAccessToken.mockResolvedValue(undefined);
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}));

      await apiGet("/api/catalog/products", { auth: true });

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(init.headers).not.toHaveProperty("Authorization");
      expect(JSON.stringify(init.headers)).not.toContain("undefined");
    });

    it("never attaches Authorization when auth is not requested, even if a token exists", async () => {
      getAccessToken.mockResolvedValue("token-123");
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}));

      await apiGet("/api/catalog/products");

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(init.headers).not.toHaveProperty("Authorization");
      expect(getAccessToken).not.toHaveBeenCalled();
    });

    it("throws an ApiError carrying status and code for a non-2xx response", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse({ message: "Not found", code: "NOT_FOUND" }, { ok: false, status: 404 }),
      );

      const error = await apiGet("/api/catalog/products/nope").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
      expect((error as ApiError).code).toBe("NOT_FOUND");
    });
  });

  describe("apiSend", () => {
    it("sends a JSON body with Content-Type by default", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ id: "1" }));

      await apiSend("POST", "/api/catalog/products", { name: "Test" });

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: string },
      ];
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(init.body).toBe(JSON.stringify({ name: "Test" }));
    });

    it("sends FormData without setting Content-Type", async () => {
      (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({}));
      const formData = new FormData();
      formData.append("file", "contents");

      await apiSend("POST", "/api/catalog/media", undefined, { formData });

      const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [
        string,
        { headers: Record<string, string>; body: FormData },
      ];
      expect(init.headers["Content-Type"]).toBeUndefined();
      expect(init.body).toBe(formData);
    });
  });
});

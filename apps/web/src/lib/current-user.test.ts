jest.mock("./session", () => ({
  getAccessToken: jest.fn(),
}));

jest.mock("./api-client", () => ({
  apiGet: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

const headersGetMock = jest.fn();
jest.mock("next/headers", () => ({
  headers: jest.fn(async () => ({ get: headersGetMock })),
}));

const redirectMock = jest.fn();
const notFoundMock = jest.fn();
jest.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
  notFound: (...args: unknown[]) => notFoundMock(...args),
}));

const getLocaleMock = jest.fn();
jest.mock("next-intl/server", () => ({
  getLocale: (...args: unknown[]) => getLocaleMock(...args),
}));

import { getCurrentUser, requireStaff } from "./current-user";
import { getAccessToken } from "./session";
import { apiGet, ApiError } from "./api-client";

const getAccessTokenMock = getAccessToken as jest.Mock;
const apiGetMock = apiGet as jest.Mock;

describe("getCurrentUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns undefined without calling the API when there is no access token", async () => {
    getAccessTokenMock.mockResolvedValue(undefined);

    const account = await getCurrentUser();

    expect(account).toBeUndefined();
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it("returns the account on a successful /api/auth/me call", async () => {
    getAccessTokenMock.mockResolvedValue("valid-token");
    apiGetMock.mockResolvedValue({ id: "1", email: "a@b.com", type: "RETAIL_CUSTOMER" });

    const account = await getCurrentUser();

    expect(account).toEqual({ id: "1", email: "a@b.com", type: "RETAIL_CUSTOMER" });
    expect(apiGetMock).toHaveBeenCalledWith("/api/auth/me", { auth: true });
  });

  it("returns undefined (never throws) on a 401 from an expired access token, WITHOUT writing any cookie", async () => {
    getAccessTokenMock.mockResolvedValue("expired-token");
    apiGetMock.mockRejectedValue(new ApiError("Unauthorized", 401));

    const account = await getCurrentUser();

    expect(account).toBeUndefined();
    // Regression guard for the Plan 09 defect: this module must never import
    // session.ts's setSession/clearSession — session.ts is mocked above
    // exposing ONLY getAccessToken, so any accidental call to a cookie
    // writer would throw "is not a function" and fail this test.
  });

  it("returns undefined on an unexpected/5xx failure rather than throwing", async () => {
    getAccessTokenMock.mockResolvedValue("some-token");
    apiGetMock.mockRejectedValue(new Error("network down"));

    await expect(getCurrentUser()).resolves.toBeUndefined();
  });
});

describe("requireStaff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getLocaleMock.mockResolvedValue("vi");
  });

  it("redirects to /[locale]/login?next=<x-pathname> when anonymous", async () => {
    getAccessTokenMock.mockResolvedValue(undefined);
    headersGetMock.mockReturnValue("/vi/admin/products");
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });

    await expect(requireStaff(["SUPER_ADMIN"])).rejects.toThrow("REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith(
      `/vi/login?next=${encodeURIComponent("/vi/admin/products")}`,
    );
  });

  it("falls back to /[locale] when the x-pathname header is absent", async () => {
    getAccessTokenMock.mockResolvedValue(undefined);
    headersGetMock.mockReturnValue(null);
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });

    await expect(requireStaff(["SUPER_ADMIN"])).rejects.toThrow("REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith(`/vi/login?next=${encodeURIComponent("/vi")}`);
  });

  it("calls notFound() for an authenticated non-matching role", async () => {
    getAccessTokenMock.mockResolvedValue("staff-token");
    apiGetMock.mockResolvedValue({ id: "1", email: "staff@kidtoy.local", type: "STAFF", role: "SALES" });
    notFoundMock.mockImplementation(() => {
      throw new Error("NOT_FOUND");
    });

    await expect(requireStaff(["SUPER_ADMIN"])).rejects.toThrow("NOT_FOUND");
  });

  it("returns the account for an authenticated matching role", async () => {
    getAccessTokenMock.mockResolvedValue("staff-token");
    apiGetMock.mockResolvedValue({
      id: "1",
      email: "staff@kidtoy.local",
      type: "STAFF",
      role: "SUPER_ADMIN",
    });

    const account = await requireStaff(["SUPER_ADMIN"]);

    expect(account.role).toBe("SUPER_ADMIN");
    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});

import { getAccessToken } from "./session";

type SearchParamValue = string | number | undefined;

/**
 * Thrown for any non-2xx response from the API. `status` lets callers
 * distinguish cases (e.g. `error.status === 404`) without string-matching
 * a message.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Thrown when neither API_INTERNAL_URL nor NEXT_PUBLIC_API_URL is configured. */
class ApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConfigError";
  }
}

/**
 * Resolved lazily, per call — NOT cached at module scope and NOT evaluated
 * merely by importing this module. This module is imported by every server
 * component that reads the catalog and by its own Jest spec; a module-load
 * throw would break importing it in any environment where the two env vars
 * happen to be unset yet, whereas the first real network call should fail
 * loudly and clearly if configuration is missing.
 */
function resolveBaseUrl(): string {
  const isServer = typeof window === "undefined";
  const url = isServer
    ? process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL
    : process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new ApiConfigError(
      isServer
        ? "apps/web is misconfigured: set API_INTERNAL_URL or NEXT_PUBLIC_API_URL (see .env.local.example)."
        : "apps/web is misconfigured: NEXT_PUBLIC_API_URL is not set (see .env.local.example).",
    );
  }
  return url;
}

function buildUrl(
  path: string,
  searchParams?: Record<string, SearchParamValue>,
): string {
  const url = new URL(path, resolveBaseUrl());
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Attaches `Authorization: Bearer <token>` only when explicitly requested
 * AND a session cookie is actually present — never sends the literal
 * string "Bearer undefined". Never logs or otherwise serializes the token.
 */
async function authHeaders(auth: boolean | undefined): Promise<Record<string, string>> {
  if (!auth) return {};
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface ApiErrorBody {
  message?: string | string[];
  error?: string;
  code?: string;
}

async function parseErrorBody(
  res: Response,
): Promise<{ message: string; code?: string }> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    const message = Array.isArray(body.message)
      ? body.message.join("; ")
      : (body.message ?? body.error ?? res.statusText ?? "Request failed");
    return { message, code: body.code };
  } catch {
    return { message: res.statusText || "Request failed" };
  }
}

export interface ApiGetInit {
  searchParams?: Record<string, SearchParamValue>;
  cache?: RequestCache;
  auth?: boolean;
}

export async function apiGet<T>(path: string, init: ApiGetInit = {}): Promise<T> {
  const url = buildUrl(path, init.searchParams);
  const headers = await authHeaders(init.auth);
  const res = await fetch(url, {
    method: "GET",
    headers,
    // CORRECTNESS requirement, not a performance choice (T-01-59): prices
    // and product visibility are viewer-dependent (CATALOG-06). A shared
    // Next.js data-cache entry for a catalog request could serve one
    // viewer's (e.g. an approved dealer's) wholesale price to a different,
    // anonymous or retail viewer. Callers may only override this for
    // genuinely viewer-independent reads.
    cache: init.cache ?? "no-store",
  });
  if (!res.ok) {
    const { message, code } = await parseErrorBody(res);
    throw new ApiError(message, res.status, code);
  }
  return (await res.json()) as T;
}

export interface ApiSendInit {
  auth?: boolean;
  formData?: FormData;
}

export async function apiSend<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  init: ApiSendInit = {},
): Promise<T> {
  const url = buildUrl(path);
  const headers: Record<string, string> = await authHeaders(init.auth);
  let requestBody: BodyInit | undefined;
  if (init.formData) {
    // Do NOT set Content-Type — the runtime sets the multipart boundary.
    requestBody = init.formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const res = await fetch(url, {
    method,
    headers,
    body: requestBody,
    cache: "no-store",
  });
  if (!res.ok) {
    const { message, code } = await parseErrorBody(res);
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

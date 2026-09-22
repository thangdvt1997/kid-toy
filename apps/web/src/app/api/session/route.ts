import { NextResponse } from "next/server";
import { exchangeCredentialsForSession } from "@/lib/auth-actions";
import { apiSend } from "@/lib/api-client";
import { clearSession, getAccessToken } from "@/lib/session";

/**
 * POST exchanges { email, password } for an httpOnly session — the browser
 * never receives a token, only an empty 204/401 body (T-01-66).
 */
export async function POST(request: Request): Promise<Response> {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Common.error" }, { status: 400 });
  }
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "Common.error" }, { status: 400 });
  }

  const result = await exchangeCredentialsForSession(body.email, body.password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return new NextResponse(null, { status: 204 });
}

/** DELETE best-effort revokes the account's refresh tokens, then always clears local cookies. */
export async function DELETE(): Promise<Response> {
  const token = await getAccessToken();
  if (token) {
    try {
      await apiSend<void>("POST", "/api/auth/logout", undefined, { auth: true });
    } catch {
      // Best-effort — the local session is cleared unconditionally below
      // even if the API call fails (network error, already-revoked token).
    }
  }
  await clearSession();
  return new NextResponse(null, { status: 204 });
}

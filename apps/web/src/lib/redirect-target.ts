import { routing } from "@/i18n/routing";

const LOCALE_PREFIX_PATTERN = new RegExp(`^/(${routing.locales.join("|")})(?:/|$)`);

/**
 * Validates a post-login redirect target supplied by an UNTRUSTED `next`
 * form/query value (01-09A Task 2, fixing a Plan 09 open-redirect defect).
 * `loginAction` treats every `next` value as untrusted even when the login
 * page itself originally populated the hidden field — a submitted form can
 * always carry an attacker-supplied value regardless of what was rendered.
 *
 * Only an application-local pathname in the CURRENT locale is accepted;
 * everything else falls back to `/${locale}/account`. Rejects:
 *   - absolute URLs (a scheme, e.g. "https://evil.com" or "javascript:...")
 *   - protocol-relative URLs ("//evil.com")
 *   - backslashes (some browsers normalize a leading "/\evil.com" or
 *     "\\evil.com" into a protocol-relative URL — a classic bypass for a
 *     naive `startsWith("/")` check)
 *   - control characters (defends against header/Location smuggling
 *     through any intermediary that doesn't itself reject them)
 *   - malformed percent-encoding
 *   - a path rooted under a DIFFERENT locale than the current one
 */
export function resolveRedirectTarget(
  next: string | null | undefined,
  locale: string,
): string {
  const fallback = `/${locale}/account`;
  if (!next) return fallback;
  if (hasUnsafeRawCharacters(next)) return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return fallback; // malformed percent-encoding
  }
  if (hasUnsafeRawCharacters(decoded)) return fallback;

  // Must be rooted at exactly one leading slash — never "//" (protocol-
  // relative) and never an absolute URL with a scheme.
  if (!decoded.startsWith("/") || decoded.startsWith("//")) return fallback;

  // Re-parse against a fixed local origin as a second, independent check:
  // any decoded value that resolves to a DIFFERENT origin (an absolute URL,
  // a scheme like "javascript:", or an exotic encoding the checks above
  // didn't anticipate) is rejected here too.
  let url: URL;
  try {
    url = new URL(decoded, "http://localhost");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://localhost") return fallback;

  const match = url.pathname.match(LOCALE_PREFIX_PATTERN);
  if (!match || match[1] !== locale) return fallback;

  return `${url.pathname}${url.search}${url.hash}`;
}

function hasUnsafeRawCharacters(value: string): boolean {
  if (value.includes("\\")) return true;
  // Deliberately matching raw control characters (embedded newlines, NUL,
  // etc.) — not a mistaken escape.
  if (/[\x00-\x1f]/.test(value)) return true;
  return false;
}

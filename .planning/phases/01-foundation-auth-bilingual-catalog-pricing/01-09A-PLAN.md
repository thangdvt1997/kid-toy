---
phase: 01-foundation-auth-bilingual-catalog-pricing
plan: 09A
type: execute
wave: 10
depends_on: ["01-09"]
files_modified:
  - apps/web/src/proxy.ts
  - apps/web/src/lib/current-user.ts
  - apps/web/src/lib/session.ts
  - apps/web/src/lib/auth-actions.ts
  - apps/web/src/app/[locale]/login/page.tsx
  - apps/web/src/app/api/session/refresh/route.ts
  - apps/web/src/lib/redirect-target.ts
  - apps/web/src/lib/redirect-target.test.ts
  - apps/web/src/lib/current-user.test.ts
  - apps/web/test/auth-session.e2e-spec.ts
  - apps/web/jest.config.ts
  - apps/api/package.json
  - apps/api/test/setup-env.ts
  - package.json
  - README.md
autonomous: true
requirements: [AUTH-01, AUTH-04, CATALOG-06]

must_haves:
  truths:
    - "An expired access cookie with a valid refresh cookie yields a new httpOnly cookie pair and an authenticated page on the same browser navigation"
    - "An invalid or expired refresh cookie yields an anonymous page without a render-time cookie mutation or unhandled exception"
    - "An external, protocol-relative, malformed, or cross-locale next target cannot redirect the browser away from the application after login"
    - "Proxy pathname forwarding is covered by a request-header test; the actual admin-path round trip is a Plan 10 acceptance check"
    - "A routine unit-test command runs without a database; integration/e2e tests require an explicitly selected kidtoy_test database"
  artifacts:
    - path: "apps/web/src/proxy.ts"
      provides: "Correct upstream pathname and session-refresh forwarding before Server Component rendering"
    - path: "apps/web/src/lib/redirect-target.ts"
      provides: "One server-side validator for post-login internal redirect destinations"
    - path: "apps/web/test/auth-session.e2e-spec.ts"
      provides: "Browser/HTTP regression coverage for cookie refresh and login redirects"
---

<objective>
Repair the three auth/navigation defects found in the 2026-09-22 review and make the test commands accurately distinguish unit tests from database-backed integration tests. Finish this before Plan 10 consumes `requireStaff()` for the admin UI.

Evidence baseline: on the VPS at commit `4404ae4`, API unit 129/129, API e2e 156/156, web unit 16/16, and web production build all pass. These suites do not cover the three web defects. Locally, the default API unit command reports 21 failures because a database-backed pricing spec is run against the non-test database; the same 21 pass on the VPS with `.env.test`.
</objective>

<context>
@.planning/STATE.md
@.planning/phases/01-foundation-auth-bilingual-catalog-pricing/01-09-SUMMARY.md
@apps/web/AGENTS.md
@apps/web/src/proxy.ts
@apps/web/src/lib/current-user.ts
@apps/web/src/lib/session.ts
@apps/web/src/lib/auth-actions.ts
@apps/web/src/app/api/session/refresh/route.ts
@apps/api/test/utils/test-app.ts
</context>

<tasks>
  <task id="1" name="Refresh the session before rendering, and pass the pathname upstream">
    Read the installed Next.js 16 proxy and cookies documentation before editing. Remove all `setSession()` and `clearSession()` calls reachable from `getCurrentUser()` during Server Component rendering. Keep cookie writes in a Route Handler, Server Action, or proxy response. Choose one request-scoped refresh path that makes a newly rotated access token visible to Server Components on that same navigation; do not self-fetch `/api/session/refresh` and assume its Set-Cookie headers reach the browser. If using the proxy, forward the refreshed cookie or token as an upstream request header while setting the browser cookies on the returned response. Preserve next-intl rewrite/redirect behavior and keep tokens out of browser-readable content or response headers other than httpOnly Set-Cookie. Pass `x-pathname` as an upstream request header, not a response header. Handle invalid refresh as anonymous. Verify concurrent navigations do not revoke a valid session or loop on refresh.
  </task>
  <task id="2" name="Validate post-login destination on the server">
    Add a single helper used by `loginAction()` to accept only an application-local pathname in the current locale. Reject absolute URLs, `//` protocol-relative URLs, backslashes, control characters, malformed encoding, and paths under a different locale. A rejected value falls back to `/[locale]/account`. Treat the hidden `next` field as untrusted even if the login page initially populated it. Test valid catalog/admin paths and all rejection classes; verify Next.js `redirect()` never receives an external destination.
  </task>
  <task id="3" name="Separate test commands by database requirement">
    Move `price-resolution.service.spec.ts` into an integration test grouping or configure Jest so ordinary `pnpm test` excludes it. Add an explicit integration command that loads `.env.test`, refuses any database other than `kidtoy_test`, and runs the pricing tests. Keep the existing e2e guard and avoid implicit fallback to the repo-root `.env`. Document the unit, integration, and e2e commands in README. No test may truncate or seed the dev/production database.
  </task>
  <task id="4" name="Verify locally and on the VPS">
    Run fresh typecheck, lint, unit tests, web build, and API integration/e2e tests against the dedicated VPS `kidtoy_test` database. Run an internal-only web/API preview on the VPS; bind preview ports to 127.0.0.1 and tear down preview processes afterward. Exercise anonymous, valid access, expired access plus valid refresh, invalid refresh, and two concurrent refresh-triggering navigations. Exercise `next` with internal, external, protocol-relative, and cross-locale values. Use a focused proxy test to prove `x-pathname` reaches the upstream request. Record status codes, redirect Locations, Set-Cookie flags, and test counts in the summary without logging token or password values. Plan 10 must verify the real `/admin/products` round trip after that route exists.
  </task>
</tasks>

<done_when>
All four tasks pass. The VPS tests use only `kidtoy_test`; the working tree has no secret files or preview processes left behind. Create `01-09A-SUMMARY.md` with observed runtime evidence and any remaining limitation before starting Plan 10.
</done_when>

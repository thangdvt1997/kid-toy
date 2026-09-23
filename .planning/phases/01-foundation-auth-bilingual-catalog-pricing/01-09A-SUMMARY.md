---
phase: 01-foundation-auth-bilingual-catalog-pricing
plan: 09A
subsystem: auth
tags: [nextjs, proxy-middleware, httponly-cookies, open-redirect, jest, jest-testRegex]

# Dependency graph
requires:
  - phase: 01-foundation-auth-bilingual-catalog-pricing
    provides: "apps/web's session.ts/current-user.ts/auth-actions.ts/proxy.ts and apps/api's test-app.ts/pricing spec (Plan 09 + earlier), reviewed 2026-09-22 and found to have 3 real defects"
provides:
  - "apps/web/src/lib/session-cookies.ts — shared cookie name/attribute constants used by BOTH the Route Handler/Server Action cookie writers (session.ts) and proxy.ts's raw NextRequest/NextResponse cookie writes"
  - "apps/web/src/lib/session-refresh.ts — refreshSession(): de-duplicated, direct-to-API refresh-token exchange used exclusively by proxy.ts"
  - "apps/web/src/proxy.ts (rewritten) — refreshes the session and stamps x-pathname as an upstream REQUEST header BEFORE next-intl routing/render, never during render"
  - "apps/web/src/lib/current-user.ts (rewritten) — getCurrentUser() no longer writes cookies; requireStaff() unchanged in contract"
  - "apps/web/src/lib/redirect-target.ts — resolveRedirectTarget(next, locale): the one validator for post-login redirect destinations, wired into loginAction and login/page.tsx"
  - "apps/api test/jest-integration.json + apps/api's test:integration script — dedicated command for the DB-backed price-resolution.service.integration-spec.ts"
affects: [phase-01-plan-10 (admin UI — builds on requireStaff()/getCurrentUser(), both contract-unchanged), phase-01-plan-11 (VPS deploy — will run this plan's e2e/integration commands live)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Session refresh moved OUT of getCurrentUser() (a plain Server Component read) and INTO proxy.ts, which runs before any render starts — the only place Next.js 16 permits both reading the incoming request AND writing cookies before a Server Component sees them. proxy.ts calls the NestJS API directly (session-refresh.ts), never through this app's own /api/session/refresh Route Handler — a self-fetch would only expose an inner Response's Set-Cookie headers to itself, not to the browser."
    - "Concurrent-refresh de-duplication: refreshSession() keys an in-memory Map<refreshToken, Promise> so two navigations racing to refresh the SAME refresh-token value share one API call instead of each independently invoking the API's single-use rotation (which would otherwise 401 whichever request lost the race, for an otherwise-valid session). Documented as correct for this project's single-VPS/single-instance deployment target only."
    - "Cookie name/TTL/attribute constants live in session-cookies.ts (no next/headers dependency) so session.ts's cookies()-based writers and proxy.ts's raw NextRequest/NextResponse.cookies writers can never drift apart."
    - "A REQUEST header (not response header) must be stamped on request.headers BEFORE delegating to next-intl's createMiddleware() output — next-intl's own middleware.js copies request.headers into its own Headers instance and forwards it upstream via NextResponse's `{ request: { headers } }` option; that is the only path a Server Component's next/headers headers() ever sees."
    - "A DB-backed spec is distinguished from a plain unit spec purely by filename suffix (*.integration-spec.ts vs *.spec.ts) — apps/api's existing testRegex (`.*\\.spec\\.ts$`) requires a literal '.' immediately before 'spec', which 'integration-spec.ts' lacks, so the exclusion needed zero config changes beyond a rename."

key-files:
  created:
    - apps/web/src/lib/session-cookies.ts
    - apps/web/src/lib/session-refresh.ts
    - apps/web/src/lib/session-refresh.test.ts
    - apps/web/src/proxy.test.ts
    - apps/web/src/lib/current-user.test.ts
    - apps/web/src/lib/redirect-target.ts
    - apps/web/src/lib/redirect-target.test.ts
    - apps/web/test/auth-session.e2e-spec.ts
    - apps/api/test/jest-integration.json
    - .planning/phases/01-foundation-auth-bilingual-catalog-pricing/deferred-items.md
  modified:
    - apps/web/src/proxy.ts
    - apps/web/src/lib/current-user.ts
    - apps/web/src/lib/session.ts
    - apps/web/src/lib/auth-actions.ts
    - apps/web/src/app/[locale]/login/page.tsx
    - apps/web/src/app/api/session/refresh/route.ts
    - apps/web/jest.config.ts
    - apps/web/package.json
    - apps/api/package.json
    - apps/api/src/modules/pricing/price-resolution.service.spec.ts (renamed to .integration-spec.ts)
    - README.md

key-decisions:
  - "Removed the reactive (during-render) refresh path from getCurrentUser() entirely rather than trying to make it safe — Next.js's cookies().set()/.delete() flatly cannot run during Server Component rendering, so any fix had to move the refresh to a point BEFORE render. proxy.ts (which runs for every non-API route) was the only available pre-render hook."
  - "Chose in-flight-promise de-duplication (keyed by raw refresh-token string) over a distributed lock for the concurrent-refresh race, since the API's refresh rotation is single-use and this project's deployment target is a single VPS/single Node process (STACK.md) — documented explicitly as NOT sufficient for a future horizontally-scaled deployment."
  - "A transient refresh failure (network error, 5xx) intentionally leaves cookies untouched rather than clearing them like a genuine 401 does — clearing on every failure would have logged out a possibly-still-valid session on a momentary API blip, which the plan's own truth ('concurrent navigations do not revoke a valid session') implicitly rules out."
  - "resolveRedirectTarget() re-validates in BOTH login/page.tsx (defense in depth, prevents even echoing a bad value into the hidden field) and auth-actions.ts's loginAction (the real enforcement point) — a submitted form can always carry a value different from whatever was rendered, so the Server Action's own validation is what actually matters."
  - "Renamed the DB-backed pricing spec to *.integration-spec.ts instead of adding testPathIgnorePatterns — a filename-suffix convention is self-documenting at the file-listing level and needed zero changes to the existing default jest config in apps/api/package.json."
  - "apps/web gained a third 'e2e' jest project (test/**/*.e2e-spec.ts) excluded from the default `pnpm test` via `--selectProjects node jsdom`, mirroring apps/api's existing test vs. test:e2e split, rather than a wholly separate config file — keeps all three projects' shared next/jest setup (server-only mock, moduleNameMapper) in one place."

requirements-completed: [AUTH-01, AUTH-04, CATALOG-06]

# Metrics
duration: ~100min
completed: 2026-09-23
---

# Phase 1 Plan 09A: Auth/Session Hardening (Cookie-Write Timing, Open Redirect, Test-DB Separation) Summary

**Moved the Plan 09 auth session refresh out of Server Component render time and into proxy.ts (fixing an illegal render-time cookie write), added a server-side allowlist validator for the post-login `next` redirect target (fixing an open redirect), and separated the one database-backed pricing spec from `apps/api`'s default unit-test command via a filename-suffix convention plus a dedicated `test:integration` command.**

## Performance

- **Duration:** ~100 min
- **Tasks:** 3/3 completed (Task 4's live-VPS portion deferred to the orchestrator — see below)
- **Files modified:** 21 (12 created, 9 modified, 1 renamed)

## Accomplishments

- **Defect 1 fixed — render-time cookie writes:** `getCurrentUser()` (current-user.ts) no longer calls `setSession()`/`clearSession()` at all. Session rotation now happens exclusively in `proxy.ts`, which runs before any Server Component render starts. It reads the incoming `kt_refresh` cookie directly (skipping the API round trip entirely when `kt_session` is already present), exchanges it against the NestJS API directly via the new `session-refresh.ts` (never through this app's own `/api/session/refresh` Route Handler, which would only expose Set-Cookie on an unrelated inner Response), sets the browser-visible `Set-Cookie` pair on its own response, and rewrites the in-flight `NextRequest`'s own cookies so the SAME navigation's render sees the rotated access token immediately — not just the next one. An invalid/expired refresh token (a real 401 from the API) clears both cookies; a transient failure (network error, 5xx) leaves cookies untouched so a momentary API blip never logs out a valid session. Concurrent navigations presenting the SAME refresh-token value are de-duplicated in-memory (the API's rotation is single-use, so two independent calls would otherwise spuriously 401 one of them) — documented as correct for this project's single-VPS/single-process deployment target, not a distributed lock.
- **Defect 2 fixed — incorrect proxy pathname forwarding:** `x-pathname` is now set on `request.headers` **before** delegating to next-intl's `createMiddleware()` output, not on the response afterward. Verified directly against next-intl's own middleware source (`node_modules/next-intl/dist/esm/production/middleware/middleware.js`): it copies `request.headers` into its own `Headers` instance and forwards it upstream via `NextResponse`'s `{ request: { headers } }` option — the only path a Server Component's `next/headers` `headers()` ever observes. The previous code set it as a response header, which only the browser's network tab could see.
- **Defect 3 fixed — unvalidated post-login `next` redirect:** `resolveRedirectTarget(next, locale)` (redirect-target.ts) is the single validator now used by both `loginAction` (the real enforcement point — `next` is treated as untrusted even though the login page populated the hidden field) and `login/page.tsx` (defense in depth, so a bad value is never even echoed back into the page source). It accepts only an application-local pathname in the CURRENT locale; absolute URLs, protocol-relative (`//`) URLs, backslash-based bypasses, control characters, malformed percent-encoding, and cross-locale paths all fall back to `/[locale]/account`.
- **Test-command separation:** `price-resolution.service.spec.ts` renamed to `price-resolution.service.integration-spec.ts` — `apps/api/package.json`'s existing `testRegex` (`.*\.spec\.ts$`) requires a literal `.` immediately before `spec`, which the new suffix lacks, so the exclusion from the default `pnpm test` needed zero config changes. Added `apps/api/test/jest-integration.json` (loads `.env.test` via the existing `setup-env.ts`, matches only `*.integration-spec.ts`) and a new `test:integration` script; `test-app.ts`'s `assertTestDatabase()` guard (unchanged) still refuses anything but `kidtoy_test`. Verified locally: default `pnpm --filter api test` now reports 9 suites / 108 tests passing (previously would have included the DB-backed spec and failed); `pnpm --filter api test:integration` correctly targets only the renamed file and fails ONLY on missing local MinIO/Postgres infrastructure (the same "no Docker on this dev machine" condition documented in every prior Phase 1 plan) — not on database selection, confirming the fix.
- **New regression coverage:** `session-refresh.test.ts` (7 tests: direct-API call shape, 401→invalid, non-401→transient, network error→transient, missing base URL→transient, same-token de-dup, different-token no-dup, retry-after-settle), `proxy.test.ts` (6 tests: x-pathname as request header not response header, no-refresh-when-access-cookie-present, no-refresh-when-anonymous, rotate-on-success with Set-Cookie + forwarded request cookie, clear-on-invalid, untouched-on-transient), `current-user.test.ts` (7 tests: no-token/success/401/5xx paths for `getCurrentUser`, redirect/fallback/notFound/success paths for `requireStaff`), `redirect-target.test.ts` (16 tests covering every accept/reject class), and `apps/web/test/auth-session.e2e-spec.ts` (5 HTTP-level tests: cookie rotation, expired-access-plus-valid-refresh, invalid-refresh-anonymous, concurrent-refresh-no-revocation, logout) — the last file requires a live preview + API + `kidtoy_test` and is gated behind required `E2E_*` env vars with no default/fallback URL.

## Task Commits

Each task was committed atomically:

1. **Task 1: Refresh the session before rendering, and pass the pathname upstream** — `623c1b8` (fix)
2. **Task 2: Validate post-login destination on the server** — `b156a08` (fix)
3. **Task 3: Separate test commands by database requirement** — `c80e52f` (test)

_Task 4 ("Verify locally and on the VPS") has no separate commit — its local-only portion (typecheck/lint/unit-test/build) was run after every task as part of that task's own verification, and is re-confirmed in aggregate below. Its VPS portion is explicitly deferred (see "Deviation from Task 4" below)._

## Files Created/Modified

- `apps/web/src/lib/session-cookies.ts` (new) — shared cookie name/TTL/attribute constants, no `next/headers` dependency
- `apps/web/src/lib/session-refresh.ts` (new) — de-duplicated, direct-to-API refresh exchange for proxy.ts
- `apps/web/src/lib/session-refresh.test.ts`, `apps/web/src/proxy.test.ts`, `apps/web/src/lib/current-user.test.ts` (new) — regression coverage for Task 1
- `apps/web/src/proxy.ts` — rewritten: pre-render refresh + correct upstream `x-pathname` request header
- `apps/web/src/lib/current-user.ts` — `getCurrentUser()` no longer writes cookies; `requireStaff()` contract unchanged
- `apps/web/src/lib/session.ts` — cookie writers now source their attributes from `session-cookies.ts`
- `apps/web/src/app/api/session/refresh/route.ts` — doc comment only, clarifying its relationship to proxy's independent refresh path
- `apps/web/src/lib/redirect-target.ts` + `redirect-target.test.ts` (new) — the post-login redirect validator and its 16-case test suite
- `apps/web/src/lib/auth-actions.ts` — `loginAction` now resolves `next` through `resolveRedirectTarget`
- `apps/web/src/app/[locale]/login/page.tsx` — validates the `next` query param before echoing it into the hidden field
- `apps/web/test/auth-session.e2e-spec.ts` (new) — HTTP-level regression coverage, VPS-only (see Deviations)
- `apps/web/jest.config.ts` — added `src/proxy.test.ts` to the "node" project's testMatch; added a third "e2e" project
- `apps/web/package.json` — `test` now runs `--selectProjects node jsdom`; added `test:e2e`
- `apps/api/src/modules/pricing/price-resolution.service.spec.ts` → renamed to `price-resolution.service.integration-spec.ts`, plus an added doc-comment explaining the naming convention
- `apps/api/test/jest-integration.json` (new) — dedicated Jest config for the renamed spec
- `apps/api/package.json` — added `test:integration` script
- `README.md` — new "Testing" section documenting all three test tiers across both apps
- `.planning/phases/01-foundation-auth-bilingual-catalog-pricing/deferred-items.md` (new) — logs an out-of-scope discovery (see Issues Encountered)

## Decisions Made

See `key-decisions` in the frontmatter for full rationale on: (1) moving refresh entirely out of `getCurrentUser()` into `proxy.ts`; (2) in-memory concurrent-refresh de-duplication scoped explicitly to this project's single-instance deployment; (3) treating a transient refresh failure differently from a genuine 401; (4) validating `next` in both the Server Action and the page for defense in depth; (5) the filename-suffix convention for excluding the DB-backed spec; (6) the `--selectProjects`-based "e2e" jest project for `apps/web`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `apps/web` test suite failed to load `next-intl`'s ESM `routing.js` once `proxy.ts` and `redirect-target.ts` were unit-tested directly**
- **Found during:** Task 1, first run of `pnpm --filter web test` after adding `proxy.test.ts`
- **Issue:** `proxy.ts` and `redirect-target.ts` both import `./i18n/routing` (a wrapper around `next-intl/routing`'s `defineRouting`), which ships as an ESM-only build Jest's CJS transform cannot parse under this project's `next/jest`-generated config. No test had ever imported either module directly before this plan (Plan 09's tests all mocked `next-intl/server` instead), so this had never surfaced.
- **Fix:** `jest.mock("./i18n/routing", ...)` / `jest.mock("@/i18n/routing", ...)` in the two new test files, substituting the real `{ locales, defaultLocale }` shape so the modules under test build their locale-matching logic identically to production.
- **Files modified:** `apps/web/src/proxy.test.ts`, `apps/web/src/lib/redirect-target.test.ts`
- **Verification:** `pnpm --filter web test` — all suites pass.
- **Committed in:** `623c1b8` (proxy.test.ts), `b156a08` (redirect-target.test.ts)

**2. [Rule 1 - Bug] Temporal Dead Zone crash when mocking `next-intl/middleware`'s `createMiddleware`**
- **Found during:** Task 1, first run of `proxy.test.ts`
- **Issue:** `proxy.ts` calls `createMiddleware(routing)` exactly once at module load (a top-level `const`). The first mock attempt (`default: jest.fn(() => handleI18nRoutingMock)`) evaluated the module-scoped `handleI18nRoutingMock` binding immediately when `default()` was called during that module-load-time hoisted `require`, before the test file's own top-level `const` had run — a genuine TDZ `ReferenceError`, not a logic bug in `proxy.ts` itself.
- **Fix:** The mock's `default` export now returns a stable wrapper closure (`() => (req) => handleI18nRoutingMock(req)`) that only dereferences the mock function when actually INVOKED (i.e., during a real `proxy()` call inside a test body, well after the whole module has finished initializing), not at mock-construction time.
- **Files modified:** `apps/web/src/proxy.test.ts`
- **Verification:** `pnpm --filter web test` passes; all 6 proxy tests correctly observe per-test `mockImplementation` overrides.
- **Committed in:** `623c1b8`

**3. [Rule 3 - Blocking] `pnpm --filter api lint`'s `--fix` reformatted ~55 unrelated pre-existing files**
- **Found during:** Task 3, attempting to lint-verify the renamed integration spec
- **Issue:** `apps/api`'s `lint` script runs `eslint ... --fix` across the entire `{src,apps,libs,test}` glob. Running it reformatted virtually the whole `apps/api` tree (pre-existing Prettier drift unrelated to this plan) and surfaced genuine pre-existing `@typescript-eslint/no-unsafe-*` errors in three e2e spec files this plan never touched. This is out of scope per the executor's scope-boundary rule (only auto-fix issues directly caused by the current task's own changes).
- **Fix:** Reverted every unintended reformatted file via `git checkout --` (never a blanket reset), keeping only the intentional rename + doc-comment addition on the pricing spec. Re-verified the ONE touched file with a non-mutating, file-scoped `npx eslint <path>` (no `--fix`) to confirm the rename+comment introduced no NEW problems beyond the same pre-existing drift. Logged the discovery to `deferred-items.md` rather than fixing it.
- **Files modified:** none (this was a revert of unintended changes, not a fix); `.planning/phases/01-foundation-auth-bilingual-catalog-pricing/deferred-items.md` created to document it.
- **Verification:** `git status --short` confirmed a clean, minimal diff after the revert; `pnpm --filter api typecheck`, `pnpm --filter api test`, `pnpm --filter api test:integration`, and `pnpm --filter api build` all still pass/behave as expected.
- **Committed in:** `c80e52f` (deferred-items.md only; no unrelated file was ever committed)

---

**Total deviations:** 3 auto-fixed (2 test-infrastructure bugs caught before they could ship, 1 blocking issue correctly deferred rather than fixed out-of-scope). None required an architectural decision or user input.

## Issues Encountered

- **`pnpm --filter api lint` is not safe to run as a verification step in its current form** on this codebase — see Deviation 3 above and `deferred-items.md`. This plan's Task 4 local verification therefore used `pnpm turbo run typecheck` (all 3 packages), `pnpm turbo run test` (all packages), `pnpm --filter web lint` (clean), and `pnpm --filter web build` (clean) — deliberately excluding `pnpm --filter api lint` to avoid reformatting unrelated files a second time.
- **No Docker and no live seeded API/Postgres/Redis/MinIO stack reachable on this dev machine** — the same documented condition as every prior Phase 1 plan. `pnpm --filter api test:integration` correctly attempts to run only the renamed DB-backed spec and fails ONLY because MinIO/Postgres aren't reachable here (confirmed: it got past `assertTestDatabase()`'s database-name check and failed later trying to reach MinIO), not because of a wrong database — exactly the outcome this task's fix was meant to produce. `apps/web/test/auth-session.e2e-spec.ts` was written but not run locally for the same reason (and additionally requires a running `apps/web` preview, which this plan's own deviation note explicitly defers).

## Deviation from Task 4 (explicit, per orchestrator instruction)

Per this execution's instructions, **Task 4's live-VPS verification is deferred to the orchestrator**, exactly as it has been for every prior Phase 1 plan (03 onward). This executor has NO SSH/VPS access and this dev machine has no Docker. What was run locally, fully green:

- `pnpm turbo run typecheck` (3/3 packages: `@kid-toy/shared-types`, `api`, `web`)
- `pnpm turbo run test` (`api`: 9 suites / 108 tests; `web`: 7 suites / 54 tests, including all new Task 1/2 regression tests)
- `pnpm --filter web lint` (clean)
- `pnpm --filter web build` (clean; all 11 routes + Proxy/Middleware compile)
- `pnpm --filter api test:integration` (confirmed it correctly targets the renamed spec and fails only on missing local infra, not database selection)

**Explicitly NOT run by this execution** (orchestrator follow-up, mirroring every prior plan's pattern):
1. `pnpm --filter api test:e2e` and `pnpm --filter api test:integration` against the VPS's real `kidtoy_test` database (129/129 + the 21 pricing-spec cases expected to pass, per this plan's own evidence baseline).
2. An internal-only `apps/web` + `apps/api` preview on the VPS (bound to `127.0.0.1`, torn down afterward) to actually run `apps/web/test/auth-session.e2e-spec.ts` (`E2E_WEB_BASE_URL`, `E2E_API_BASE_URL`, `E2E_SEED_EMAIL`, `E2E_SEED_PASSWORD`) — this is the live confirmation that: an expired access cookie + valid refresh cookie yields a new cookie pair and an authenticated page on the same navigation; an invalid refresh cookie yields an anonymous redirect with no unhandled exception; two concurrent refresh-triggering navigations don't revoke a valid session; and logout clears both cookies.
3. Manual/browser-level exercise of the `next=` parameter with external/protocol-relative/cross-locale values through the REAL login page's Server Action (not reproducible via plain HTTP fetch without driving Next.js's Server Action RPC protocol — `redirect-target.test.ts`'s 16 unit tests already exhaustively cover the validator's own logic in isolation).
4. No preview processes or secret files were created by this execution, so none need to be torn down.

No blockers for Plan 10: `requireStaff()`'s exported contract (`Promise<AuthenticatedAccount>`, same redirect/notFound behavior) is unchanged by this plan — only its internal refresh mechanism moved.

## User Setup Required

None — no new environment variables for production. `apps/web/test/auth-session.e2e-spec.ts` requires `E2E_WEB_BASE_URL` / `E2E_API_BASE_URL` / `E2E_SEED_EMAIL` / `E2E_SEED_PASSWORD` to run at all, but only for that one VPS-only e2e command (`pnpm --filter web test:e2e`), documented in the spec file's own header comment and in the root README.

## Next Phase Readiness

- Plan 10 (staff admin UI) can proceed unblocked — `requireStaff(roles: StaffRole[])`'s exported signature and observable behavior (redirect anonymous to a correct `next=`-bearing login URL via a now-correct `x-pathname`, `notFound()` an insufficient role) are unchanged; only the internal refresh timing moved from `getCurrentUser()` into `proxy.ts`.
- All three of this plan's `must_haves.truths` are code-complete and unit-tested; the two requiring a live stack (cookie rotation on a real navigation, concurrent-refresh non-revocation) are additionally covered end-to-end in `auth-session.e2e-spec.ts`, awaiting the orchestrator's VPS run.
- **Orchestrator follow-up (same pattern as Plans 03-09):** sync this code to the deploy VPS and run: (1) `pnpm --filter api test:e2e` and `pnpm --filter api test:integration` against the live `kidtoy_test` database; (2) start an internal-only `apps/web` + `apps/api` preview (bound to `127.0.0.1`, torn down after) and run `E2E_WEB_BASE_URL=... E2E_API_BASE_URL=... E2E_SEED_EMAIL=customer@kidtoy.local E2E_SEED_PASSWORD=<seed password> pnpm --filter web test:e2e`; (3) manually verify the `next=` open-redirect fix through a real browser: log in with `?next=https://evil.example.com`, `?next=//evil.example.com`, and `?next=/en/account` (cross-locale, while on `/vi/login`) and confirm every case lands on `/vi/account`, never the attacker-controlled destination.

## Self-Check: PASSED

All 12 created files verified present on disk (`apps/web/src/lib/session-cookies.ts`, `session-refresh.ts`, `session-refresh.test.ts`, `apps/web/src/proxy.test.ts`, `apps/web/src/lib/current-user.test.ts`, `redirect-target.ts`, `redirect-target.test.ts`, `apps/web/test/auth-session.e2e-spec.ts`, `apps/api/test/jest-integration.json`, `.planning/phases/01-foundation-auth-bilingual-catalog-pricing/deferred-items.md`, plus the renamed `apps/api/src/modules/pricing/price-resolution.service.integration-spec.ts`); all 3 task commits (`623c1b8`, `b156a08`, `c80e52f`) verified present in `git log`; working tree confirmed clean (`git status --short` empty) before this SUMMARY was written.

---
*Phase: 01-foundation-auth-bilingual-catalog-pricing*
*Completed: 2026-09-23*

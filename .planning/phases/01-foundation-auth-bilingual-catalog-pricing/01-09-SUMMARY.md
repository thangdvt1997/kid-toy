---
phase: 01-foundation-auth-bilingual-catalog-pricing
plan: 09
subsystem: auth
tags: [nextjs, server-actions, react19, httponly-cookies, next-intl, jest]

# Dependency graph
requires:
  - phase: 01-foundation-auth-bilingual-catalog-pricing
    provides: "POST /api/auth/{register,login,refresh,logout,forgot-password,reset-password}, GET /api/auth/me, POST /api/business-accounts/register (Plans 03-04); apps/web's api-client.ts/session.ts/SiteHeader.tsx slot and Jest framework (Plan 08)"
provides:
  - "apps/web/src/lib/session.ts (extended) — setSession/clearSession/getRefreshToken, httpOnly+sameSite=lax+secure-in-prod cookie writers"
  - "apps/web/src/app/api/session/route.ts + refresh/route.ts — credential exchange and refresh rotation, tokens never leave the server as readable response data"
  - "apps/web/src/lib/current-user.ts — getCurrentUser() (React cache-memoized, transparent refresh, never throws) and requireStaff() (UX-convenience redirect/notFound gate) — the contract Plan 10's admin UI builds on"
  - "apps/web/src/lib/auth-actions.ts — every Server Action for login/logout/register (retail+B2B)/forgot-password/reset-password"
  - "Working /[locale]/{login,register,register-business,forgot-password,reset-password,account} pages, functional-but-unstyled"
  - "AccountNav wired into SiteHeader's marked slot"
affects: [phase-01-plan-10 (admin UI — requireStaff/getCurrentUser contract), phase-03-b2c-storefront, phase-04-b2b-portal]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single shared exchangeCredentialsForSession() helper in auth-actions.ts is the ONLY code path that calls POST /api/auth/login and writes cookies — both /api/session's route handler and loginAction call it directly (a plain function call, not a nested self-fetch). next/headers' cookies() is scoped to the current request's AsyncLocalStorage context; a Server Action doing a self-fetch to its own /api/session route would set cookies on an unrelated internal Response the browser never sees. Direct function invocation keeps cookie writes on the real outgoing response regardless of entry point."
    - "proxy.ts (next-intl's middleware, renamed from middleware.ts in Next 16) now also stamps an x-pathname response header — the only way a plain Server Component (current-user.ts's requireStaff) can read the current request's pathname to build a correct next= redirect target, since next/headers' headers() only exposes HTTP request headers, not the URL."
    - "Every auth page is a thin async Server Component (reads params/searchParams, calls getTranslations) rendering a colocated 'use client' *Form.tsx component that owns the useActionState hook — keeps useSearchParams/interactive state off the server-rendered shell and avoids the Suspense-boundary requirement a fully client page.tsx would trigger."
    - "Server Actions return { ok: true } | { ok: false; error: <message key> } — every API error is mapped to a message key before reaching the UI (T-01-73); on success, actions that log the user in call redirect() rather than returning ok:true, so the form component only needs to render the error branch."

key-files:
  created:
    - apps/web/src/app/api/session/route.ts
    - apps/web/src/app/api/session/refresh/route.ts
    - apps/web/src/lib/current-user.ts
    - apps/web/src/lib/auth-actions.ts
    - apps/web/src/components/FormError.tsx
    - apps/web/src/components/AccountNav.tsx
    - apps/web/src/app/[locale]/login/page.tsx
    - apps/web/src/app/[locale]/login/LoginForm.tsx
    - apps/web/src/app/[locale]/account/page.tsx
    - apps/web/src/app/[locale]/register/page.tsx
    - apps/web/src/app/[locale]/register/RegisterForm.tsx
    - apps/web/src/app/[locale]/register-business/page.tsx
    - apps/web/src/app/[locale]/register-business/RegisterBusinessForm.tsx
    - apps/web/src/app/[locale]/forgot-password/page.tsx
    - apps/web/src/app/[locale]/forgot-password/ForgotPasswordForm.tsx
    - apps/web/src/app/[locale]/reset-password/page.tsx
    - apps/web/src/app/[locale]/reset-password/ResetPasswordForm.tsx
  modified:
    - apps/web/src/lib/session.ts
    - apps/web/src/components/SiteHeader.tsx
    - apps/web/src/proxy.ts
    - apps/web/src/lib/api-client.ts
    - apps/web/src/lib/api-client.test.ts
    - apps/web/messages/vi.json
    - apps/web/messages/en.json

key-decisions:
  - "auth-actions.ts implemented as one complete module across what the plan frames as three tasks (login/logout, registration, password reset) rather than incrementally extended per task — it is one cohesive set of Server Actions with shared imports/types (ActionState), and splitting the file's own diff across three commits would have meant either a non-compiling intermediate commit or purely cosmetic hunk-splitting with no real behavioral boundary. Task 1's commit contains the full file; Tasks 2-3's commits only add their new page/component files. Mirrors the precedent set in 01-08-SUMMARY.md for combining tightly-coupled deliverables."
  - "Both message catalogs' full Auth namespace (all ~51 keys spanning all three tasks) was added in a single edit and committed with Task 1, for the same reason — one JSON object, no natural per-task diff boundary."
  - "Added apps/web/src/proxy.ts (Next 16's renamed middleware.ts) stamping an x-pathname response header, not listed in the plan's files_modified — required for requireStaff() to build a correct `next=` redirect target from a Server Component, since Next.js gives Server Components no built-in access to the current request's pathname."
  - "Colocated a client *Form.tsx component next to every auth page.tsx (LoginForm, RegisterForm, RegisterBusinessForm, ForgotPasswordForm, ResetPasswordForm) rather than making page.tsx itself a client component — keeps each page a plain async Server Component reading params/searchParams (the plan's literal 'a server component rendering a client form' architecture) and avoids Next's Suspense-boundary requirement for useSearchParams in a bare client page."
  - "Rule 1 fix: apps/web/src/lib/api-client.ts's apiSend assumed only a 204 response has an empty body. POST /api/auth/forgot-password returns 202 with no body, which made res.json() throw a SyntaxError instead of resolving to undefined — this would have made forgotPasswordAction incorrectly report Common.error for every successful request. apiSend now reads the body as text first and only JSON.parses when non-empty, for any success status. Updated api-client.test.ts's Response mock to provide both .json() and .text()."

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-05, CATALOG-06]

# Metrics
duration: ~85min
completed: 2026-09-22
---

# Phase 1 Plan 9: Browser-Reachable Authentication (Login, Registration, Password Reset) Summary

**Every auth capability from Plans 03-04 reachable through a browser via Next.js Server Actions and httpOnly cookies — login/logout, retail self-registration, B2B registration with licence upload and an explicit pending-approval state, and a full forgot/reset-password cycle — with tokens that are never readable from client-side JavaScript and a session that survives a refresh via transparent rotation.**

## Performance

- **Duration:** ~85 min
- **Tasks:** 3/3 completed
- **Files modified:** 24 (17 created, 7 modified)

## Accomplishments

- **AUTH-01 (staff login, session survives refresh):** `/api/session` (POST/DELETE) and `/api/session/refresh` exchange credentials for two httpOnly, `sameSite=lax`, secure-in-production cookies (`kt_session` 15min, `kt_refresh` 30d) — the response body is always empty on success and never contains the substrings `accessToken`/`refreshToken`. `getCurrentUser()` (React `cache()`-memoized per request) transparently refreshes an expired access token once before giving up, and clears stale cookies on persistent failure without ever throwing. `AccountNav` renders a login link when anonymous, or the account's email + a logout button (+ an admin link for STAFF) when authenticated — wired into `SiteHeader.tsx`'s Plan 08-marked slot.
- **AUTH-02 (retail registration):** `/[locale]/register` posts to `registerCustomerAction`, which reuses the exact same `setSession` cookie-writer as login, then redirects to `/[locale]/account`. A duplicate email maps to the localized `Auth.emailTaken` message; the client `minLength={10}` password hint is documented as a UX convenience only.
- **AUTH-03 (B2B registration + licence upload):** `/[locale]/register-business` submits multipart form data (email, password, companyName, taxId, a three-option `businessType` select with the exact required vi/en labels "Cửa hàng"/"Trường học"/"Nhà phân phối", optional contact fields, and a required licence file with `accept=".pdf,.jpg,.jpeg,.png"`). `registerBusinessAction` deliberately never calls `setSession` — a PENDING business account is not an active session — and on success replaces the form with an explicit pending-approval panel, never a false "active account" impression (T-01-74). Duplicate email/tax ID map to distinct localized messages by inspecting the API's `EMAIL_TAKEN`/`TAX_ID_TAKEN` error text.
- **AUTH-05 (password reset):** `/[locale]/forgot-password` renders the byte-identical uniform confirmation for any non-5xx outcome — no account-enumeration signal in the UI (T-01-69). `/[locale]/reset-password` renders the invalid-token state immediately when no `token` query param is present (never an empty form); the token is carried only in a hidden `<input>`, never displayed as text or logged; a `password`/`passwordConfirm` mismatch is checked and returns an error BEFORE any network request.
- **CATALOG-06's demonstration loop closes:** an approved dealer logging in through `/[locale]/login` now changes what Plan 08's `/[locale]/catalog` pages render with zero code change in the catalog pages themselves — `api-client.ts`'s existing `auth: true` mechanism (Plan 08) picks up the newly-written `kt_session` cookie automatically.
- **requireStaff() is ready for Plan 10:** redirects an anonymous visitor to `/[locale]/login?next=<current path>` (built from a new `x-pathname` header stamped by `proxy.ts`) and calls `notFound()` — never merely hides a control — for an authenticated non-matching role, with an inline comment documenting that the API's `RolesGuard` is the real enforcement point (AUTH-04).
- Every Server Action maps API failures to a message KEY (`Auth.invalidCredentials`, `Auth.emailTaken`, `Auth.taxIdTaken`, `Auth.resetTokenInvalid`, `Common.error`, etc.) — no raw API text ever reaches the UI (T-01-73).
- `pnpm --filter web exec tsc --noEmit`, `pnpm turbo run typecheck` (all 3 packages), `pnpm --filter web lint`, `pnpm --filter web test` (16/16, including the updated `api-client.test.ts`), and `pnpm --filter web build` all pass clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: httpOnly session plumbing, login page and header account state (AUTH-01)** - `d5ebe00` (feat)
2. **Task 2: Retail registration and B2B registration with licence upload (AUTH-02, AUTH-03)** - `58de9da` (feat)
3. **Task 3: Forgot-password and reset-password pages (AUTH-05)** - `9903fd9` (feat)

_Note: this plan's task frontmatter marks each task `tdd="true"`, but — exactly as 01-08-SUMMARY.md documented for the same situation — the plan's own `type` is `execute`, not `tdd`, and every task's actual behavioral gate is the plan's live-stack HTTP `<verify>` script (deferred to the orchestrator's VPS run, see Issues Encountered), not a jsdom component/unit test file; no test files are listed in any task's `files_modified`. Each task therefore landed as one `feat` commit rather than a RED/GREEN pair. `auth-actions.ts` and both message catalogs are implemented as complete, cohesive modules spanning all three tasks (see `key-decisions` for the full rationale) — Task 1's commit carries their complete content; Tasks 2-3's commits add only their new page/component files._

## Files Created/Modified

- `apps/web/src/lib/session.ts` — extended: `REFRESH_COOKIE`, `setSession`, `clearSession`, `getRefreshToken`
- `apps/web/src/app/api/session/route.ts` (+ `refresh/route.ts`) — credential exchange, logout, refresh rotation
- `apps/web/src/lib/current-user.ts` — `getCurrentUser`, `requireStaff`
- `apps/web/src/lib/auth-actions.ts` — every Server Action for this plan, plus `exchangeCredentialsForSession`
- `apps/web/src/components/FormError.tsx`, `AccountNav.tsx` — shared error display, header auth state
- `apps/web/src/components/SiteHeader.tsx` — `AccountNav` wired into the Plan 08-marked slot
- `apps/web/src/proxy.ts` — stamps `x-pathname` for `requireStaff`'s redirect target
- `apps/web/src/app/[locale]/login/page.tsx` + `LoginForm.tsx`
- `apps/web/src/app/[locale]/account/page.tsx`
- `apps/web/src/app/[locale]/register/page.tsx` + `RegisterForm.tsx`
- `apps/web/src/app/[locale]/register-business/page.tsx` + `RegisterBusinessForm.tsx`
- `apps/web/src/app/[locale]/forgot-password/page.tsx` + `ForgotPasswordForm.tsx`
- `apps/web/src/app/[locale]/reset-password/page.tsx` + `ResetPasswordForm.tsx`
- `apps/web/src/lib/api-client.ts` / `api-client.test.ts` — empty-body fix for non-204 success statuses (202)
- `apps/web/messages/vi.json`, `messages/en.json` — full `Auth` namespace (51 keys)

## Decisions Made

See `key-decisions` in the frontmatter for full rationale on: (1) `auth-actions.ts` and both message catalogs implemented as complete modules in Task 1's commit rather than incrementally per task; (2) adding `proxy.ts`'s `x-pathname` header, not in the plan's file list, as the only way for a Server Component to read the current pathname; (3) colocating a client `*Form.tsx` next to every server `page.tsx` to keep pages as plain async Server Components; (4) the `exchangeCredentialsForSession` direct-function-call pattern instead of a self-fetch to `/api/session`, to avoid a real cookie-forwarding bug (see Deviations).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, caught before it shipped] Self-fetch to `/api/session` would not have actually set cookies on the browser's response**
- **Found during:** Task 1, designing `loginAction`
- **Issue:** The plan's literal text says `loginAction` "posts to the internal `/api/session` route handler." A literal server-to-server `fetch()` from a Server Action to its own `/api/session` route creates an independent nested Request/Response cycle; `cookies().set()` calls inside that nested route handler's execution write to the outgoing Response of THAT nested request (which only the fetch() caller sees via `Set-Cookie` response headers), not to the real Response Next.js sends back to the browser for the Server Action's own request. Naively implementing this would have silently produced a 204 with no error, but the browser would never actually receive the session cookies.
- **Fix:** Extracted the credential-exchange-and-cookie-write logic into one exported helper, `exchangeCredentialsForSession`, in `auth-actions.ts`. Both `/api/session`'s own `POST` handler and `loginAction` call this helper directly (a plain async function call within the same request's execution context), so `cookies().set()` always applies to the real outgoing response regardless of entry point. This still satisfies the plan's actual intent — "cookie writing lives in one place" — without the broken self-fetch mechanism.
- **Files modified:** `apps/web/src/lib/auth-actions.ts`, `apps/web/src/app/api/session/route.ts`
- **Verification:** `pnpm --filter web exec tsc --noEmit` passes; manually traced Next.js's documented `cookies()`/AsyncLocalStorage request-scoping model (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`) to confirm the direct-call pattern is correct where a self-fetch would not have been.
- **Committed in:** `d5ebe00`

**2. [Rule 1 - Bug] `apiSend` threw a SyntaxError on POST /api/auth/forgot-password's empty 202 body**
- **Found during:** Task 3, implementing `forgotPasswordAction`
- **Issue:** `apiSend` only special-cased status `204` as having no body and otherwise unconditionally called `res.json()`. `POST /api/auth/forgot-password` (Plan 04) returns `202` with no body — `res.json()` on an empty body throws `SyntaxError: Unexpected end of JSON input`, an error that is NOT an `instanceof ApiError`, which would have made `forgotPasswordAction` incorrectly fall through to `{ ok: false, error: 'Common.error' }` for every successful request instead of the required uniform `{ ok: true }`.
- **Fix:** `apiSend` now reads the response body via `res.text()` first and only `JSON.parse`s when the text is non-empty, for any success status (not just 204). Updated the existing `api-client.test.ts` mock `Response` object to provide both `.json()` and `.text()` so the pre-existing apiSend tests (from Plan 08) still pass.
- **Files modified:** `apps/web/src/lib/api-client.ts`, `apps/web/src/lib/api-client.test.ts`
- **Verification:** `pnpm --filter web test` — all 16 tests (including the 2 pre-existing `apiSend` cases) pass; confirmed by re-reading `apps/api/src/modules/auth/auth.controller.ts` that `forgotPassword` is `@HttpCode(HttpStatus.ACCEPTED)` returning `Promise<void>` (genuinely empty body).
- **Committed in:** `9903fd9`

**3. [Rule 2 - Missing Critical Functionality] `requireStaff()` had no way to read the current request's pathname**
- **Found during:** Task 1, implementing `current-user.ts`
- **Issue:** The plan's interface specifies `requireStaff(roles): Promise<AuthenticatedAccount>` (no path/locale parameters) that must redirect to `/[locale]/login?next=<current path>`. Next.js Server Components have no built-in API to read the current request's URL pathname — `next/headers`' `headers()` only exposes HTTP request headers, and there is no framework equivalent of `usePathname()` for the server.
- **Fix:** Modified `apps/web/src/proxy.ts` (Next 16's renamed `middleware.ts`) to wrap next-intl's routing middleware and additionally stamp `response.headers.set('x-pathname', request.nextUrl.pathname)`. `requireStaff()` reads this header via `headers()` to build the `next=` redirect target, falling back to `/${locale}` if absent (e.g. a request the matcher excludes).
- **Files modified:** `apps/web/src/proxy.ts`, `apps/web/src/lib/current-user.ts`
- **Verification:** `pnpm --filter web build` succeeds and lists `Proxy (Middleware)` in the route summary; `requireStaff`'s source contains both `redirect(` and `notFound(` per the plan's own acceptance-criteria grep.
- **Committed in:** `d5ebe00`

---

**Total deviations:** 3 auto-fixed (2 correctness bugs caught before they could ship, 1 missing-critical-functionality addition). None required an architectural decision or user input — all three were necessary for the plan's own specified behavior (working cookies, a correctly-uniform forgot-password response, a working `requireStaff` redirect target) to actually hold, not scope creep.

## Issues Encountered

- **No Docker and no live seeded API/Postgres/Redis/MinIO stack reachable on this dev machine** — same documented condition as every prior Phase 1 plan. Everything statically verifiable is green: `pnpm --filter web exec tsc --noEmit`, `pnpm turbo run typecheck` (all 3 workspace packages), `pnpm --filter web lint`, `pnpm --filter web test` (16/16), and `pnpm --filter web build` (all 8 new routes plus the 2 new `/api/session*` route handlers compile and are correctly reported as dynamic `ƒ`).
- **A stray `apps/api` process was found listening on `localhost:4000`** during manual smoke testing (not started by this execution). It responds to HTTP requests but has no reachable Postgres/Redis/MinIO behind it (confirmed via `netstat` — no listener on 5432/6379/9000, and `docker` is not installed on this machine). `AuthService.validateCredentials`'s constant-time dummy-hash fallback (01-03) causes it to return a generic 401 for any credentials when the DB is unreachable, which is indistinguishable from a real "wrong password" response — so this process could NOT be used to observe a genuine successful login/registration, only to confirm route handlers don't crash on a real (if DB-less) HTTP round trip. Used it for exactly that: confirmed `POST /api/session` with fabricated credentials returns `401 {"error":"Auth.invalidCredentials"}` (not a 500/crash) end-to-end through the real Next.js standalone server, and `DELETE /api/session` / `POST /api/session/refresh` both respond correctly (204 / 401) without a live backend.
- **Manual smoke-tested all 8 new pages against a locally-built standalone server** (`node .next/standalone/apps/web/server.js`, since this project's `next.config` uses `output: "standalone"` and `next start` does not serve a standalone build): `/vi/{login,register,register-business,forgot-password,reset-password,account}` and `/vi/reset-password?token=<64 zeros>` all return 200 and render without a server-side exception. Confirmed via raw HTML inspection that the reset-password token renders ONLY as `<input type="hidden" name="token" value="...">` (no visible text node), and that the no-token state renders the `resetTokenInvalid` message with no token input present at all.
- **This plan's own `<verify>` automated blocks (Task 1's login-cookie assertions, Task 3's reset-password status/hidden-field assertions) require a live seeded database** to observe a genuine successful login (`admin@kidtoy.local` + the real seed password) and a genuine password-reset round trip — these are deferred to the orchestrator's VPS run, exactly as every backend-dependent plan's live verification has been since Plan 03. Everything the live checks assert was cross-checked by hand against Plan 03/04's exact response shapes and error codes (`auth.controller.ts`, `business-accounts.controller.ts`, their DTOs) and confirmed working end-to-end against the DB-less stray process where the assertion doesn't require a real account to exist (empty-body/cookie-shape/status-code checks).
- **`pnpm turbo run test` across the whole workspace still fails** — but only because of `apps/api`'s pre-existing DB-backed e2e test failures (`assertTestDatabase` refusing to run against anything but `kidtoy_test`, which isn't reachable), the exact same condition documented in every plan's summary since 01-03. `apps/web`'s own test task is green independently.

## User Setup Required

None — no new environment variables or external service configuration introduced. `apps/web/.env.local.example` (Plan 08) already documents everything this plan's route handlers/actions need (`NEXT_PUBLIC_API_URL`/`API_INTERNAL_URL`).

## Next Phase Readiness

- Plan 10 (staff-only admin UI) can build directly on `current-user.ts`'s `requireStaff(roles: StaffRole[])` contract exactly as specified in this plan's `<interfaces>` block — redirects anonymous visitors to a correct `next=`-bearing login URL and 404s an insufficient role, with the API's `RolesGuard` as the documented real enforcement point.
- `AccountNav`'s STAFF branch already links to `/[locale]/admin`, ready for Plan 10 to fill in.
- CATALOG-06's full demonstration loop (dealer registers → gets approved via Plan 04's staff endpoint → logs in through this plan's `/login` → Plan 08's catalog shows wholesale prices) is code-complete and ready for the orchestrator's live end-to-end verification.
- **Orchestrator follow-up (same pattern as Plans 03-08):** sync this code to the deploy VPS, run against the already-running live API + seeded Postgres/Redis/MinIO, and execute: (1) this plan's Task 1/Task 3 `<verify>` scripts (real login-cookie assertions, real reset-password round trip); (2) the manual checks in `<verification>` steps 4-6 — log in as `admin@kidtoy.local` and confirm `document.cookie` never contains `kt_session`/`kt_refresh`; log in as the approved dealer and confirm `/vi/catalog` shows `DEALER_A` wholesale prices with no code change; register a retail customer, register a business with a real PDF and see the pending panel, and run the full forgot/reset password cycle for `customer@kidtoy.local`. Per 01-08-SUMMARY.md's documented bug class (cross-locale slug 404s), also specifically verify the `LocaleSwitcher` behaves correctly from every new auth page (none of them carry a locale-specific slug in their URL, so the existing naive path-swap in `LocaleSwitcher.tsx` should be correct here — but confirm live, since that's exactly the kind of thing only a real browser check catches).
- No blockers for Plan 10 — every contract this plan's `<interfaces>` block promised (`REFRESH_COOKIE`, `setSession`, `clearSession`, `getCurrentUser`, `requireStaff`, the six Server Actions, the `/api/session*` route handlers) is implemented and exported exactly as specified.

## Self-Check: PASSED

All 17 created files verified present on disk; all 3 task commits (`d5ebe00`, `58de9da`, `9903fd9`) verified present in `git log`.

---
*Phase: 01-foundation-auth-bilingual-catalog-pricing*
*Completed: 2026-09-22*

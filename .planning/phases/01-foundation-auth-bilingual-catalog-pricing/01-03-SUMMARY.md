---
phase: 01-foundation-auth-bilingual-catalog-pricing
plan: 03
subsystem: auth
tags: [nestjs, passport, jwt, bcrypt, rbac, prisma, jest, supertest]

# Dependency graph
requires:
  - phase: 01-foundation-auth-bilingual-catalog-pricing
    provides: Prisma schema (Account/StaffProfile/CustomerProfile/BusinessAccount/RefreshToken), PrismaService, fail-fast env, global ValidationPipe/Swagger/Throttler, seed.ts (Plan 02)
provides:
  - One AuthModule serving staff + retail customers (business accounts land in Plan 04) against one Account table
  - POST /api/auth/register, /login, /refresh, /logout, GET /api/auth/me
  - Rotating, hashed, single-use refresh tokens (TokenService) — session survives a refresh (AUTH-01)
  - Deny-by-default staff RBAC (RolesGuard + @Roles()), proven via GET /api/admin/_probe/super-admin and /content (AUTH-04)
  - JwtAuthGuard (401 on missing/invalid token) and OptionalJwtAuthGuard (anonymous-tolerant, for later public catalog routes)
  - JwtPayload / AuthenticatedAccount / AuthTokens contracts Plans 04-08 build against
  - Isolated e2e test infra against a dedicated kidtoy_test database (createTestApp/resetAndSeed/uniqueEmail)
affects: [01-04, 01-05, 01-06, 01-07, 01-08, 01-09, 01-10, 01-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AuthService.buildPayload delegates to a standalone buildJwtPayload() util shared with TokenService — avoids circular DI between AuthService <-> TokenService while keeping one source of truth for Account -> JwtPayload"
    - "Deny-by-default RBAC: @UseGuards(JwtAuthGuard, RolesGuard) at the controller class level + explicit @Roles(...) on every route — the pattern every later admin controller (Plans 04-05, Phases 2-7) must copy"
    - "e2e tests boot the full AppModule via Test.createTestingModule + app.init() with the SAME global config as main.ts, against a dedicated kidtoy_test database that assertTestDatabase() refuses to deviate from"
    - "ts-jest + Prisma 7's ESM-style .js-suffixed relative imports require a moduleNameMapper stripping the .js suffix, and PrismaService.onModuleInit's dynamic import() of its WASM query compiler requires node --experimental-vm-modules — both now baked into apps/api's jest configs and test:e2e script"

key-files:
  created:
    - apps/api/test/auth.e2e-spec.ts
    - apps/api/test/utils/test-app.ts
    - apps/api/test/setup-env.ts
    - apps/api/.env.test.example
    - apps/api/src/common/types/jwt-payload.ts
    - apps/api/src/modules/auth/account-payload.util.ts
    - apps/api/src/modules/auth/duration.util.ts
    - apps/api/src/modules/auth/token.service.ts
    - apps/api/src/modules/auth/token.service.spec.ts
    - apps/api/src/modules/auth/auth.service.ts
    - apps/api/src/modules/auth/auth.controller.ts
    - apps/api/src/modules/auth/auth.module.ts
    - apps/api/src/modules/auth/dto/register-customer.dto.ts
    - apps/api/src/modules/auth/dto/login.dto.ts
    - apps/api/src/modules/auth/dto/refresh.dto.ts
    - apps/api/src/modules/auth/strategies/local.strategy.ts
    - apps/api/src/modules/auth/strategies/jwt.strategy.ts
    - apps/api/src/common/guards/jwt-auth.guard.ts
    - apps/api/src/common/guards/optional-jwt-auth.guard.ts
    - apps/api/src/common/guards/roles.guard.ts
    - apps/api/src/common/guards/roles.guard.spec.ts
    - apps/api/src/common/decorators/roles.decorator.ts
    - apps/api/src/common/decorators/current-user.decorator.ts
    - apps/api/src/modules/admin/admin-probe.controller.ts
  modified:
    - apps/api/test/jest-e2e.json
    - apps/api/package.json
    - apps/api/prisma/seed.ts
    - apps/api/src/app.module.ts
    - packages/shared-types/src/index.ts
    - .gitignore
  deleted:
    - apps/api/test/app.e2e-spec.ts

key-decisions:
  - "Refactored prisma/seed.ts to export seedDatabase(prisma) (CLI entrypoint now guarded by require.main === module) so test-app.ts's resetAndSeed() reuses the exact seed logic instead of duplicating seeded emails/roles/prices in test infra"
  - "AuthController's login route uses Passport's AuthGuard('local') + LocalStrategy (as the plan specifies) rather than manually calling AuthService.validateCredentials in the controller — LocalStrategy throws one generic UnauthorizedException for both 'no such email' and 'wrong password', guaranteeing byte-identical 401 bodies"
  - "buildJwtPayload extracted into modules/auth/account-payload.util.ts as a standalone function (not solely an AuthService method) so both AuthService.buildPayload and TokenService.rotateRefreshToken's fresh-Account re-read use the identical mapping without introducing circular DI between the two services"
  - "Hand-rolled a 6-line duration parser (modules/auth/duration.util.ts) instead of depending on jsonwebtoken's transitive ms package — pnpm's strict node_modules layout does not expose transitive deps to apps/api's own source"
  - "Added moduleNameMapper (strip .js suffix on relative imports) to both jest configs, and changed test:e2e to invoke node --experimental-vm-modules directly against jest's CLI entry — without both fixes, ts-jest cannot even load Prisma 7's generated client, which would have silently blocked every future Prisma-touching test suite, not just this plan's"

requirements-completed: [AUTH-01, AUTH-02, AUTH-04]

# Metrics
duration: ~25min
completed: 2026-09-22
---

# Phase 1 Plan 3: Auth — Registration, Login, Refresh Rotation & Staff RBAC Summary

**One NestJS AuthModule (Passport local + JWT strategies, bcrypt cost-12 hashing, HS256-pinned access tokens, SHA-256-hashed single-use rotating refresh tokens) serving both staff and retail customers against one Account table, plus a deny-by-default RolesGuard proven end-to-end via a dedicated RBAC probe controller — built TDD (RED unit specs before GREEN implementation for both TokenService and RolesGuard) and verified via a from-scratch e2e test harness against an isolated `kidtoy_test` database.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-22T03:01:14+07:00 (Task 1 RED commit)
- **Completed:** 2026-09-22T03:08:34+07:00 (Task 3 GREEN commit)
- **Tasks:** 3/3 (Task 1 auto; Task 2 and Task 3 both tdd="true" — RED then GREEN, separate commits each)
- **Files modified:** 30 (9 in Task 1, 4 RED + 17 GREEN in Task 2, 1 RED + 3 GREEN in Task 3)

## Accomplishments

- **AUTH-01 (staff login, session survives refresh):** `admin@kidtoy.local` logs in, receives a STAFF/SUPER_ADMIN access token plus a raw 64-hex-char refresh token whose SHA-256 hash (not the raw value) is the only thing persisted; `POST /api/auth/refresh` issues a brand-new access+refresh pair and revokes the presented token in a single `$transaction`, so replaying the original token afterward returns 401; `POST /api/auth/logout` revokes every outstanding refresh token for the account.
- **AUTH-02 (retail customer register/login):** `POST /api/auth/register` creates `Account`+`CustomerProfile` in one transaction, hashes the password at `BCRYPT_COST` (≥12), maps a Prisma `P2002` unique violation on email to 409, and rejects a <10-char password with 400 via `class-validator`. No response body — register, login, or `/me` — ever contains `passwordHash` (grep-verified against `auth.controller.ts` and the full `auth`/`admin` module tree).
- **AUTH-04 (deny-by-default staff RBAC):** `RolesGuard` returns `true` only when `user.type === 'STAFF'` and `user.role` is in the route's `@Roles(...)` allow-list; `AdminProbeController` (`GET /api/admin/_probe/super-admin`, `/content`) proves 401 (no token) vs 403 (wrong role, including a non-staff `RETAIL_CUSTOMER` token) vs 200 (correct role) across all four staff roles — this exact `@UseGuards(JwtAuthGuard, RolesGuard)` + explicit `@Roles(...)` pattern is documented as the template every later admin controller must copy.
- **No user enumeration (T-01-15):** `validateCredentials` runs `bcrypt.compare` against a constant dummy hash on the account-not-found/inactive path, and `LocalStrategy` throws one generic `UnauthorizedException` for both cases — wrong-password and unknown-email requests produce byte-identical response bodies, asserted in e2e case 9.
- **No secret literal anywhere in `apps/api/src`** (grep-verified); `JwtStrategy` pins `algorithms: ['HS256']` on verify and `TokenService` pins `algorithm: 'HS256'` on sign, defending against algorithm-confusion (T-01-16); secrets are always loaded via `ConfigService.getOrThrow`/`.get`.
- **TDD discipline enforced for both `tdd="true"` tasks:** `token.service.spec.ts` and `roles.guard.spec.ts` were committed failing (`git log` shows `test(01-03): ...` commits before their matching `feat(01-03): ...` commits), confirmed non-compiling (RED) before implementation existed, then confirmed passing (GREEN) after — 6/6 and 6/6 respectively, 19/19 across the full `apps/api` unit suite.
- **From-scratch e2e test harness** (`apps/api/test/utils/test-app.ts`) that boots the real `AppModule` with `main.ts`'s exact global config (prefix, `ValidationPipe`, BigInt shim) and refuses to run against anything but a `kidtoy_test` database — a genuinely reusable fixture for every subsequent Phase 1 e2e plan, not just this one's 14-case `auth.e2e-spec.ts`.
- **Fixed a real infra gap that would have silently blocked every future Prisma-touching Jest suite:** ts-jest could not resolve Prisma 7's `.js`-suffixed ESM-style relative imports in the generated client, and once that was fixed, `PrismaService.onModuleInit`'s dynamic `import()` of its WASM query compiler needed `--experimental-vm-modules`. Both are now fixed at the jest-config level, not worked around per-test.
- `pnpm turbo run typecheck` and `pnpm --filter api run build` both pass clean across the whole monorepo.

## Task Commits

1. **Task 1 RED — failing e2e auth spec + isolated test-DB infra** — `214b203` (test)
2. **Task 2 RED — failing TokenService spec** — `2983343` (test)
3. **Task 2 GREEN — AuthModule (registration, login, rotating refresh tokens)** — `adc13e5` (feat)
4. **Task 3 RED — failing RolesGuard spec** — `8af38bb` (test)
5. **Task 3 GREEN — deny-by-default staff RBAC + AUTH-04 probe endpoints** — `f035ea0` (feat)

**Plan metadata commit:** not created — per explicit instruction for this invocation, only this SUMMARY.md was written; STATE.md/ROADMAP.md/REQUIREMENTS.md remain the orchestrator's responsibility after all Phase 1 plans complete.

## Files Created/Modified

- `apps/api/test/auth.e2e-spec.ts` — 14 supertest cases covering AUTH-01/02/04 end to end
- `apps/api/test/utils/test-app.ts` — `createTestApp`/`resetAndSeed`/`uniqueEmail`, `assertTestDatabase()` safety rail
- `apps/api/test/setup-env.ts` — loads `apps/api/.env.test` before any test module is required
- `apps/api/.env.test.example` — committed template for the isolated `kidtoy_test` database + JWT/MinIO keys
- `apps/api/test/jest-e2e.json` / `apps/api/package.json` — `setupFiles`, `moduleNameMapper` (strip `.js`), `test:e2e` now runs `node --experimental-vm-modules` against jest's CLI entry directly
- `apps/api/prisma/seed.ts` — refactored to export `seedDatabase(prisma)`, reused by both the CLI (`tsx prisma/seed.ts`) and `resetAndSeed()`
- `apps/api/src/common/types/jwt-payload.ts` — the `JwtPayload` contract Plans 04-08 build against
- `apps/api/src/modules/auth/account-payload.util.ts` — `buildJwtPayload`, single source of truth for Account → JwtPayload
- `apps/api/src/modules/auth/duration.util.ts` — hand-rolled `"15m"`/`"30d"` parser for `refresh_tokens.expiresAt`
- `apps/api/src/modules/auth/token.service.ts` (+ `.spec.ts`) — access JWT issuance, rotating hashed refresh tokens
- `apps/api/src/modules/auth/auth.service.ts` — credential validation (timing-safe), registration, login orchestration
- `apps/api/src/modules/auth/auth.controller.ts` — `/register`, `/login` (throttled), `/refresh`, `/logout`, `/me`
- `apps/api/src/modules/auth/auth.module.ts` — wires Passport/JWT/Prisma, exports `AuthService`/`TokenService`
- `apps/api/src/modules/auth/dto/*.ts` — `RegisterCustomerDto`, `LoginDto`, `RefreshDto` (class-validator)
- `apps/api/src/modules/auth/strategies/local.strategy.ts` / `jwt.strategy.ts`
- `apps/api/src/common/guards/jwt-auth.guard.ts` / `optional-jwt-auth.guard.ts` / `roles.guard.ts` (+ `.spec.ts`)
- `apps/api/src/common/decorators/roles.decorator.ts` / `current-user.decorator.ts`
- `apps/api/src/modules/admin/admin-probe.controller.ts` — AUTH-04 proof + the RBAC pattern template
- `apps/api/src/app.module.ts` — registers `AuthModule` and `AdminProbeController`
- `packages/shared-types/src/index.ts` — `AuthenticatedAccount`, `AuthTokens`
- `.gitignore` — `!.env.test.example` negation so the template stays trackable
- deleted `apps/api/test/app.e2e-spec.ts` — stale nest-generated spec testing a `/` route removed in Plan 02

## Decisions Made

- Used `AuthGuard('local')` + `LocalStrategy` for the login route (as the plan specifies) rather than calling `AuthService.validateCredentials` directly from the controller — guarantees the exact same generic 401 message for both failure modes without any risk of the two code paths drifting apart later.
- Extracted `buildJwtPayload` into a standalone function rather than making `TokenService` depend on `AuthService` (or vice versa) for it — avoids circular DI while satisfying the plan's requirement that `AuthService.buildPayload` exists and that `TokenService.rotateRefreshToken` re-reads a fresh `Account` on every refresh.
- Hand-rolled the env-duration-string parser instead of reaching for `ms` (a transitive dependency of `jsonwebtoken`) — pnpm's strict `node_modules` layout does not expose transitive packages to application code, so importing `ms` directly would have failed at runtime; the parser is 6 lines and has one caller.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ts-jest cannot resolve Prisma 7's ESM-style `.js`-suffixed relative imports**
- **Found during:** Task 1, first attempt to run `auth.e2e-spec.ts`
- **Issue:** `prisma/generated/prisma/client.ts` imports its own internals as `'./internal/class.js'` etc. (correct for `tsc`'s `nodenext` resolution during a real build), but Jest's CommonJS module resolver cannot map that back to `class.ts` — the exact same class of issue Plan 02 hit with `ts-node` vs. the Prisma 7 client, now surfacing in Jest.
- **Fix:** Added `"moduleNameMapper": { "^(\\.{1,2}/.*)\\.js$": "$1" }` to both `apps/api/test/jest-e2e.json` and the unit-test jest config in `apps/api/package.json`.
- **Files modified:** `apps/api/test/jest-e2e.json`, `apps/api/package.json`
- **Verification:** the same module now resolves; the next failure surfaced was a genuinely different (also blocking) issue, confirmed below
- **Committed in:** `214b203`

**2. [Rule 3 - Blocking] Prisma 7's dynamic `import()` of its WASM query compiler requires `--experimental-vm-modules` under Jest**
- **Found during:** Task 1, second attempt to run `auth.e2e-spec.ts` (after fix #1)
- **Issue:** `PrismaService.onModuleInit()` → `$connect()` triggers `WasmQueryCompilerLoader`, which does `await import("@prisma/client/runtime/query_compiler_fast_bg.postgresql.js")`. Jest's default CommonJS VM context throws `TypeError: A dynamic import callback was invoked without --experimental-vm-modules` for this, regardless of whether a live database is reachable.
- **Fix:** Changed `apps/api/package.json`'s `test:e2e` script from `jest --config ...` to `node --experimental-vm-modules node_modules/jest/bin/jest.js --config ...` (invoking jest's CLI entry directly via `node` so the flag is honored, rather than relying on a shell-specific `NODE_OPTIONS=...` prefix that would not be portable to this Windows dev environment without adding a `cross-env` dependency).
- **Files modified:** `apps/api/package.json`
- **Verification:** the WASM-import `TypeError` disappeared; `PrismaService.onModuleInit()` now proceeds (and, per the current stack trace, resolves without error) before the next real limitation (MinIO connectivity, see Issues Encountered) is hit.
- **Committed in:** `214b203`

**3. [Rule 1 - Bug] Stale nest-generated `app.e2e-spec.ts` tests a route Plan 02 already removed**
- **Found during:** Task 1, reviewing what `jest --config test/jest-e2e.json` would pick up
- **Issue:** The default Nest CLI scaffold's `test/app.e2e-spec.ts` asserts `GET /` returns `'Hello World!'` from `AppController`, which Plan 02 deleted (`AppModule` no longer wires an `AppController`) — this spec would always fail, for reasons unrelated to any Phase 1 requirement, and would pollute `test:e2e`'s full-suite output.
- **Fix:** Deleted `apps/api/test/app.e2e-spec.ts`.
- **Files modified:** deleted `apps/api/test/app.e2e-spec.ts`
- **Verification:** `test:e2e -- auth.e2e-spec.ts`'s positional filename filter already isolated `auth.e2e-spec.ts` regardless, but deleting the stale file keeps a bare `test:e2e` (no filter) meaningful for future plans.
- **Committed in:** `214b203`

**4. [Rule 3 - Blocking] `resetAndSeed()` needs reusable seed logic, but `prisma/seed.ts` only exposed a self-executing script**
- **Found during:** Task 1, designing `test-app.ts`'s `resetAndSeed(prisma)`
- **Issue:** The plan's file list for Task 1 does not include `prisma/seed.ts`, but `resetAndSeed` cannot re-implement the seeded accounts/roles/prices without duplicating (and risking drift from) the canonical seed in `prisma/seed.ts`.
- **Fix:** Refactored `prisma/seed.ts` to export `seedDatabase(prisma: PrismaClient): Promise<void>` containing all the seed logic; the CLI-only concerns (constructing its own `PrismaClient`+adapter, reading `DATABASE_URL`, disconnecting, `process.exit(1)` on error) now live behind `if (require.main === module)`, so importing `seedDatabase` from `test-app.ts` does not trigger the CLI path.
- **Files modified:** `apps/api/prisma/seed.ts`
- **Verification:** `pnpm --filter api run typecheck` and `pnpm --filter api run build` both pass; `require.main === module` is safe here since neither `package.json` declares `"type": "module"` (both ts-jest and `tsx` treat this file as CommonJS)
- **Committed in:** `214b203`

---

**Total deviations:** 4 auto-fixed (3 blocking/infra, 1 bug/cleanup). None required an architectural decision or user input — all were necessary to get the plan's own required test infrastructure actually running on this machine, and all are permanent fixes (not workarounds scoped to this plan) that every later Phase 1 plan's e2e/unit tests benefit from.

## Issues Encountered

**No live PostgreSQL or MinIO available on this dev machine (Docker not installed)** — identical constraint to Plans 01 and 02. After fixing the two Jest/Prisma infra issues above (deviations #1-2), `auth.e2e-spec.ts` now fails at a *different, later* point than before: `PrismaService.onModuleInit()` completes without error (Prisma 7's client + driver adapter appear to defer the actual live-connection check past `$connect()` itself), and the app then fails inside `StorageService.onModuleInit()` → `ensureBucket()` → `HeadBucketCommand` with `ECONNREFUSED` against MinIO `:9000`. This means:

- All 14 e2e cases in `auth.e2e-spec.ts` still fail (exit 1) — RED is real, and after full implementation the failure is now **purely an infra-reachability failure, not a code defect**: the same failure occurs identically before Task 2/3 implementation existed and after it's complete, confirming the auth/RBAC code itself is not the blocker.
- Unit tests (`token.service.spec.ts`, `roles.guard.spec.ts`, and the pre-existing `storage.service.spec.ts`) all mock their dependencies and do not touch a live database — these are fully green (19/19) and are the actual behavioral proof available on this machine.
- `pnpm turbo run typecheck` and `pnpm --filter api run build` both pass clean, confirming every file in this plan compiles and the Nest DI graph resolves correctly (no missing providers, no circular dependencies).
- All static/grep-based acceptance criteria from the plan passed: `randomBytes(32)`/`createHash('sha256')` present in `token.service.ts` with no `Math.random`; `BCRYPT_COST` referenced in `auth.service.ts`; `algorithms: ['HS256']` + `getOrThrow` in `jwt.strategy.ts`; no secret literal anywhere in `apps/api/src`; `OptionalJwtAuthGuard.handleRequest` overridden; no `passwordHash` in `auth.controller.ts`; `RolesGuard` contains `getAllAndOverride` + `user?.type === 'STAFF'`; `@Roles(`/`@Get(` counts match (2/2) in `admin-probe.controller.ts`.

**Manual step required before this plan's e2e assertions (cases 1-13 from the plan's numbered list) can be closed out:** identical to Plans 01/02 — install Docker (or use the target VPS, per this plan's `<additional_context>`), bring up `postgres`/`redis`/`minio`, create the `kidtoy_test` database, run `pnpm --filter api exec prisma migrate deploy` against it, copy `apps/api/.env.test.example` to `apps/api/.env.test` with real values (`DATABASE_URL` ending in `kidtoy_test`), then:
```
pnpm --filter api run test:e2e -- auth.e2e-spec.ts
```
and confirm all 14 cases pass. Per the orchestrator's stated intent, this verification will be run on the VPS after this plan completes; if anything fails there, it should be a genuine bug to fix forward, not an infra gap — every infra-level blocker discovered on this machine (Jest/Prisma module resolution, dynamic import, StorageService reachability) has already been fixed or is a known, expected symptom of the missing local Docker stack.

## Known Stubs

None. Every route (`/register`, `/login`, `/refresh`, `/logout`, `/me`, both RBAC probes) is fully implemented against real Prisma queries — no hardcoded/mocked response data, no "coming soon" placeholders. `AdminProbeController` itself is intentionally a proof-of-pattern endpoint (documented as such in its own file header), not a stub — its trivial `{ ok: true, scope: '...' }` response bodies are the entire point (proving the guard chain, not real business data).

## Threat Flags

None beyond what this plan's own `<threat_model>` already covers (T-01-14 through T-01-22) — every new endpoint (`/api/auth/*`, `/api/admin/_probe/*`) and trust boundary (anonymous → auth, bearer token → `request.user`, API process → `accounts`/`refresh_tokens`) was already registered and mitigated per the plan.

## User Setup Required

**Docker Engine + Compose plugin (or the target VPS) must be available before `auth.e2e-spec.ts`'s 14 live cases can run.** See "Issues Encountered" above for the exact steps once available. No other external service configuration is required — `apps/api/.env.test.example` documents every key `test:e2e` needs, and `SEED_DEFAULT_PASSWORD` is the only credential `resetAndSeed()` requires beyond the database connection itself.

## Next Phase Readiness

- One `AuthModule` over one `Account` table now serves staff and retail customers; Plan 04 (B2B registration) extends the same module with `BusinessAccount` registration and a staff-only approval endpoint, reusing `TokenService`/`buildJwtPayload`/`RolesGuard` unchanged.
- `JwtAuthGuard`, `OptionalJwtAuthGuard`, `RolesGuard`, `@Roles()`, `@CurrentUser()`, and the `JwtPayload`/`AuthenticatedAccount`/`AuthTokens` contracts are all in place exactly as this plan's `<interfaces>` block specifies — every later Phase 1 plan (catalog, pricing, admin routes) can build directly on them without guessing at shapes.
- The e2e test harness (`createTestApp`/`resetAndSeed`/`uniqueEmail`, plus the now-fixed Jest/Prisma module-resolution and `--experimental-vm-modules` configuration) is reusable infrastructure — later Phase 1 plans' e2e specs do not need to rediscover either fix.
- **Blocker carried forward (same as Plans 01/02):** Docker (or VPS access) must be available before this plan's 14 e2e cases, and any later plan's e2e cases, can be executed end-to-end. No plan work is blocked — only live-infra verification is deferred.

---
*Phase: 01-foundation-auth-bilingual-catalog-pricing*
*Completed: 2026-09-22*

## Self-Check: PASSED

All 23 claimed created files verified present on disk; deletion of `apps/api/test/app.e2e-spec.ts` confirmed; all 5 task commits (`214b203`, `2983343`, `adc13e5`, `8af38bb`, `f035ea0`) verified present in `git log`.

---
phase: 01-foundation-auth-bilingual-catalog-pricing
plan: 04
subsystem: auth
tags: [nestjs, prisma, multer, file-type, s3, minio, jwt, jest, supertest]

# Dependency graph
requires:
  - phase: 01-foundation-auth-bilingual-catalog-pricing
    provides: AuthModule (Account/StaffProfile/CustomerProfile/BusinessAccount, JwtAuthGuard, RolesGuard, TokenService, buildJwtPayload), StorageService (putObject/getPresignedUrl/buildKey), e2e test harness (Plan 03)
provides:
  - "B2B registration (POST /api/business-accounts/register) with Vietnamese tax ID validation, business-type enum, and a licence file upload validated by DETECTED mimetype (magic-number sniffing, not client-claimed Content-Type)"
  - "Authenticated, IDOR-safe licence retrieval (GET /api/business-accounts/:id/licence) — owner-or-(SUPER_ADMIN|SALES) only, 5-minute presigned URL, raw object key never leaves the server"
  - "Minimal staff approval transition (PATCH /api/admin/business-accounts/:id/approval, GET /api/admin/business-accounts) — the data CATALOG-06's PriceResolutionService depends on, revokes all sessions on transition"
  - "Password reset (POST /api/auth/forgot-password, POST /api/auth/reset-password) — single-use, SHA-256-hashed, 60-minute TTL, non-enumerating, revokes all sessions on success"
  - "MailerService/NotificationsModule — Phase 1 mail transport seam (structured-log delivery), stable interface for a real SMTP transport later"
  - "BusinessType/BusinessApprovalStatus/BusinessAccountSummary added to @kid-toy/shared-types"
affects: [01-05, 01-06, 01-07, 01-08, 01-09, 01-10, 01-11, phase-04-b2b]

# Tech tracking
tech-stack:
  added:
    - "file-type@21.3.4 — explicit direct dependency of apps/api, required for NestJS's FileTypeValidator to perform real magic-number detection under pnpm's strict node_modules layout (it is not a resolvable transitive dependency otherwise)"
    - "@types/multer@^2.2.0 — Express.Multer.File typings for @UploadedFile()"
  patterns:
    - "buildFileValidationPipe(maxBytes, mimeTypes) in common/pipes/uploaded-document.validator.ts — reusable ParseFilePipe builder validating the DETECTED mimetype via real magic-number sniffing, not the client-supplied Content-Type or filename extension. Every future upload endpoint (product media in a later plan) should reuse this, not hand-roll validation."
    - "P2002 disambiguation via err.meta.modelName, NOT err.meta.target — Prisma 7's @prisma/adapter-pg driver-based client populates meta.modelName (the Prisma model whose table the violated unique constraint belongs to), not the target column array that older query-engine-based Prisma versions returned. Verified by reading node_modules/@prisma/adapter-pg's 23505 mapping and the generated client's resolveErrorMeta — no live DB available to confirm empirically. Every future P2002-handling service in this codebase must use this pattern, not copy the old target-array idiom from training data."
    - "Upload-before-transaction with best-effort cleanup: StorageService.putObject happens BEFORE the DB $transaction opens (so a storage failure never half-writes a row), and a transaction failure triggers a best-effort StorageService.deleteObject (never allowed to mask the original error) — the pattern for any future endpoint that persists both a file and a DB row atomically."
    - "Service-level enforcement of cross-field DTO rules (updateApproval rejects APPROVED-without-tier, APPROVED-onto-default-tier, REJECTED-without-reason, and any transition to PENDING at the service layer, not only via class-validator) — holds for any future caller, not just the HTTP layer."

key-files:
  created:
    - apps/api/src/modules/business-accounts/business-accounts.module.ts
    - apps/api/src/modules/business-accounts/business-accounts.controller.ts
    - apps/api/src/modules/business-accounts/business-accounts.admin.controller.ts
    - apps/api/src/modules/business-accounts/business-accounts.service.ts
    - apps/api/src/modules/business-accounts/business-accounts.service.spec.ts
    - apps/api/src/modules/business-accounts/dto/register-business.dto.ts
    - apps/api/src/modules/business-accounts/dto/update-approval.dto.ts
    - apps/api/src/modules/business-accounts/dto/list-business-accounts.query.ts
    - apps/api/src/common/pipes/uploaded-document.validator.ts
    - apps/api/test/business-account.e2e-spec.ts
    - apps/api/src/modules/auth/password-reset.service.ts
    - apps/api/src/modules/auth/password-reset.service.spec.ts
    - apps/api/src/modules/auth/dto/forgot-password.dto.ts
    - apps/api/src/modules/auth/dto/reset-password.dto.ts
    - apps/api/src/modules/notifications/mailer.service.ts
    - apps/api/src/modules/notifications/notifications.module.ts
    - apps/api/test/password-reset.e2e-spec.ts
  modified:
    - apps/api/src/modules/auth/auth.controller.ts
    - apps/api/src/modules/auth/auth.module.ts
    - apps/api/src/modules/storage/storage.service.ts
    - apps/api/src/app.module.ts
    - apps/api/src/config/env.schema.ts
    - apps/api/package.json
    - apps/api/.env.test.example
    - packages/shared-types/src/index.ts
    - .env.example
    - pnpm-lock.yaml

key-decisions:
  - "Tasks 1 and 2 (registration/licence retrieval, staff approval) share one business-accounts.service.ts and one pair of spec files (business-accounts.service.spec.ts, business-account.e2e-spec.ts), exactly as the plan's own file list specifies. Because ts-jest type-checks the whole spec file, updateApproval() had to exist before ANY part of the file would compile — a true two-commit RED/GREEN split per task was not achievable without leaving an intermediate commit non-compiling. Landed as one RED commit (both tasks' failing tests) followed by one GREEN commit (both tasks' implementation). TDD gate compliance holds at the file-pair level: a test(...) commit precedes the feat(...) commit."
  - "P2002 conflict disambiguation keys off err.meta.modelName, not err.meta.target — discovered by reading node_modules/@prisma/adapter-pg's actual 23505-to-UniqueConstraintViolation mapping and the generated Prisma 7 client's resolveErrorMeta, since no live database was available on this machine to observe the real error shape empirically. This is a genuine Prisma-7-specific behavior difference from the target-array pattern used in most training-data examples (and in older Prisma major versions) — flagged explicitly in the unit spec's comments so a future reader doesn't 'fix' it back to the wrong pattern."
  - "Added file-type@21.3.4 as an explicit direct dependency of apps/api — NestJS's built-in FileTypeValidator dynamically imports the file-type package for magic-number detection, but it is only a transitive dependency somewhere else in the workspace; pnpm's strict node_modules layout does not expose it to apps/api's own code (same class of issue as the ms package in 01-03), and without it every upload would silently fail validation."
  - "GET /api/admin/business-accounts orders by id desc, not createdAt desc — the plan's action text asked for createdAt ordering, but BusinessAccount has no createdAt column in the Plan 02 schema. Adding one would require a schema migration this dev environment (no live Postgres) cannot generate/verify via `prisma migrate dev`, and ordering is not asserted by any behavior bullet or acceptance criterion. cuid() ids are chronologically monotonic-ish, so id desc is a documented, low-risk approximation rather than an unverified schema change — flagged in a code comment for a future plan with live-DB access to revisit if strict chronological ordering becomes a real requirement."
  - "register-business.dto.ts uses an array-literal IsEnum (['RETAIL_STORE','SCHOOL','DISTRIBUTOR'] as const) rather than a TS enum, matching register-customer.dto.ts's existing style and avoiding an enum-vs-string-union type mismatch against the shared-types BusinessType string union."

requirements-completed: [AUTH-03, AUTH-05]

# Metrics
duration: ~25min
completed: 2026-09-22
---

# Phase 1 Plan 4: B2B Registration, Licence Retrieval, Staff Approval & Password Reset Summary

**B2B registration with a magic-number-validated licence upload and IDOR-safe presigned retrieval, a minimal staff approval transition onto a non-default price tier (the data CATALOG-06's PriceResolutionService depends on), and single-use SHA-256-hashed password reset tokens delivered via a Phase-1 structured-log mail seam — all built TDD (RED before GREEN, confirmed by "Cannot find module" failures) against NestJS 11 + Prisma 7 + MinIO.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-22T03:29:54+07:00 (Task 1/2 RED commit)
- **Completed:** 2026-09-22T03:38:45+07:00 (Task 3 GREEN commit)
- **Tasks:** 3/3 (Task 1 and Task 2 landed as one RED + one GREEN commit pair, see Key Decisions; Task 3 its own RED + GREEN pair)
- **Files modified:** 27 (17 created, 10 modified)

## Accomplishments

- **AUTH-03 (B2B registration + licence security):** `POST /api/business-accounts/register` accepts company name, a Vietnamese tax ID (`@Matches(/^\d{10}(-\d{3})?$/)`), a `businessType` enum, and a multipart licence file; the licence is uploaded to the PRIVATE `kidtoy-documents` bucket under a server-generated `business-licences/<uuid>.<ext>` key BEFORE any database row is written (upload-then-transaction, with best-effort cleanup on transaction failure), and `approvalStatus`/`priceTierId` are hardcoded to `PENDING`/`null` server-side — never accepted from the request body (T-01-26). The raw `businessLicenseKey` is never serialized to any client (`toSummary` only ever exposes a `hasLicence` boolean).
- **Real magic-number file validation, not trust-the-client:** `buildFileValidationPipe` uses NestJS's `FileTypeValidator` (backed by the `file-type` package, added as an explicit direct apps/api dependency since pnpm's strict layout doesn't expose it transitively) to sniff the actual uploaded bytes — a `.pdf`-named file whose real content isn't a PDF is rejected with 400 regardless of what Content-Type the client claims (T-01-25).
- **IDOR-safe licence retrieval:** `GET /api/business-accounts/:id/licence` compares the verified JWT's `sub` against the `accountId` loaded from the database row (never a client-supplied parameter) to decide ownership; SUPER_ADMIN and SALES staff are also allowed; everyone else gets 403, no token gets 401. Returns a 300-second presigned URL — the object itself is never reachable via a public/static path (T-01-24, T-01-01... consistent with 01-03's `algorithms: ['HS256']` pinning pattern for defence-in-depth).
- **Minimal staff approval transition (Task 2, scoped explicitly to make CATALOG-06 demonstrable, NOT Phase 4's full B2B-02/B2B-03 workflow):** `PATCH /api/admin/business-accounts/:id/approval` (SUPER_ADMIN or SALES only) enforces, at the SERVICE level (not only the DTO): a tier is required and must exist and must not be the default RETAIL tier when approving; a non-empty reason is required when rejecting; a transition back to PENDING is always rejected. Every transition calls `TokenService.revokeAllForAccount`, so a dealer's stale pricing context in an already-issued token cannot survive an approval change (T-01-28) — the very next login carries the new `approvalStatus`/`priceTierId`.
- **AUTH-05 (password reset):** `POST /api/auth/forgot-password` always returns 202 with an identical body whether or not the email exists (T-01-30); a second request supersedes the first by marking outstanding unused/unexpired tokens as used before minting a new one. `POST /api/auth/reset-password` hashes the incoming raw token and raises the SAME `BadRequestException('INVALID_OR_EXPIRED_TOKEN')` for unknown, used, and expired tokens (T-01-29); a successful reset updates the password hash and calls `TokenService.revokeAllForAccount`, so a refresh token minted before the reset is dead afterward.
- **A genuine Prisma-7 behavioral discovery, not assumed from training data:** disambiguating a P2002 unique-constraint conflict between `Account.email` and `BusinessAccount.taxId` cannot use the classic `err.meta.target` array — Prisma 7's `@prisma/adapter-pg` driver-based client populates `err.meta.modelName` instead (confirmed by reading the adapter's actual 23505-to-`UniqueConstraintViolation` mapping and the generated client's `resolveErrorMeta`, since no live database was available on this machine to observe the real error shape). Implemented and unit-tested against that actual shape, with the reasoning documented inline so it isn't silently "corrected" back to the wrong pattern later.
- **TDD discipline enforced:** `business-accounts.service.spec.ts`/`business-account.e2e-spec.ts` and `password-reset.service.spec.ts`/`password-reset.e2e-spec.ts` were each committed failing first (`git log` shows `test(01-04): ...` commits with "Cannot find module" failures before their matching `feat(01-04): ...` commits) — 20/20 and 10/10 new unit tests pass respectively, 49/49 across the full `apps/api` unit suite.
- `pnpm turbo run typecheck` and `pnpm --filter api run build` both pass clean across the whole monorepo; running the full e2e suite confirms every module wires correctly via dependency injection (no "Nest can't resolve dependencies" errors anywhere) — all three spec files fail identically at `StorageService.onModuleInit()` → MinIO unreachable, the same documented infra gap as 01-03, not a code defect.

## Task Commits

1. **Task 1+2 RED — failing specs for B2B registration, licence retrieval and staff approval** — `9e646d1` (test)
2. **Task 1+2 GREEN — B2B registration, licence retrieval and staff approval** — `832534b` (feat)
3. **Task 3 RED — failing specs for password reset** — `9f2490a` (test)
4. **Task 3 GREEN — password reset via single-use, TTL-bounded emailed link** — `50f65a2` (feat)

**Plan metadata commit:** not created yet — per this invocation's explicit instruction, only this SUMMARY.md is committed here; STATE.md/ROADMAP.md/REQUIREMENTS.md remain the orchestrator's responsibility after all Phase 1 plans complete.

## Files Created/Modified

- `apps/api/src/modules/business-accounts/business-accounts.service.ts` — register, getLicenceUrl, updateApproval, list, toSummary
- `apps/api/src/modules/business-accounts/business-accounts.controller.ts` — public `POST register`, `GET :id/licence`
- `apps/api/src/modules/business-accounts/business-accounts.admin.controller.ts` — RBAC-gated `GET /`, `PATCH :id/approval`
- `apps/api/src/modules/business-accounts/business-accounts.module.ts` — wires PrismaModule/StorageModule/AuthModule
- `apps/api/src/modules/business-accounts/dto/*.ts` — `RegisterBusinessDto`, `UpdateApprovalDto`, `ListBusinessAccountsQuery`
- `apps/api/src/common/pipes/uploaded-document.validator.ts` — `buildFileValidationPipe` (reusable, magic-number-based)
- `apps/api/test/business-account.e2e-spec.ts` — 32 supertest cases covering AUTH-03 + the approval transition end to end
- `apps/api/src/modules/business-accounts/business-accounts.service.spec.ts` — 20 unit cases (P2002 mapping, 6-way authorization matrix, cross-field approval validation)
- `apps/api/src/modules/auth/password-reset.service.ts` (+ `.spec.ts`) — request/reset, 10 unit cases
- `apps/api/src/modules/auth/dto/forgot-password.dto.ts` / `reset-password.dto.ts`
- `apps/api/src/modules/auth/auth.controller.ts` — added `forgot-password` (202), `reset-password` (204)
- `apps/api/src/modules/auth/auth.module.ts` — imports NotificationsModule, provides PasswordResetService
- `apps/api/src/modules/notifications/mailer.service.ts` (+ `notifications.module.ts`) — Phase 1 log-based mail seam
- `apps/api/test/password-reset.e2e-spec.ts` — 9 supertest cases covering AUTH-05 end to end
- `apps/api/src/modules/storage/storage.service.ts` — added `deleteObject` (best-effort cleanup)
- `apps/api/src/app.module.ts` — registers `BusinessAccountsModule`
- `apps/api/src/config/env.schema.ts` — `UPLOAD_MAX_DOCUMENT_BYTES`, `UPLOAD_MAX_IMAGE_BYTES`
- `apps/api/package.json` — added `file-type`, `@types/multer`
- `apps/api/.env.test.example` — `BUSINESS_REGISTER_THROTTLE_LIMIT` (e2e throttle override)
- `packages/shared-types/src/index.ts` — `BusinessType`, `BusinessApprovalStatus`, `BusinessAccountSummary`
- `.env.example` — `UPLOAD_MAX_DOCUMENT_BYTES`, `UPLOAD_MAX_IMAGE_BYTES`

## Decisions Made

See `key-decisions` in the frontmatter for full rationale on: (1) Tasks 1-2 sharing one RED/GREEN commit pair due to ts-jest's whole-file type-checking against a single spec file covering both tasks; (2) P2002 disambiguation via `err.meta.modelName` (a genuine Prisma 7 behavior difference from the classic `target` array, discovered by reading adapter source since no live DB was available); (3) adding `file-type` as an explicit dependency; (4) `GET /api/admin/business-accounts` ordering by `id desc` rather than a `createdAt` column that doesn't exist in the Plan 02 schema; (5) the array-literal `IsEnum` style for `businessType`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `file-type` is not resolvable from apps/api under pnpm's strict layout**
- **Found during:** Task 1, designing `buildFileValidationPipe`
- **Issue:** NestJS's `FileTypeValidator` dynamically `require.resolve`s/imports the `file-type` package to perform magic-number detection. It exists in the pnpm store (as some other package's transitive dependency) but is not linked into `apps/api/node_modules` — without it, `FileTypeValidator` catches the resolution failure and (with `fallbackToMimetype` unset) rejects EVERY upload, regardless of validity.
- **Fix:** Added `"file-type": "21.3.4"` as an explicit direct dependency of `apps/api/package.json` and ran `pnpm install`.
- **Files modified:** `apps/api/package.json`, `pnpm-lock.yaml`
- **Verification:** `node -e "console.log(require.resolve('file-type'))"` run from `apps/api` resolves correctly; unit/typecheck/build all pass.
- **Committed in:** `832534b`

**2. [Rule 1 - Bug] `err.meta.target` does not exist on Prisma 7's P2002 errors under `@prisma/adapter-pg`**
- **Found during:** Task 1, implementing `register()`'s conflict-mapping logic
- **Issue:** The plan's interface contract implies mapping a P2002 to `EMAIL_TAKEN`/`TAX_ID_TAKEN`, and the conventional Prisma pattern (and most training-data examples) reads `err.meta.target` as a column-name array. Reading `node_modules/@prisma/adapter-pg`'s actual 23505-to-`UniqueConstraintViolation` mapping and the generated Prisma 7 client's `resolveErrorMeta` showed this driver-adapter-based client instead populates `err.meta.modelName` (mapped from the physical table name) — `target` is never set. Using the `target` pattern would have silently fallen through to the generic `DUPLICATE_VALUE` branch for every conflict in production.
- **Fix:** Implemented and unit-tested disambiguation against `err.meta.modelName === 'Account' | 'BusinessAccount'` instead, with the reasoning documented inline in both `business-accounts.service.ts` and the unit spec's `makeP2002` helper.
- **Files modified:** `apps/api/src/modules/business-accounts/business-accounts.service.ts`, `apps/api/src/modules/business-accounts/business-accounts.service.spec.ts`
- **Verification:** Unit tests assert `EMAIL_TAKEN` for a `modelName: 'Account'` error and `TAX_ID_TAKEN` for `modelName: 'BusinessAccount'`; both pass.
- **Committed in:** `832534b`

**3. [Rule 3 - Blocking] `@types/multer` not installed; `Express.Multer.File` unresolved**
- **Found during:** Task 1, typing the `register()` controller method and service signature
- **Issue:** `@nestjs/platform-express`'s `FileInterceptor` and `@UploadedFile()` rely on the ambient `Express.Multer.File` type, which is only declared by `@types/multer` — not installed in this repo.
- **Fix:** Added `"@types/multer": "^2.2.0"` to `apps/api/package.json` devDependencies (plan explicitly calls this out: "Install `@types/multer` if absent").
- **Files modified:** `apps/api/package.json`, `pnpm-lock.yaml`
- **Verification:** `tsc --noEmit` clean; `find apps/api/node_modules/@types/multer` resolves.
- **Committed in:** `832534b`

**4. [Rule 2 - Missing Critical] `StorageService` had no way to clean up an orphaned upload**
- **Found during:** Task 1, implementing the upload-then-transaction pattern the plan's `<action>` text specifies
- **Issue:** `StorageService`'s documented `<interfaces>` (putObject/getPresignedUrl/buildKey/buckets) has no delete capability, but the plan explicitly requires "on a transaction failure, best-effort delete the uploaded object" — without it, every P2002 conflict during registration would leave a permanently orphaned object in the private documents bucket.
- **Fix:** Added `StorageService.deleteObject(bucket, key)` using `DeleteObjectCommand`, called from `register()`'s catch block with `.catch(() => undefined)` so a cleanup failure never masks the original error.
- **Files modified:** `apps/api/src/modules/storage/storage.service.ts`
- **Verification:** Unit test asserts `deleteObject` is called with the correct bucket/key when the transaction throws.
- **Committed in:** `832534b`

**5. [Rule 1 - Bug, minor] `GET /api/admin/business-accounts` cannot order by `createdAt` — column doesn't exist**
- **Found during:** Task 2, implementing `list()`
- **Issue:** The plan's `<action>` text specifies ordering by `createdAt` descending, but `BusinessAccount` (as defined in Plan 02's schema.prisma) has no `createdAt` column — only `Account` does.
- **Fix:** Ordered by `id desc` instead (cuid ids are chronologically monotonic-ish), with an inline comment explaining the gap and flagging it for a future plan with live-DB access to add a real migration if strict ordering becomes a hard requirement. Not adding a speculative, unverifiable schema migration on a machine with no live Postgres to test `prisma migrate dev` against.
- **Files modified:** `apps/api/src/modules/business-accounts/business-accounts.service.ts`
- **Verification:** No behavior bullet or acceptance criterion in the plan asserts a specific list order; `list()` compiles and its filter/pagination logic is otherwise implemented exactly as specified.
- **Committed in:** `832534b`

---

**Total deviations:** 5 auto-fixed (3 blocking/infra, 1 bug/correctness with real production impact, 1 minor bug/schema-gap workaround). None required an architectural decision or user input — deviation #2 in particular was a genuine correctness fix that empirical testing on this machine could not have caught (no live database), only careful reading of the actual Prisma 7 driver-adapter source.

## Issues Encountered

**No live PostgreSQL, Redis, or MinIO available on this dev machine (Docker not installed)** — identical constraint to Plans 01-03. All three e2e spec files (`business-account.e2e-spec.ts`, `password-reset.e2e-spec.ts`, and the pre-existing `auth.e2e-spec.ts`) fail at the same point: `StorageService.onModuleInit()` → `ensureBucket()` → `HeadBucketCommand` against MinIO `:9000` throws inside an `AggregateError`. This means:

- The 32 + 9 = 41 new e2e cases across both new spec files cannot be observed passing on this machine — this is a pure infra-reachability gap, not a code defect, confirmed by:
  - Running the full e2e suite together produces NO "Nest can't resolve dependencies" or similar DI-wiring errors anywhere — every new controller/service/module compiles and wires correctly.
  - Unit tests (which mock Prisma/StorageService/MailerService/TokenService entirely) are 49/49 green and are the actual behavioral proof available on this machine: the full authorization matrix for `getLicenceUrl` (6 combinations), every cross-field validation branch for `updateApproval`, the P2002 disambiguation, and every branch of `PasswordResetService.request`/`reset` (including the byte-identical-error-for-unknown/used/expired assertion).
  - `pnpm turbo run typecheck` and `pnpm --filter api run build` both pass clean, confirming every file in this plan compiles and the Nest DI graph resolves correctly.
  - All static/grep-based acceptance criteria from the plan pass: `register-business.dto.ts` contains `@IsEnum(` and `@Matches(` and declares no `approvalStatus`/`priceTierId` property; `business-accounts.controller.ts` never references `businessLicenseKey`; `business-accounts.service.ts` contains `ForbiddenException` and compares `viewer.sub` against the loaded row; `business-accounts.admin.controller.ts` contains `@UseGuards(JwtAuthGuard, RolesGuard)` with `@Roles(` count (2) matching route-decorator count (`@Get(` + `@Patch(` = 2); `password-reset.service.ts` contains `randomBytes(32)` and `createHash('sha256')` with zero `Math.random` occurrences; `.env.example` carries `UPLOAD_MAX_DOCUMENT_BYTES=`, `PASSWORD_RESET_TTL_MINUTES=60`, and `APP_BASE_URL=`; `auth.controller.ts` applies `@Throttle(` to both `forgot-password` and `reset-password`.

**Manual step required before this plan's e2e assertions can be closed out:** identical to Plans 01-03 — install Docker (or use the target VPS), bring up `postgres`/`redis`/`minio`, create/migrate the `kidtoy_test` database, copy `.env.test.example` to `.env.test`, then run:
```
pnpm --filter api run test:e2e -- business-account.e2e-spec.ts
pnpm --filter api run test:e2e -- password-reset.e2e-spec.ts
```
Per the orchestrator's stated intent, this verification will be run on the VPS after this plan completes; if anything fails there, it should be a genuine bug to fix forward (e.g., the `file-type` magic-number detection behavior against real generated PDF/PNG buffers, or the direct-unsigned-MinIO-fetch-returns-403 assertion, cannot be behaviorally proven without a live MinIO instance), not an infra gap — every infra-level blocker discoverable on this machine (module resolution, DI wiring, compile/build) has already been fixed.

## Known Stubs

None. Every route (`register`, `:id/licence`, admin `list`/`updateApproval`, `forgot-password`, `reset-password`) is fully implemented against real Prisma queries and real StorageService/MailerService calls — no hardcoded/mocked response data, no "coming soon" placeholders. `MailerService` is intentionally a documented Phase 1 seam (structured-log delivery, not a stub) — its class-level comment states this explicitly and its method signature is the stable contract a later phase's real SMTP transport will implement against.

## Threat Flags

None beyond what this plan's own `<threat_model>` already covers (T-01-23 through T-01-32) — every new endpoint (`/api/business-accounts/*`, `/api/admin/business-accounts/*`, `/api/auth/forgot-password`, `/api/auth/reset-password`) and trust boundary (anonymous → registration, anonymous → forgot-password, bearer token → licence/approval mutation, API → MinIO documents bucket) was already registered and mitigated per the plan.

## User Setup Required

**Docker Engine + Compose plugin (or the target VPS) must be available before `business-account.e2e-spec.ts`'s 32 cases and `password-reset.e2e-spec.ts`'s 9 cases can run.** See "Issues Encountered" above for the exact steps once available. No other external service configuration is required — `.env.test.example` and `.env.example` document every new key (`UPLOAD_MAX_DOCUMENT_BYTES`, `UPLOAD_MAX_IMAGE_BYTES`, `BUSINESS_REGISTER_THROTTLE_LIMIT`) this plan introduces.

## Next Phase Readiness

- AUTH-03 and AUTH-05 are both complete: the full identity story (staff, retail, B2B) plus password recovery is now in place, all reusing `TokenService`/`buildJwtPayload`/`RolesGuard`/`JwtAuthGuard` unchanged from Plan 03.
- `BusinessAccount.approvalStatus === 'APPROVED' && priceTierId` is now reachable through a real endpoint (not only the seed) — Plan 06 (CATALOG-06, viewer-aware pricing) can build `PriceResolutionService` against live data produced by this plan's approval flow.
- `BusinessAccountSummary`/`BusinessType`/`BusinessApprovalStatus` are in `@kid-toy/shared-types` exactly as this plan's `<interfaces>` block specifies — any later B2B-facing frontend work (Phase 4) can consume these shapes directly.
- `buildFileValidationPipe` and the upload-before-transaction-with-cleanup pattern are reusable infrastructure — the next plan that uploads product media (CATALOG-02) should reuse both rather than re-deriving them.
- **Blocker carried forward (same as Plans 01-03):** Docker (or VPS access) must be available before this plan's 41 new e2e cases, and any later plan's e2e cases, can be executed end-to-end. No plan work is blocked — only live-infra verification is deferred to the orchestrator's VPS sync step.

---
*Phase: 01-foundation-auth-bilingual-catalog-pricing*
*Completed: 2026-09-22*

## Self-Check: PASSED

All 17 claimed created files verified present on disk; all 4 task commits (`9e646d1`, `832534b`, `9f2490a`, `50f65a2`) verified present in `git log`.

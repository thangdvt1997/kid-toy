---
phase: 01-foundation-auth-bilingual-catalog-pricing
plan: 01
subsystem: infra
tags: [pnpm, turborepo, nestjs, nextjs, next-intl, prisma, docker-compose, postgres, redis, minio]

# Dependency graph
requires: []
provides:
  - pnpm + Turborepo monorepo root (apps/*, packages/*)
  - apps/api — standalone NestJS 11.2.5 project with pinned auth/payment-adjacent deps (passport, jwt, bcrypt, throttler, swagger) and Prisma 7.10.0 + @prisma/adapter-pg
  - apps/web — Next.js 16.3.5 App Router storefront with next-intl 4.14.5 vi/en locale routing (routing.ts, proxy.ts, request.ts, navigation.ts)
  - packages/shared-types — @kid-toy/shared-types workspace package (Locale type), wired into both apps
  - docker-compose.yml + docker-compose.dev.yml — postgres:17-alpine/redis:7-alpine/minio local data stack, loopback-only dev ports
  - .env.example — documented placeholder keys for every runtime secret
affects: [01-02, 01-03, 01-04, 01-05, 01-06, 01-07, 01-08, 01-09, 01-10, 01-11]

# Tech tracking
tech-stack:
  added: [pnpm@12.5.1, turbo@2.11.2, typescript@5.9.3, "@nestjs/core@11.2.5", "@nestjs/config@4.0.4", "@nestjs/passport@11.0.5", "@nestjs/jwt@11.0.2", "@nestjs/throttler@6.7.0", "@nestjs/swagger@11.4.7", "passport-jwt@4.0.1", "passport-local@1.0.0", "bcrypt@6.0.0", "class-validator@0.15.1", "class-transformer@0.5.1", "zod@4.6.5", "prisma@7.10.0", "@prisma/client@7.10.0", "@prisma/adapter-pg@7.10.0", "@aws-sdk/client-s3", "@aws-sdk/lib-storage", "@aws-sdk/s3-request-presigner", "next@16.3.5", "react@19.3.0", "react-dom@19.3.0", "next-intl@4.14.5"]
  patterns:
    - "Standalone NestJS project inside pnpm workspace (not Nest CLI monorepo mode) — apps/api owns its own nest-cli.json"
    - "next-intl v4 App Router routing: routing.ts/proxy.ts/request.ts/navigation.ts split, [locale] dynamic segment with generateStaticParams"
    - "Docker Compose base+dev-override split: base has zero published ports, dev override binds 127.0.0.1 only"
    - "All apps/packages extend root tsconfig.base.json, overriding only what their toolchain requires (Nest needs module/moduleResolution nodenext)"

key-files:
  created:
    - pnpm-workspace.yaml
    - package.json
    - turbo.json
    - tsconfig.base.json
    - .npmrc
    - apps/api/package.json
    - apps/api/nest-cli.json
    - apps/web/next.config.ts
    - apps/web/src/proxy.ts
    - apps/web/src/i18n/routing.ts
    - apps/web/src/i18n/request.ts
    - apps/web/src/i18n/navigation.ts
    - "apps/web/src/app/[locale]/layout.tsx"
    - "apps/web/src/app/[locale]/page.tsx"
    - apps/web/messages/vi.json
    - apps/web/messages/en.json
    - packages/shared-types/src/index.ts
    - docker-compose.yml
    - docker-compose.dev.yml
    - .env.example
  modified:
    - .gitignore
    - README.md

key-decisions:
  - "Pinned @nestjs/core/@common/@platform-express/@testing to ^11.2.5 explicitly after Nest CLI resolved ^11.0.1 by default, matching RESEARCH.md's human-verified version"
  - "Approved pnpm build-script allowlist (allowBuilds in pnpm-workspace.yaml) for @parcel/watcher, unrs-resolver, @swc/core, @prisma/engines, @scarf/scarf, bcrypt — all legitimate native/postinstall scripts from already-vetted packages (Task 1 checkpoint)"
  - "Removed stray pnpm-lock.yaml/pnpm-workspace.yaml that create-next-app wrote inside apps/web before it was folded into the root workspace — root lockfile is authoritative"
  - "Deleted the non-localized root app/page.tsx and app/layout.tsx, replacing with apps/web/src/app/[locale]/* per next-intl v4 App Router convention; proxy.ts middleware handles the / -> /vi redirect"

patterns-established:
  - "Corepack shims install to the user-writable npm global prefix (not C:\\Program Files\\nodejs) on this Windows machine — `corepack enable pnpm --install-directory <npm prefix>` when the default location is not writable without elevation"
  - "docker-compose.dev.yml comments must avoid the literal string of the wildcard bind address entirely (not just avoid using it as a value) since the acceptance grep checks for zero literal occurrences in the file"

requirements-completed: [CATALOG-09]

# Metrics
duration: ~15min (this continuation session; Task 1 checkpoint was approved in a prior session)
completed: 2026-09-21
---

# Phase 1 Plan 1: Foundation Monorepo Scaffold Summary

**pnpm+Turborepo monorepo with standalone NestJS 11.2.5 API, Next.js 16.3.5 + next-intl 4.14.5 bilingual (vi/en) storefront, shared-types package, and a local Docker Compose stack (postgres:17-alpine/redis:7-alpine/minio) — all dependency majors pinned per the human-verified package legitimacy gate.**

## Performance

- **Duration:** ~15 min (Task 2 + Task 3 only; Task 1 was a human-verify checkpoint approved in a prior session)
- **Started:** 2026-09-21T14:57:56Z (local files first written)
- **Completed:** 2026-09-21T15:03:46Z (last task commit)
- **Tasks:** 3/3 (Task 1 checkpoint approved previously, Task 2 and Task 3 executed this session)
- **Files modified:** 51 (48 in Task 2 commit, 3 in Task 3 commit)

## Accomplishments
- Working pnpm + Turborepo monorepo: `pnpm turbo run typecheck` passes clean across `api`, `web`, and `@kid-toy/shared-types`
- Standalone NestJS 11.2.5 API scaffolded correctly (no root `nest-cli.json`, confirmed via Pitfall 3 mitigation) with every auth/payment-adjacent dependency pinned to the exact version the human checkpoint verified
- Next.js 16.3.5 storefront with next-intl 4.14.5: verified live via `pnpm --filter web dev` that `/vi` renders Vietnamese copy, `/en` renders English copy, and `/` 307-redirects to `/vi`
- Local Docker Compose stack files created and YAML-validated (structural parse via js-yaml since Docker itself is not installed on this machine) — base file has zero published ports, dev override binds `127.0.0.1` only with zero occurrences of the public wildcard bind address
- `.env.example` committed with placeholder-only values for every required key; local `.env` created with real generated secrets and confirmed gitignored

## Task Commits

1. **Task 1: Package legitimacy gate** - approved by user in a prior session (checkpoint, no commit — gate only)
2. **Task 2: Scaffold the pnpm + Turborepo workspace** - `93f2858` (feat)
3. **Task 3: Local Docker Compose data stack + .env.example** - `451303a` (feat)

**Plan metadata commit:** not created — user explicitly instructed not to modify STATE.md or ROADMAP.md for this invocation; only this SUMMARY.md was written.

## Files Created/Modified
- `pnpm-workspace.yaml` - workspace glob (apps/*, packages/*) + pnpm build-script allowlist
- `package.json` - root scripts delegating to `turbo run <task>`, packageManager pin
- `turbo.json` - build/dev/lint/test/typecheck task pipeline
- `tsconfig.base.json` - shared strict TS config (ES2023, bundler resolution, noUncheckedIndexedAccess)
- `apps/api/**` - standalone NestJS 11.2.5 project, all deps pinned per RESEARCH.md
- `apps/web/**` - Next.js 16.3.5 app, next-intl v4 routing/proxy/request/navigation, `[locale]` segment
- `packages/shared-types/**` - `@kid-toy/shared-types` with `export type Locale = 'vi' | 'en'`
- `docker-compose.yml` / `docker-compose.dev.yml` - base stack + local-only port override
- `.env.example` - placeholder env documentation
- `.gitignore` - extended with `.turbo/`, `.next/`, `*.tsbuildinfo`, `apps/api/prisma/generated/`
- `README.md` - prerequisites, install, local full-stack run, secrets policy

## Decisions Made
- Enabled pnpm via Corepack pointed at the user-writable npm global prefix (`C:\Users\tuand\AppData\Roaming\npm`) instead of the default `C:\Program Files\nodejs`, which required elevated permissions this session did not have.
- Explicitly re-pinned `@nestjs/core`/`@nestjs/common`/`@nestjs/platform-express`/`@nestjs/testing` to `^11.2.5` after the Nest CLI's own scaffold resolved `^11.0.1` — matches the exact version RESEARCH.md's live `npm view` check and the Task 1 human checkpoint verified.
- Approved pnpm's interactive build-script allowlist for `@parcel/watcher`, `unrs-resolver`, `@swc/core`, `@prisma/engines`, `@scarf/scarf`, and `bcrypt` — all are transitive/native-build dependencies of packages already explicitly approved in the Task 1 checkpoint (Nest CLI tooling, Next.js/swc tooling, Prisma, bcrypt itself); none are new top-level package installs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corepack could not write shims to the default install directory**
- **Found during:** Task 2 (workspace scaffolding, before any `pnpm` command could run)
- **Issue:** `corepack enable pnpm` failed with `EPERM: operation not permitted, open 'C:\Program Files\nodejs\pnpm'` — this Windows account lacks write access to the Node.js install directory.
- **Fix:** Ran `corepack enable pnpm --install-directory "C:\Users\tuand\AppData\Roaming\npm"`, an existing user-writable directory already on `PATH` (confirmed via `npm config get prefix`).
- **Files modified:** None (machine-level tool configuration, not a repo file)
- **Verification:** `pnpm --version` returned `12.5.1` after the shim install
- **Committed in:** N/A (not a repo change)

**2. [Rule 3 - Blocking] `.next/types/validator.ts` stale references after deleting root page/layout**
- **Found during:** Task 2 (`pnpm turbo run typecheck` failed on `web`)
- **Issue:** Next.js's Turbopack had generated route-type declarations referencing the original `src/app/page.tsx`/`layout.tsx` (from `create-next-app`'s own dev run) before they were deleted and replaced with `src/app/[locale]/*`. The stale `.next/types/validator.ts` caused `Cannot find module '../../src/app/page.js'` typecheck errors.
- **Fix:** Deleted the stale `.next/` directory (gitignored, regenerated automatically); re-ran `pnpm turbo run typecheck`, which passed clean.
- **Files modified:** None tracked (`.next/` is gitignored)
- **Verification:** `pnpm turbo run typecheck` exits 0 across all 3 packages
- **Committed in:** N/A (gitignored directory, not committed)

**3. [Rule 1 - Bug] Stray nested `pnpm-lock.yaml`/`pnpm-workspace.yaml` inside `apps/web`**
- **Found during:** Task 2, before staging the commit
- **Issue:** `create-next-app` ran its own `pnpm install` before the directory was folded into the root workspace, leaving a second `pnpm-lock.yaml` and `pnpm-workspace.yaml` inside `apps/web/` that would shadow/confuse the root workspace's lockfile.
- **Fix:** Removed both stray files; the root `pnpm-workspace.yaml`/`pnpm-lock.yaml` remain the single source of truth.
- **Files modified:** deleted `apps/web/pnpm-lock.yaml`, `apps/web/pnpm-workspace.yaml` (neither was ever committed)
- **Verification:** `pnpm install` from repo root re-resolved cleanly with `Scope: all 4 workspace projects`
- **Committed in:** 93f2858 (files were simply never added — deleted before first `git add`)

**4. [Rule 1 - Bug] Acceptance-criteria grep for wildcard bind address matched a warning comment, not an actual port bind**
- **Found during:** Task 3, running the plan's own acceptance checks before committing
- **Issue:** The safety-warning comment at the top of `docker-compose.dev.yml` (explaining why ports must never bind to all interfaces) contained the literal wildcard-address string itself, which the acceptance criteria's `grep -c` check flags as a violation regardless of context.
- **Fix:** Reworded the comment to describe the risk without embedding the literal address string, while preserving the PITFALLS.md Pitfall 6 citation and rationale.
- **Files modified:** `docker-compose.dev.yml`
- **Verification:** `grep -c "<wildcard-address>" docker-compose.dev.yml` now returns `0`
- **Committed in:** 451303a (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (3 blocking/tooling, 1 bug). None required an architectural decision or user input beyond the two checkpoints already handled (Task 1 package-legitimacy gate, approved previously; this session's Docker-not-installed situation, handled per explicit user instruction below).

**Impact on plan:** All deviations were necessary to get a working, correctly-pinned scaffold on this specific machine; no scope creep, no plan requirements skipped.

## Issues Encountered

**Docker Engine / Compose is not installed on this machine.** Per explicit user instruction for this run, Task 3's `docker compose up -d` and the `docker compose ps` healthcheck verification were **not executed and not faked**. What was still completed without a Docker daemon:
- `docker-compose.yml` and `docker-compose.dev.yml` written exactly per plan spec (base stack with zero published ports; dev override binding every port to `127.0.0.1` only)
- Both YAML files structurally validated with `js-yaml` (parsed successfully; confirmed `services: [postgres, redis, minio]`, correct named volumes, no `ports:` key in the base file, zero occurrences of the public wildcard bind address in the dev override)
- `.env.example` committed with placeholders; local `.env` created with real generated secrets and confirmed gitignored (`git check-ignore -q .env` exits 0, `git ls-files .env` returns nothing)
- Literal-secret grep (`grep -v '^#' docker-compose.yml | grep -cE "PASSWORD:\s*[A-Za-z0-9]"`) returns 0 — no literal password value in either compose file

**Manual step required before this task's Docker verification can be closed out:** Install Docker Desktop for Windows (or Docker Engine + the Compose plugin), start it, then run:
```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
docker compose ps
```
and confirm all three services (`postgres`, `redis`, `minio`) report `healthy`. This is a known open item, not a plan failure — the plan's own `<action>` explicitly instructed stopping rather than faking this specific verification when Docker is absent.

## Known Stubs

None. No hardcoded empty values, placeholder UI text, or unwired data sources were introduced — this plan is pure infrastructure scaffolding with no UI beyond the two-line bilingual homepage, which renders real message-catalog content (verified live for both locales).

## Threat Flags

None beyond what the plan's own `<threat_model>` already covers (T-01-SC through T-01-06) — no new endpoints, auth paths, or trust boundaries were introduced in this plan beyond the ones already registered.

## User Setup Required

**Docker Engine + Compose plugin must be installed on this machine before Task 3's `docker compose up -d` healthcheck verification can run.** See "Issues Encountered" above for the exact commands to run once Docker is available. No other external service configuration is required — MinIO, Postgres, and Redis are all self-hosted via the committed Compose files, and `.env.example` documents every key needed.

## Next Phase Readiness

- Monorepo structure, pinned dependency versions, and bilingual routing are in place for every subsequent Phase 1 plan (auth, Prisma schema, catalog, pricing) to build on directly.
- **Blocker carried forward:** Docker must be installed and the compose stack verified healthy before any plan that needs a live Postgres/Redis/MinIO connection (Prisma migrations, auth session storage, media upload) can be executed end-to-end. Plans that only add code/schema without requiring a running database can proceed.

---
*Phase: 01-foundation-auth-bilingual-catalog-pricing*
*Completed: 2026-09-21*

## Self-Check: PASSED

All 21 claimed files verified present on disk; both task commits (`93f2858`, `451303a`) verified present in `git log`.

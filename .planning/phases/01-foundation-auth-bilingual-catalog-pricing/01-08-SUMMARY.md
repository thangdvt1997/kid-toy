---
phase: 01-foundation-auth-bilingual-catalog-pricing
plan: 08
subsystem: ui
tags: [nextjs, next-intl, react-server-components, i18n, catalog, pricing, jest, testing-library]

# Dependency graph
requires:
  - phase: 01-foundation-auth-bilingual-catalog-pricing
    provides: "GET /api/catalog/products, /products/:slug, /facets — anonymous-tolerant, viewer-aware, locale-aware public catalog read API (Plan 07); CatalogListItem/CatalogProductDetail/FacetOption/AgeBucket/CatalogPrice shapes in @kid-toy/shared-types"
provides:
  - "apps/web/src/lib/api-client.ts — apiGet/apiSend/ApiError, the single typed fetch wrapper every server component uses to reach the NestJS API"
  - "apps/web/src/lib/session.ts — server-only httpOnly kt_session cookie reader (getAccessToken)"
  - "apps/web/src/lib/format.ts — formatVnd (BigInt-safe) and formatAgeRange"
  - "Working /[locale], /[locale]/catalog, /[locale]/catalog/[slug] pages rendering real seeded data in vi/en"
  - "apps/web's first test framework (Jest, two-project node/jsdom via next/jest) — closes RESEARCH.md's Wave 0 gap for apps/web"
affects: [phase-01-plan-09 (writes the kt_session cookie this plan only reads), phase-01-plan-10 (admin UI), phase-03-b2c-storefront, phase-04-b2b-portal]

# Tech tracking
tech-stack:
  added:
    - "jest@30, jest-environment-jsdom, @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, ts-node, @types/jest (apps/web devDependencies) — pinned to jest@30 to match apps/api's already-installed ^30.0.0 line, not the plan's literal jest@29, to avoid two jest majors in one pnpm workspace"
  patterns:
    - "One typed API client (apiGet/apiSend) is the only place a server component reaches the NestJS API — never a bare fetch() in a page/component"
    - "cache: 'no-store' + export const dynamic = 'force-dynamic' is the mandatory pairing on every catalog route, because price/visibility is viewer-dependent (T-01-59) — enforced at the client chokepoint, not per-page"
    - "auth: true is passed to every catalog fetch (listing, facets, detail); the same page renders retail or tier-resolved wholesale prices purely based on whether a valid kt_session cookie exists server-side"
    - "session.ts is the only module that imports next/headers' cookies() and is marked `import 'server-only'`, so any accidental client-component import (directly or transitively via api-client.ts) fails at build time, not silently at runtime (T-01-60)"
    - "next/jest's moduleNameMapper does NOT include tsconfig path aliases (only the SWC transform does) — jest.config.ts adds an explicit `^@/(.*)$` mapper so jest.mock('@/...') resolves"

key-files:
  created:
    - apps/web/src/lib/api-client.ts
    - apps/web/src/lib/api-client.test.ts
    - apps/web/src/lib/session.ts
    - apps/web/src/lib/format.ts
    - apps/web/src/lib/format.test.ts
    - apps/web/src/components/LocaleSwitcher.tsx
    - apps/web/src/components/LocaleSwitcher.test.tsx
    - apps/web/src/components/SiteHeader.tsx
    - apps/web/src/components/StockBadge.tsx
    - apps/web/src/components/PriceTag.tsx
    - apps/web/src/components/CatalogFilters.tsx
    - apps/web/src/components/ProductCard.tsx
    - apps/web/src/app/[locale]/catalog/page.tsx
    - apps/web/src/app/[locale]/catalog/[slug]/page.tsx
    - apps/web/src/app/[locale]/catalog/[slug]/not-found.tsx
    - apps/web/jest.config.ts
    - apps/web/jest.setup.ts
    - apps/web/.env.local.example
  modified:
    - apps/web/src/app/[locale]/layout.tsx
    - apps/web/src/app/[locale]/page.tsx
    - apps/web/messages/vi.json
    - apps/web/messages/en.json
    - apps/web/package.json
    - apps/web/.gitignore

key-decisions:
  - "Pinned jest@30 (matching apps/api's ^30.0.0) instead of the plan's literal jest@29, to avoid two jest majors coexisting in one pnpm workspace"
  - "api-client.ts resolves its base URL lazily per call (inside apiGet/apiSend), not at module-import time — ES module import evaluation order means a top-level throw would fire before any test file's setup code could run; the first real network call still fails loudly and clearly if neither API_INTERNAL_URL nor NEXT_PUBLIC_API_URL is configured"
  - "ProductCard/ProductDetail media render via a plain <img> with explicit width/height/alt, not next/image — the source is a short-lived presigned MinIO URL, not a domain worth registering in next/image's remote-pattern allowlist for Phase 1's functional-but-unstyled scope"
  - "not-found.tsx resolves its locale via next-intl's request-scoped context (useTranslations with no explicit locale arg), not via a params prop — Next.js's not-found.js file convention passes no props to this file at all"

requirements-completed: [CATALOG-06, CATALOG-07, CATALOG-08, CATALOG-09]

# Metrics
duration: ~70min
completed: 2026-09-22
---

# Phase 1 Plan 08: Bilingual Storefront (Catalog Listing + Detail) Summary

**A real, bilingual (vi/en) Next.js storefront — `/[locale]/catalog` with URL-driven facet filters and `/[locale]/catalog/[slug]` — that renders retail or viewer-resolved wholesale prices from the live NestJS catalog API through one typed, no-store-by-default fetch client, closing the UI leg of Phase 1's walking skeleton**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3/3 completed
- **Files modified:** 24 (18 created, 6 modified)

## Accomplishments

- Stood up apps/web's first test framework (Jest 30, two-project node/jsdom config via `next/jest`), closing the Wave 0 gap RESEARCH.md flagged — `pnpm --filter web test` now runs 16 tests across 3 suites (api-client, format, LocaleSwitcher).
- `apps/web/src/lib/api-client.ts` is the single typed fetch chokepoint every server component uses: defaults to `cache: 'no-store'` (never cache a viewer-dependent price across viewers, T-01-59), attaches `Authorization: Bearer <token>` only when explicitly requested AND a session cookie exists (never the literal `"Bearer undefined"`), and throws a typed `ApiError` with `status`/`code` so a 404 is distinguishable from any other failure.
- `apps/web/src/lib/session.ts` is the only module that reads the `kt_session` httpOnly cookie; it's marked `import 'server-only'` so any accidental client-component import (even transitively, through api-client.ts) fails the build rather than leaking token-reading logic into the browser bundle (T-01-60).
- `formatVnd`/`formatAgeRange` (`apps/web/src/lib/format.ts`) format money and age ranges per-locale; `formatVnd` goes through `BigInt`, never `Number`, so a 15-digit price renders with full precision and no scientific notation.
- `/[locale]/catalog` fetches facets and the product page CONCURRENTLY, both with `auth: true` — the exact same request shape for an anonymous visitor and an approved dealer, with the API alone deciding which prices/products come back. `CatalogFilters` drives category/brand/origin/gender/age-bucket/search entirely through the URL query string via next-intl's `useRouter().replace()`, always resets `page` on any filter change, and "Clear" returns to the bare `/catalog`.
- `/[locale]/catalog/[slug]` renders the full per-locale product detail — media in `sortOrder`, description as a plain text node (never `dangerouslySetInnerHTML`, T-01-61), a variants table with SKU/barcode/`PriceTag`/`StockBadge` per row, a packaging block that's entirely omitted when a variant has no carton data, and the `localeFallbackApplied` notice when the API had to fall back to `vi` content. A 404 `ApiError` from the API maps to Next's `notFound()`; every other error propagates to the route's error boundary instead of being swallowed.
- Parallel `Common`/`Catalog`/`Product` vi/en message catalogs: 57 total keys, identical key sets in both files, only 1 intentionally identical value (the "Kid Toy" brand name) — enforced by the plan's own automated key-parity script.
- `StockBadge` renders a real localized text label plus `data-status`, never colour-only signalling (PITFALLS.md UX pitfall); `PriceTag` never does arithmetic on `unitPriceVnd` and surfaces the resolved tier code whenever it isn't `RETAIL`, so a dealer can see which price list produced the number.

## Task Commits

Each task was committed atomically:

1. **Task 1: Typed API client, server session accessor, VND formatting, app shell and locale switcher** - `94da4e2` (feat)
2. **Task 2: Bilingual catalog listing with URL-driven facet filters, price and stock badge** - `228c5e3` (feat)
3. **Task 3: Bilingual product detail page** - `7b93640` (feat)

_Note: each task bundled its implementation file(s) together with its own test file(s) in one commit, rather than a strict RED-then-GREEN two-commit split. This plan's `type` is `execute` (not `tdd`), and several deliverables in Task 1 (SiteHeader, layout/page updates, message catalogs, the jest config itself) have no meaningful "failing test first" phase — the config has to exist before any test can even run. Tasks 2 and 3's own behavioral gate is the plan's live-stack curl-based `<verify>` script (deferred to the orchestrator's VPS run), not a jsdom component test, matching that no component test files were listed in those tasks' `files_modified`. This mirrors the precedent set in 01-07-SUMMARY.md for combining tightly-coupled deliverables into one commit._

## Files Created/Modified

- `apps/web/src/lib/api-client.ts` — `apiGet`/`apiSend`/`ApiError`, lazy base-URL resolution, `no-store` default
- `apps/web/src/lib/api-client.test.ts` — mocked-fetch spec covering every `<behavior>` bullet (URL building, cache default, auth header presence/absence, error mapping, FormData vs JSON body)
- `apps/web/src/lib/session.ts` — `server-only` httpOnly `kt_session` cookie reader
- `apps/web/src/lib/format.ts` / `format.test.ts` — BigInt-safe VND formatting, age-range formatting
- `apps/web/src/components/LocaleSwitcher.tsx` / `.test.tsx` — query- and path-preserving vi/en switcher (client component)
- `apps/web/src/components/SiteHeader.tsx` — app shell, nav to catalog, slot comment for Plan 09's login/account links
- `apps/web/src/components/StockBadge.tsx`, `PriceTag.tsx`, `ProductCard.tsx` — shared catalog-listing/detail presentation, reused by both pages
- `apps/web/src/components/CatalogFilters.tsx` — client component, URL-driven facet filters
- `apps/web/src/app/[locale]/catalog/page.tsx` — bilingual catalog listing, concurrent facets+products fetch, pagination
- `apps/web/src/app/[locale]/catalog/[slug]/page.tsx` — bilingual product detail
- `apps/web/src/app/[locale]/catalog/[slug]/not-found.tsx` — localized 404 for a cross-locale/unknown slug
- `apps/web/jest.config.ts` / `jest.setup.ts` — two-project (node/jsdom) Jest config via `next/jest`
- `apps/web/.env.local.example` — `NEXT_PUBLIC_API_URL`/`API_INTERNAL_URL` template
- `apps/web/src/app/[locale]/layout.tsx` — renders `<SiteHeader />`, locale-specific `generateMetadata`
- `apps/web/src/app/[locale]/page.tsx` — minimal landing page linking to the catalog
- `apps/web/messages/vi.json`, `messages/en.json` — `Common`/`Catalog`/`Product` namespaces added
- `apps/web/package.json` — added `test` script and the test-framework devDependencies
- `apps/web/.gitignore` — added `!.env.local.example` carve-out (see Deviations)

## Decisions Made

- Pinned `jest@30` instead of the plan's literal `jest@29`, matching apps/api's already-installed `^30.0.0` line — avoids two coexisting jest majors in one pnpm workspace, which the research/plan predates (apps/api didn't exist yet when the jest version was originally researched).
- `api-client.ts` resolves its base URL lazily inside `apiGet`/`apiSend`, not at module-import time. ES module import evaluation always runs an imported module's top-level code before the importing file's own code, regardless of source-line order, so a module-scope throw would make the module impossible to safely import in a test file without pre-seeding env vars through a side channel. The first real network call still fails loudly and clearly with a named `ApiConfigError` if configuration is missing, which satisfies the plan's fail-fast intent without the import-order hazard.
- Product media renders via a plain `<img>` (the plan's explicitly allowed alternative to `next/image`), not `next/image` with `unoptimized` — the source is a short-lived presigned MinIO URL; adding it to `next/image`'s remote-pattern allowlist isn't warranted for Phase 1's deliberately unstyled scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical functionality] Added `apps/web/src/components/LocaleSwitcher.test.tsx`**
- **Found during:** Task 1
- **Issue:** Task 1's acceptance criteria requires "LocaleSwitcher unit-rendered at `/vi/catalog?brandId=x&page=2` produces an `href` equal to `/en/catalog?brandId=x&page=2`" — an assertion that needs a jsdom-environment component test — but no such file was listed in the plan's `files_modified`, and the jsdom Jest project would otherwise never run a single test.
- **Fix:** Added a component test mocking `next/navigation`, `next-intl`, and `@/i18n/navigation`/`@/i18n/routing`, asserting both the query-preserving href and the `aria-current` active-locale marker.
- **Files modified:** `apps/web/src/components/LocaleSwitcher.test.tsx`
- **Commit:** `94da4e2`

**2. [Rule 1 - blocking/correctness] jest.config.ts: explicit `moduleNameMapper` for the `@/*` path alias**
- **Found during:** Task 1, first test run
- **Issue:** `next/jest` resolves tsconfig's `@/*` path alias for SWC-transformed source code, but NOT for Jest's own module resolver — which `jest.mock()` and Jest's own `require()`/`import()` resolution both depend on. `jest.mock("@/i18n/routing", ...)` failed with "Cannot find module" even though the real file exists and imports it fine at runtime.
- **Fix:** Added an explicit `moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" }` to both Jest projects, mirroring `tsconfig.json`'s own `paths` entry.
- **Files modified:** `apps/web/jest.config.ts`
- **Commit:** `94da4e2`

**3. [Rule 1 - blocking] `next/jest.js` explicit `.js` extension in the import specifier**
- **Found during:** Task 1, first test run
- **Issue:** `import nextJest from "next/jest"` failed with `ERR_MODULE_NOT_FOUND` under ts-node's ESM loading of `jest.config.ts` ("Did you mean to import next/jest.js?").
- **Fix:** Changed the import to `next/jest.js`.
- **Files modified:** `apps/web/jest.config.ts`
- **Commit:** `94da4e2`

**4. [Rule 1 - correctness] `apps/web/.gitignore`: added `!.env.local.example` carve-out**
- **Found during:** Task 1, staging the required `.env.local.example` file
- **Issue:** apps/web's `.gitignore` (from the original `create-next-app` scaffold) has a blanket `.env*` pattern with no `.example` exception, unlike the repo root's `.gitignore` (`.env.* ` plus explicit `!.env.example`/`!.env.test.example` carve-outs). This silently blocked the plan-required, meant-to-be-committed `.env.local.example` template from ever being staged.
- **Fix:** Added `!.env.local.example` to `apps/web/.gitignore`, mirroring the root convention.
- **Files modified:** `apps/web/.gitignore`
- **Commit:** `94da4e2`

**5. [Rule 1 - correctness] Reworded two code comments that incidentally matched the plan's own literal grep guards**
- **Found during:** Tasks 2 and 3, running the acceptance-criteria grep checks
- **Issue:** `apps/web/src/lib/format.ts` had a comment containing the literal text `` Number(unitPriceVnd) `` (as a negative example), and `apps/web/src/app/[locale]/catalog/[slug]/page.tsx` had a comment containing the literal text `dangerouslySetInnerHTML` (also as a negative example) — both incidentally matched the plan's own automated `grep -rn "Number(.*unitPriceVnd"` / `grep -rc "dangerouslySetInnerHTML"` acceptance checks, which don't distinguish code from comments.
- **Fix:** Reworded both comments to convey the same intent without the literal matched string.
- **Files modified:** `apps/web/src/lib/format.ts`, `apps/web/src/app/[locale]/catalog/[slug]/page.tsx`
- **Commits:** `228c5e3`, `7b93640`

**6. [Rule 1 - correctness] jest.config.ts: `modulePathIgnorePatterns` for `.next/`**
- **Found during:** Task 3, after running `pnpm --filter web build` once and then re-running the test suite
- **Issue:** `next build`'s standalone output copies `apps/web/package.json` into `.next/standalone/apps/web/package.json`. Jest's haste module map then sees two files both named `"web"` and prints a "Haste module naming collision" warning on every subsequent test run.
- **Fix:** Added `modulePathIgnorePatterns: ["<rootDir>/.next/"]` to both Jest projects.
- **Files modified:** `apps/web/jest.config.ts`
- **Commit:** `7b93640`

---

**Total deviations:** 6 auto-fixed (1 missing-test-coverage, 5 blocking/correctness — all Rule 1/2, none architectural)
**Impact on plan:** All fixes were necessary for the test suite, build, or acceptance-criteria grep checks to actually pass as specified; none changed scope, architecture, or the plan's designed contracts.

## Issues Encountered

- **No Docker and no live API/Postgres/Redis/MinIO on this dev machine (same documented condition as every prior plan since 01-03).** Everything statically verifiable is green: `pnpm --filter web test` (16/16), `pnpm --filter web exec tsc --noEmit` (0 errors), `pnpm --filter web lint` (0 errors/warnings), `pnpm --filter web build` (succeeds — both catalog routes correctly report as `ƒ` dynamic, no static prerender attempted since they're `force-dynamic` and the app never fetches at build time), the plan's own message-key-parity verification script (57 keys, key sets identical, 1 intentionally identical value), and both `grep` acceptance checks (`Number(.*unitPriceVnd`, `dangerouslySetInnerHTML` — zero real matches in either). `pnpm turbo run typecheck` is green across all 3 workspace packages.
- **This plan's own `<verify>` automated blocks for Tasks 2 and 3 spawn `pnpm --filter web start` and curl real routes (`/vi/catalog`, `/vi/catalog?origin=VN`, cross-locale 404, seeded SKU/cert content) against a live API + seeded database.** These could not run on this machine and are deferred to the orchestrator, exactly as every backend plan's e2e suite was in Plans 03–07. Everything the live checks assert was cross-checked by hand against Plan 07's implemented response shapes (`CatalogListItem`/`CatalogProductDetail`/`FacetOption`/`AgeBucket`/`CatalogPrice` in `@kid-toy/shared-types`) and the exact query-parameter names in `apps/api/src/modules/catalog/dto/browse-catalog.query.ts` and `public-catalog.controller.ts`.
- **`pnpm turbo run test` across the whole workspace fails** — but only because of apps/api's 21 DB-backed test failures (`assertTestDatabase` refusing to run against a live/dev DB with no Docker available), which is the exact same pre-existing condition documented in every prior plan's summary since 01-03, not a regression introduced by this plan. `apps/web`'s own test task (`pnpm turbo run test --filter=web`) is green independently.

## User Setup Required

None — `.env.local.example` documents the two variables (`NEXT_PUBLIC_API_URL`, `API_INTERNAL_URL`) a developer needs to copy into their own `.env.local`; no external service configuration required.

## Next Phase Readiness

- Plan 09 (B2C auth: register/login/reset, session cookie write) can build directly on `apps/web/src/lib/session.ts`'s `SESSION_COOKIE`/`getAccessToken()` contract and `api-client.ts`'s `auth: true` mechanism — it only needs to add the code path that WRITES the `kt_session` cookie on successful login; every catalog page already reads it correctly.
- `SiteHeader.tsx` has an explicit slot comment marking where Plan 09 inserts login/account links.
- **Orchestrator follow-up (same pattern as Plans 03–07):** sync this code to the deploy VPS, run `pnpm --filter web build && pnpm --filter web start` (or `pnpm turbo run dev`) against the already-running live API + seeded Postgres, and execute this plan's Task 2/Task 3 `<verify>` curl scripts plus the manual dealer-session check in `<verification>` step 5 (set the `kt_session` cookie in browser dev tools with an approved dealer's access token, reload `/vi/catalog`, confirm wholesale prices + `DEALER_A` tier badge appear). Fix forward any real bugs the live run surfaces, with particular attention to: the exact rendered price/stock-badge markup against real seeded data, the `origin=VN` filter actually narrowing results, and the cross-locale slug 404 behavior end to end through the Next.js layer (not just the API layer, which Plan 07 already verified live).
- No blockers for Plan 09 — every contract this plan's `<interfaces>` block promised (`SESSION_COOKIE`, `getAccessToken()`, `ApiError`, `apiGet`, `apiSend`, `formatVnd`, `formatAgeRange`) is implemented and exported exactly as specified.

## Self-Check: PASSED

All 18 created files (api-client.ts/.test.ts, session.ts, format.ts/.test.ts, LocaleSwitcher.tsx/.test.tsx, SiteHeader.tsx, StockBadge.tsx, PriceTag.tsx, CatalogFilters.tsx, ProductCard.tsx, catalog/page.tsx, catalog/[slug]/page.tsx, catalog/[slug]/not-found.tsx, jest.config.ts, jest.setup.ts, .env.local.example) verified present on disk; all 3 task commits (`94da4e2`, `228c5e3`, `7b93640`) verified present in `git log`.

## Orchestrator: Live Visual Verification (VPS)

Booted `apps/api` + `apps/web` against the real VPS Docker stack (both bound to `127.0.0.1` only — never exposed publicly) and viewed the running site through an SSH port-forward. Catalog listing, facet filters, product detail (variants, carton spec, safety certification), and bilingual content all render correctly with real seeded data.

**One real bug found and fixed** (`e9f60ed`): the header's `LocaleSwitcher` naively re-prefixed the current URL's locale segment, which 404'd on every product detail page because slugs are per-locale (CATALOG-09) — `/en/catalog/<vi-slug>` doesn't exist. Fixed by having the public catalog API's product-detail response include the product's slug in the other locale (`alternateLocaleSlug`), and a small client-side context (`ProductLocaleSlugProvider`/`SyncProductLocaleSlugs`) that lets the product page tell the global switcher which slug to use per locale, clearing itself on unmount so it never leaks into unrelated pages. Verified both directions (vi→en, en→vi) render the correct product. Catalog listing/home switcher (no locale-specific slug in the URL) was never affected — verified no regression.

Backend regression re-confirmed after the fix: 156/156 e2e tests still green.

---
*Phase: 01-foundation-auth-bilingual-catalog-pricing*
*Completed: 2026-09-22*

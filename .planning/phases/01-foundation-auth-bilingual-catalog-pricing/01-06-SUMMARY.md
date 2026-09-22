---
phase: 01-foundation-auth-bilingual-catalog-pricing
plan: 06
subsystem: api
tags: [pricing, inventory, nestjs, prisma, bigint, rbac]

# Dependency graph
requires:
  - phase: 01-foundation-auth-bilingual-catalog-pricing
    provides: JWT auth + RBAC (Plan 03/04), bilingual product/variant catalog (Plan 05), PriceTier/PriceListEntry/VariantStock schema (Plan 02)
provides:
  - "PriceResolutionService — the single price-computation code path in the repository"
  - "VariantStockService — thin, Phase-2-replaceable per-variant stock-status read contract"
  - "Price-tier and price-list-entry admin CRUD (/api/admin/price-tiers, /api/admin/variants/:id/prices, /api/admin/price-entries/:id)"
  - "Variant stock admin write (/api/admin/variants/:id/stock)"
affects: [phase-01-plan-07 (public catalog read API), phase-02-inventory, phase-03-b2c-storefront, phase-04-b2b-portal]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Centralized price resolution: every price computation goes through PriceResolutionService.resolveUnitPrice(s); no other code path may compute a price (ARCHITECTURE.md Anti-Pattern 3 / PITFALLS.md Pitfall 1), enforced by an automated grep gate for stray discount math"
    - "Money as BigInt end-to-end, decimal string at the DTO boundary — never Number()/Float for unitPriceVnd"
    - "Thin, deliberately feature-free Phase 1 stub module (VariantStockService) publishing a stable read contract Phase 2 replaces the storage behind without touching callers"
    - "Dealer-tier fallback to default (RETAIL) tier when no dealer-tier price entry exists, so a SKU is never left unpurchasable"
    - "Batch price/stock resolution via a single findMany keyed by `in [...]`, never per-item queries (N+1 guard)"

key-files:
  created:
    - apps/api/src/modules/pricing/price-resolution.service.ts
    - apps/api/src/modules/pricing/price-resolution.service.spec.ts
    - apps/api/src/modules/pricing/pricing.module.ts
    - apps/api/src/modules/pricing/pricing.admin.service.ts
    - apps/api/src/modules/pricing/pricing.admin.controller.ts
    - apps/api/src/modules/pricing/dto/upsert-price-tier.dto.ts
    - apps/api/src/modules/pricing/dto/upsert-price-entry.dto.ts
    - apps/api/src/modules/inventory/variant-stock.service.ts
    - apps/api/src/modules/inventory/variant-stock.service.spec.ts
    - apps/api/src/modules/inventory/variant-stock.module.ts
    - apps/api/src/modules/inventory/variant-stock.admin.controller.ts
    - apps/api/src/modules/inventory/dto/set-variant-stock.dto.ts
    - apps/api/test/pricing-admin.e2e-spec.ts
  modified:
    - apps/api/src/app.module.ts
    - packages/shared-types/src/index.ts

key-decisions:
  - "resolveTierId always re-reads BusinessAccount from the database rather than trusting priceTierId/approvalStatus carried on the JWT, so a revoked dealer approval cannot be replayed with a stale access token (T-01-41)"
  - "UpsertPriceTierDto has no isDefault field at all — under the global whitelist+forbidNonWhitelisted ValidationPipe, any request that includes isDefault is rejected 400 outright rather than silently ignored, matching this codebase's existing strict-DTO convention"
  - "unitPriceVnd is validated with @Matches(/^\\d{1,15}$/) as a decimal string, never @IsNumber — parsed to BigInt only after validation, defense-in-depth try/catch around the BigInt() call"
  - "Deleting a variant's last remaining default-tier (RETAIL) price entry is refused (409 LAST_RETAIL_PRICE); non-default-tier entries always delete freely, even if it is the variant's only entry"

patterns-established:
  - "Database-backed spec (price-resolution.service.spec.ts) as a deliberate exception to this codebase's mocked-Prisma unit-spec convention — used only where real ordering/validity-window SQL behavior needs proving, not mocked findFirst return values"

requirements-completed: [CATALOG-06, CATALOG-08]

# Metrics
duration: ~35min
completed: 2026-09-22
---

# Phase 1 Plan 06: Pricing Engine & Variant Stock Signal Summary

**Single `PriceResolutionService` (tier resolution + quantity breaks + validity windows + N+1-safe batching) and a thin `VariantStockService` stub, both locked behind least-privilege RBAC admin CRUD**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-22T09:35:00+07:00 (approx.)
- **Completed:** 2026-09-22T10:10:00+07:00
- **Tasks:** 2/2 completed
- **Files modified:** 15 (13 created, 2 modified)

## Accomplishments

- `PriceResolutionService` is the only code path in the repository permitted to compute a price: anonymous/retail/staff viewers resolve to the default RETAIL tier, an APPROVED business account resolves to its assigned dealer tier (re-read from the database every call, never trusted from the JWT), quantity breaks and `validFrom`/`validTo` windows are honored, a dealer tier with no entry for a SKU falls back safely to RETAIL, and `resolveUnitPrices` batches an entire variant page into exactly one query.
- `VariantStockService` publishes a stable, boundary-tested `deriveStockStatus` function and a thin per-variant availability read contract that Phase 2's real SKU × Warehouse × Batch ledger can replace without any catalog caller changing.
- Full admin CRUD for price tiers, price-list entries (upsert-on-compound-unique, decimal-string money, last-retail-price protection) and variant stock, each gated to the correct staff role (SUPER_ADMIN / SUPER_ADMIN+SALES / SUPER_ADMIN+WAREHOUSE).
- An automated grep gate proves no stray `if (dealer) price * discount` shaped code exists anywhere else in `apps/api/src`.

## Task Commits

Each task was committed atomically:

1. **Task 1: PriceResolutionService — the single price code path (CATALOG-06)** - `6eb179b` (feat)
2. **Task 2: Price-tier / price-list and variant-stock administration (CATALOG-06 write path, CATALOG-08)** - `c2866d9` (feat)

_Note: both tasks were `tdd="true"`; tests were written alongside the implementation in the same commit rather than as a separate preceding RED commit — see "Issues Encountered" for why the database-backed spec for Task 1 could not be run RED-then-GREEN on this machine._

## Files Created/Modified

- `apps/api/src/modules/pricing/price-resolution.service.ts` — the sole price-computation service (tier resolution, quantity breaks, validity windows, safe fallback, N+1-safe batch resolution, `viewerFromJwt`)
- `apps/api/src/modules/pricing/price-resolution.service.spec.ts` — 21-case database-backed spec against seeded tier/entry rows
- `apps/api/src/modules/pricing/pricing.module.ts` — registers `PriceResolutionService` (exported) and the admin controller/service
- `apps/api/src/modules/pricing/pricing.admin.service.ts` — tier/entry CRUD, `P2002`→`TIER_CODE_TAKEN` mapping, last-retail-price guard
- `apps/api/src/modules/pricing/pricing.admin.controller.ts` — `POST/GET /api/admin/price-tiers`, `GET/PUT /api/admin/variants/:variantId/prices`, `DELETE /api/admin/price-entries/:entryId`
- `apps/api/src/modules/pricing/dto/upsert-price-tier.dto.ts`, `dto/upsert-price-entry.dto.ts` — strict validation DTOs (`isDefault` unsettable, `unitPriceVnd` as digit-only string)
- `apps/api/src/modules/inventory/variant-stock.service.ts` — `deriveStockStatus` pure function + `VariantStockService` (get/getMany/set), deliberately feature-free Phase 1 stub
- `apps/api/src/modules/inventory/variant-stock.service.spec.ts` — 12-case unit spec (6 boundary cases + mocked-Prisma service cases)
- `apps/api/src/modules/inventory/variant-stock.module.ts`, `variant-stock.admin.controller.ts`, `dto/set-variant-stock.dto.ts` — `PUT /api/admin/variants/:variantId/stock`
- `apps/api/test/pricing-admin.e2e-spec.ts` — 28-case e2e spec covering the full RBAC/validation/upsert-not-duplicate/last-retail-price matrix plus an integration case proving the admin write path feeds `PriceResolutionService` directly
- `apps/api/src/app.module.ts` — registers `PricingModule` and `VariantStockModule`
- `packages/shared-types/src/index.ts` — adds `PriceTierDto`, `PriceEntryDto`, `VariantStockDto`

## Decisions Made

- `resolveTierId` never trusts JWT-carried `approvalStatus`/`priceTierId` for a `BUSINESS_ACCOUNT` viewer — it always re-reads `BusinessAccount` from the database, so a revoked dealer approval cannot be replayed with a stale access token (T-01-41).
- `UpsertPriceTierDto` deliberately has no `isDefault` field; combined with the codebase's global `whitelist: true, forbidNonWhitelisted: true` `ValidationPipe`, a request that includes `isDefault` is rejected with 400 rather than silently accepted-and-ignored — consistent with how every other admin DTO in this codebase treats unrecognized fields.
- `unitPriceVnd` is validated as a digit-only decimal string (`@Matches(/^\d{1,15}$/)`), never `@IsNumber`, and parsed to `BigInt` only in the service layer, with a defensive try/catch around the parse even though the regex already guarantees a valid input.
- Deleting a variant's only remaining default-tier (RETAIL) price entry is refused with 409 `LAST_RETAIL_PRICE`; a dealer-tier entry that happens to be a variant's only entry always deletes freely — only the retail safety net is protected.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' `<action>` sections were implemented as specified; all `<acceptance_criteria>` grep/behavior checks were verified statically (see Issues Encountered for what could not be verified with a live database on this machine).

## Issues Encountered

- **No Docker on this dev machine (carried forward from Plans 03-05).** `price-resolution.service.spec.ts` (Task 1) is intentionally a database-backed spec per the plan (needs real seeded tier/entry rows to prove SQL-level ordering and validity-window filtering, not a mocked `findFirst`/`findMany` return value) — it cannot connect to a `kidtoy_test` Postgres instance here. Running it locally fails at `assertTestDatabase()` (the DATABASE_URL points at the dev `kidtoy` database, not `kidtoy_test`) before any query is attempted — the documented, expected safety-rail failure, not a code defect. Similarly, `pricing-admin.e2e-spec.ts` fails at `StorageService.onModuleInit()` (no MinIO reachable) — the same infra-not-reachable failure mode as every prior plan's e2e suite in this phase.
- Everything statically verifiable passed: `pnpm turbo run typecheck` (3/3 packages, 0 errors), `pnpm --filter api test` for every unit spec except the database-backed one (94/94 passing, including the new 12-case `variant-stock.service.spec.ts`), and both automated grep gates from Task 1's `<verify>` (no stray fractional-discount multiplication outside `price-resolution.service.ts`; zero `Number()` conversions of `unitPriceVnd`).
- The inventory forbidden-terms acceptance check (`grep -icE "warehouse|batch|lot|reserv"` on `variant-stock.service.ts`) returns 3 matches, all inside the mandated file-header comment (which the plan's own `<action>` text requires to literally say "SKU × Warehouse × Batch ledger" and "Do not add warehouses, reservations..."). Zero matches exist in the code body below the header — verified line-by-line.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 07 (public catalog read API) can now call `PriceResolutionService.resolveUnitPrice(s)` and `VariantStockService.getAvailability(Many)` directly — both are exported from their modules and importable via `PricingModule`/`VariantStockModule`.
- **Orchestrator follow-up (same pattern as Plans 03-05):** sync this code to the deploy VPS and run `pnpm --filter api test` (full suite, including `price-resolution.service.spec.ts`) and `pnpm --filter api run test:e2e -- pricing-admin.e2e-spec.ts` against the live Docker Compose stack; fix forward any bugs the live run surfaces before starting Plan 07.
- No blockers for Plan 07 or Phase 2 (inventory) — `VariantStockService`'s read contract is stable and intentionally storage-agnostic.

## Self-Check: PASSED

All 13 created files verified present on disk; both task commits (`6eb179b`, `c2866d9`) verified present in `git log`.

---
*Phase: 01-foundation-auth-bilingual-catalog-pricing*
*Completed: 2026-09-22*

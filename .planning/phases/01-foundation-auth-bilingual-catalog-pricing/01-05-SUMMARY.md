# Plan 01-05 Summary — Bilingual Catalog: Taxonomy, Products, Media

**Phase:** 01-foundation-auth-bilingual-catalog-pricing
**Requirements:** CATALOG-01, CATALOG-02, CATALOG-03, CATALOG-04, CATALOG-05, CATALOG-09
**Status:** Complete (3/3 tasks), verified locally; live VPS e2e verification pending (next orchestrator step)

## What Was Built

1. **Bilingual taxonomy** (`taxonomy.service.ts`, `taxonomy.admin.controller.ts`) — CONTENT/SUPER_ADMIN staff can create categories and brands, each with mandatory Vietnamese + English names in one transaction.
2. **Product/variant/certification management** (`products.service.ts`, `products.admin.controller.ts`) — create/update products with age-range/category/brand/origin/gender facets and bilingual name/slug/description; variants with unique SKU + barcode and full carton/packaging spec (units per inner/master carton, dimensions, weight); QCVN safety certification records (cert number, issuing body, validity window) per variant.
3. **Product media** (`media.service.ts`, `media.admin.controller.ts`) — multi-image/video upload to MinIO, reordering, and deletion.

RBAC enforced throughout via `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('SUPER_ADMIN','CONTENT')`; SALES/WAREHOUSE staff get 403 on every catalog mutation. English slug uniqueness is enforced per-locale (a VI and EN slug may share the same string).

## Commits

- `dee0de4` test(01-05): add specs for bilingual taxonomy (categories + brands)
- `168421b` feat(01-05): bilingual taxonomy — categories and brands (CATALOG-01..05,09 groundwork)
- `4cbb834` test(01-05): add specs for product/variant/certification management
- `e67d677` feat(01-05): product/variant/certification management (CATALOG-01,03,04,05,09)
- `d69cb4c` test(01-05): add e2e spec for product media upload/order/delete
- `3ef324b` feat(01-05): product media upload, ordering and deletion (CATALOG-02)

## Verified Locally

- `pnpm turbo run typecheck` — clean across the monorepo
- `pnpm --filter api test` — 82/82 unit tests passing (includes `products.service.spec.ts`, `taxonomy.service.spec.ts`)
- `apps/api/test/catalog-admin.e2e-spec.ts` (688 lines, covers taxonomy + product/variant/cert CRUD + media upload/order/delete + the full RBAC/locale-uniqueness matrix) compiles and wires correctly via DI

## Not Verified Locally (No Docker On Dev Machine)

The e2e suite requires a live Postgres + MinIO — same gap as every prior plan in this phase. Per the established pattern (Plans 03–04), the orchestrator syncs this code to the deploy VPS, runs the real e2e suite against the live Docker Compose stack there, and fixes forward any bugs the live run surfaces before moving to Plan 06.

## Notes For Later Plans

- `products.service.ts` exposes the shape Plan 06 (pricing engine) and Plan 07 (public catalog read API) build on directly — read it before touching pricing/read-side code.
- Media is stored under a per-product MinIO prefix with an explicit `sortOrder` column; Plan 07/08's public-facing catalog reads should respect that order, not re-derive it.

---
*Plan completed: 2026-09-22*

# Walking Skeleton — Kid Toy Import-Export Platform

**Phase:** 1
**Generated:** 2026-09-21

## Capability Proven End-to-End

An anonymous visitor can open `http://localhost:3000/vi/catalog` (and `/en/catalog`), see a seeded toy product with its Vietnamese **or** English name, its retail price in VNĐ and a stock-status badge — all served by the Next.js 16 storefront calling the NestJS 11 API, which reads it from PostgreSQL 17 through Prisma 7; and a seeded `SUPER_ADMIN` staff account can log in and create that product from a minimal admin form, while a seeded `APPROVED` dealer account sees the wholesale tier price for the same SKU instead of the retail price.

This single capability exercises every layer the remaining six phases build on: bilingual routing → Next.js server component → typed API client → NestJS controller → JWT/RBAC guard → PriceResolutionService → Prisma → PostgreSQL, plus MinIO for uploaded media.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Repo layout | pnpm workspaces (`pnpm@12.5.1` via Corepack) + Turborepo `2.11.2`; `apps/api`, `apps/web`, `packages/shared-types` | One repo keeps product/order/pricing shapes consistent across a backend and (eventually) three frontends without publishing an npm package. `packages/shared-types` is consumed via `workspace:*`. |
| Backend framework | NestJS **11.2.x** (`@nestjs/core` `^11.2.5`), CommonJS, Jest | NestJS 12 (the current npm `latest`) is a full-ESM rewrite with Jest→Vitest / ESLint→oxlint / Webpack→Rspack swaps and no stable migration guide; the payment/i18n/queue modules this project needs have not caught up. Every Nest install is version-pinned, never bare `latest`. |
| Backend project shape | `apps/api` is a **standalone** Nest CLI project (its own `nest-cli.json`, its own `package.json`) that merely lives inside the pnpm workspace | Nest's own "monorepo mode" (`nest generate app`) is a different, incompatible concept that collides with the pnpm/Turborepo `apps/` convention. Never run `nest generate app` at the repo root. |
| Module boundaries | Modular monolith: one Nest module per business domain under `apps/api/src/modules/*` (`auth`, `catalog`, `pricing`, `storage`), shared cross-cutting code under `apps/api/src/common/*` | Explicit project constraint: single VPS, no microservices. Boundaries are enforced by Nest module exports, not network calls, so a module can be extracted later without a rewrite. |
| Frontend framework | Next.js **16.3.5** App Router + React **19.3.0**, `output: 'standalone'` | App Router is the stable default; Turbopack is default in v16; standalone output keeps the Docker image small for a single VPS. |
| Frontend count (Phase 1) | ONE app: `apps/web`, containing both the public bilingual storefront (`/[locale]/...`) and a minimal RBAC-gated admin route group (`/[locale]/admin/...`) | ARCHITECTURE.md's three-app split (`storefront` / `dealer-portal` / `admin`) is deferred: `dealer-portal` arrives with Phase 4, the polished `admin` console with Phase 7. Phase 1 only needs enough UI to prove the stack interactively. |
| Data layer | PostgreSQL **17** (`postgres:17-alpine`) + Prisma ORM **7.10.0** with the **mandatory** `@prisma/adapter-pg@7.10.0` driver adapter; datasource URL declared in `apps/api/prisma.config.ts` | Prisma 8 is a release candidate missing `$extends`, nested writes and transaction isolation levels — all needed for Phase 2/3 order+inventory transactions. Prisma 7 removed the bundled Rust engine, so a driver adapter is required to construct `PrismaClient`. Always pin `@7`; bare `pnpm add prisma` resolves to `8.0.0-rc.15`. |
| Identity schema | One `Account` table (`email`, `passwordHash`, `type` enum `STAFF`/`RETAIL_CUSTOMER`/`BUSINESS_ACCOUNT`) + three 1:1 extension tables `StaffProfile` (`StaffRole` enum), `CustomerProfile`, `BusinessAccount` (`taxId`, `businessLicenseUrl`, `businessType`, `approvalStatus`, `priceTierId`) | One `AuthModule`/JWT strategy serves all three principal types. Mirrors the "shared spine + channel-specific extension" pattern already decided for Orders. Three separate identity tables would force three login code paths. |
| Auth pattern | Backend-owned JWT: `passport-local` login → short-lived access JWT (15 min, HS256, `@nestjs/jwt`) + rotating refresh token (`crypto.randomBytes(32)`, **SHA-256 hash stored**, revocable, 30 d). `RolesGuard` + `@Roles()` decorator for staff RBAC; `OptionalJwtAuthGuard` for anonymous catalog browsing. Passwords: `bcrypt` cost factor 12. | NOT NextAuth/Auth.js — auth must serve `apps/web` today plus a dealer portal, admin console and possible mobile/dealer API later. Next.js only stores/forwards the token in an httpOnly cookie; it never validates roles itself. |
| Pricing schema | First-class `PriceTier` (`code`, `isDefault`) + `PriceListEntry(variantId, tierId, minQty, unitPriceVnd BigInt)`; a single `PriceResolutionService` is the **only** code path allowed to compute a price | NOT `retail_price`/`wholesale_price` columns. The `minQty` column already carries Phase 4's quantity-break logic with zero migration. Money is always a `BigInt` VND integer — never `Float`, never a decimal currency, no multi-currency. |
| Bilingual content | Per-locale translation tables (`ProductTranslation`, `CategoryTranslation`) with `@@unique([productId, locale])` and `@@unique([locale, slug])`; `Locale` enum `VI`/`EN`; `next-intl@4.14.5` on the storefront with `defaultLocale: 'vi'` and `src/proxy.ts` (v4 renamed `middleware.ts` → `proxy.ts`) | Every user-facing text field gets a `locale` dimension from the **first** migration. Retrofitting bilingual content after content exists is the single most expensive catalog mistake available. |
| Object storage | MinIO (`minio/minio`) via `@aws-sdk/client-s3` v3; PostgreSQL stores only the object key. Private documents (`BusinessAccount.businessLicenseUrl`) are served **only** through an authenticated, RBAC-checked endpoint that mints a short-lived presigned URL | Self-hosted, S3-API-compatible, same compose stack. Never a public bucket path for trade/identity documents. |
| Deployment target | Local: `docker compose up -d` (postgres/redis/minio) with `apps/api`+`apps/web` on the host via `pnpm turbo run dev`. Remote: single VPS from `.env.deploy` (`DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_PATH`/`DEPLOY_PLATFORM`), `docker-compose.prod.yml` + Caddy, deployed over SSH. | Matches the explicit single-VPS / docker-compose / no-microservices constraint. Secrets live only in `.env` / `.env.deploy` (gitignored) or CI env — never in compose files, Dockerfiles, planning docs or git. |
| Directory layout | `apps/api/src/modules/<domain>/` (controllers, services, DTOs, strategies co-located per domain — **not** split by technical layer), `apps/api/src/common/` (guards, decorators, pipes), `apps/web/src/app/[locale]/...` | Feature ownership stays in one folder. A domain module exports only what other modules need (e.g. `PricingModule` exports `PriceResolutionService`). |

## Stack Touched in Phase 1

- [ ] Project scaffold — pnpm workspace, Turborepo pipeline (`build`/`dev`/`lint`/`test`/`typecheck`), TypeScript 5.9 `strict: true`, ESLint + Prettier, Jest on `apps/api`
- [ ] Routing — real bilingual routes: `/[locale]/catalog`, `/[locale]/catalog/[slug]`, `/[locale]/login`, `/[locale]/admin/products`; real API routes: `POST /auth/login`, `GET /catalog/products`, `POST /admin/products`
- [ ] Database — real read (`GET /catalog/products` → `product_translations` + `price_list_entries` + `variant_stock`) AND real write (`POST /auth/register` → `accounts`; `POST /admin/products` → `products` + `product_translations` + `product_variants`)
- [ ] Object storage — real MinIO upload (product image, business license) and authenticated presigned-URL read
- [ ] UI — interactive elements wired to the API: login form, locale switcher, catalog facet filters, admin product create form
- [ ] Deployment — **skeleton criterion satisfied by** the documented local full-stack run command (`docker compose up -d && pnpm turbo run dev`); **additionally**, Plan 09 deploys the Phase 1 skeleton to the target VPS over SSH as the ongoing build/test/deploy target

## Out of Scope (Deferred to Later Slices)

Explicitly NOT in the walking skeleton. This list exists so later phases do not re-litigate Phase 1's minimalism:

- **Any visual design system, theming, component library or responsive polish.** Phase 1 UI is functional-but-unstyled HTML forms and lists. Phases 3, 4 and 7 carry the `UI hint: yes` flag and own design work.
- **Separate `apps/dealer-portal` and `apps/admin` Next.js apps** — Phase 4 and Phase 7 respectively.
- **The real B2B approval workflow** (proof-document review queue, rejection reasons surfaced to the dealer, tier assignment UI) — that is B2B-02/B2B-03, Phase 4. Phase 1 ships only a minimal RBAC-gated `PATCH /admin/business-accounts/:id/approval` endpoint plus a seeded pre-approved dealer, purely to prove viewer-aware pricing end to end.
- **Quantity-break discounts** (B2B-05, Phase 4). The `PriceListEntry.minQty` column and the "highest qualifying `minQty`" lookup exist from the first migration, but no Phase 1 requirement exercises `minQty > 1` beyond a unit test.
- **Real inventory.** `VariantStock(quantityOnHand, reorderThreshold)` is a single-row-per-variant stub that satisfies CATALOG-08's status indicator only. Phase 2 (INV-01..08) replaces the storage behind it with a SKU × Warehouse × Batch ledger; the API read contract ("available quantity for a variant") must stay stable across that migration.
- **Cart, checkout, payment, shipping, orders, reviews** — Phase 3.
- **Meilisearch product search.** Phase 1 filtering is indexed Postgres facet columns (`ageRangeMin`/`ageRangeMax`, `categoryId`, `brandId`, `origin`) queried through Prisma. Full-text/typo-tolerant search arrives when catalog volume justifies it.
- **BullMQ background jobs, Puppeteer PDF generation, ExcelJS import/export, barcode/QR rendering.** Redis runs in the compose stack from day one, but no queue is wired in Phase 1. Password-reset "email" is written to the structured log with the reset URL; a real SMTP/Zalo transport is a later concern.
- **Backend API-error i18n (`nestjs-i18n`)** — CATALOG-09 covers bilingual *catalog content*; ADMIN-04 covers the bilingual *admin interface* and is Phase 7.
- **Two-factor auth (AUTH-06), audit logging (ADMIN-02), multi-currency** — v2 / later phases / explicitly out of scope.
- **Automated off-VPS backups and a rehearsed restore runbook.** Named volumes and `restart: unless-stopped` land in Phase 1; the `pg_dump` cron + tested restore is flagged as a carried-forward concern (PITFALLS.md Pitfall 6) to close before real customer data exists.

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton **without altering its architectural decisions** — no new ORM, no second identity table, no second price column, no non-translated text field.

- **Phase 2 — Inventory:** Admin moves stock between warehouses at SKU × Warehouse × Batch grain through one atomically-reserved ledger. Replaces the `VariantStock` stub behind the existing catalog read contract.
- **Phase 3 — B2C storefront:** Retail customer adds to cart, checks out with COD or VNPay, tracks the order. Consumes `PriceResolutionService` (retail tier) and the Phase 2 ledger.
- **Phase 4 — B2B dealer portal:** Business applies, admin approves onto a tier, dealer orders in cartons/RFQ/Excel within a credit limit. Consumes the same `PriceResolutionService`, now exercising `minQty` quantity breaks, and adds `apps/dealer-portal`.
- **Phase 5 — Import/export & landed cost:** Shipment tracked from foreign supplier through customs into a cost-accurate inventory batch created by Phase 2's ledger.
- **Phase 6 — Sales, customers & reporting:** One unified view over Phase 3 + Phase 4 orders, invoices, debt and revenue.
- **Phase 7 — Admin console, content & i18n polish:** Dedicated `apps/admin` with audit log, Excel import/export, dashboard, banners/news/flash-sales — all reusing the Phase 1 `Account`/`StaffRole` RBAC and translation-table pattern.

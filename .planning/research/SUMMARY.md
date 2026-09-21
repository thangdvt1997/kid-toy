# Project Research Summary

**Project:** kid-toy — Vietnamese toy import/export B2C + B2B e-commerce platform
**Domain:** Dual-channel (B2C retail storefront + B2B wholesale/dealer portal) e-commerce with integrated import/export document tracking and multi-warehouse batch-tracked inventory
**Researched:** 2026-09-21
**Confidence:** MEDIUM-HIGH

## Executive Summary

This is a shared-backend, multi-frontend commerce platform: one catalog, one inventory ledger, one pricing engine, serving two structurally different buyer experiences (anonymous/browse-and-buy retail parents, and account-gated bulk-ordering dealers) plus an import/export operations module that most e-commerce platforms don't need. Experts build this exact shape — "unified commerce" (confirmed across OroCommerce, Spree, WizCommerce research) — as a modular monolith with channel-aware pricing/inventory resolved server-side per request, not as two separate systems synced after the fact. For this project that maps to a NestJS 11 modular monolith (one module per business domain: catalog, pricing, inventory, sales, import-export, customers), three separate Next.js 16 frontends (storefront, dealer portal, admin) sharing types via a pnpm/Turborepo monorepo, PostgreSQL 17 as the single source of truth, and Redis/BullMQ for async work — all deployable on a single VPS via Docker Compose with Caddy handling TLS.

The recommended approach front-loads the hardest, highest-leverage decisions: design the pricing-tier engine, the batch/lot-tracked inventory model (SKU × Warehouse × Batch, not SKU × Warehouse), and the bilingual content schema *before* either storefront is built, because every pitfall identified in research is a variation of "the schema was built B2C-first/SKU-first/single-language-first and B2B/lot-tracking/English was bolted on later." The stack itself is low-risk and well-documented (NestJS, Next.js, Prisma, PostgreSQL, Redis all HIGH confidence); the genuine risk concentrates in domain logic correctness — atomic inventory reservation across two concurrent channels, atomic credit-limit enforcement, landed-cost allocation per batch, and treating payment-gateway IPN/webhooks (not browser return URLs) as the only source of truth for "paid." None of these are stack problems; all are schema/transaction-design problems that must be solved in the first 1-2 phases, because every one of them is expensive to retrofit (HIGH-cost migrations per PITFALLS.md) once real orders/dealers/inventory exist.

Key risk mitigation: sequence phases so the shared foundation (auth/RBAC, bilingual catalog schema, tiered-pricing model, batch-tracked multi-warehouse inventory with atomic reservation) lands before B2C checkout, B2B ordering, or import/export document work is built on top of it. Payment-gateway integration (VNPay has a mature community SDK; MoMo/ZaloPay require direct REST+HMAC integration) and single-VPS deployment reliability (backups, restart policies, DB port exposure) both need dedicated attention early — "walking skeleton" deploy in phase 1-2, not deferred to launch.

## Key Findings

### Recommended Stack

Node.js 24 LTS + TypeScript 5.9 + NestJS 11.1.x (not 12 — too new, ecosystem hasn't caught up) on the backend; Next.js 16 App Router + React 19 for all three frontends (storefront, dealer portal, admin), sharing types through a pnpm/Turborepo monorepo. PostgreSQL 17 is the system of record; Prisma 7 (not 8, still RC and missing needed transaction-isolation features) is the ORM. Redis 7 backs BullMQ (async PDF/Excel/notification jobs), caching, and rate limiting. MinIO provides self-hosted S3-compatible object storage for product media and trade documents. Caddy handles TLS/reverse-proxy for the single-VPS Docker Compose deployment.

**Core technologies:**
- NestJS 11.1.x: backend API, all business logic — CommonJS, battle-tested, avoids NestJS 12's unproven full-ESM rewrite
- Next.js 16 (App Router) + React 19: three separate frontend apps (SEO-driven storefront needs different caching/IA than gated B2B tooling)
- PostgreSQL 17 + Prisma 7: relational integrity for concurrent order/inventory/pricing writes; Prisma Studio aids non-technical staff
- Redis 7 + BullMQ: single instance backing cache, sessions, and async job queue (PDF generation, Excel processing, notifications)
- Custom JWT/Passport auth (not NextAuth): backend-owned so the same auth serves all three frontends without runtime coupling
- vnpay/nestjs-vnpay (mature library) + direct REST+HMAC for MoMo and ZaloPay (no trustworthy first-party npm SDKs exist for either)
- ExcelJS (not `xlsx`/SheetJS — abandoned with unpatched CVEs) for B2B bulk-order/import/export Excel handling
- Puppeteer for layout-sensitive trade documents (PO, commercial invoice, packing list); run as BullMQ job, not inline

Full detail: `.planning/research/STACK.md`

### Expected Features

Research confirms the project's own requirements are correctly scoped, with genuine domain-specific table stakes (not just generic e-commerce checklist items) around toy safety certification, carton/case ordering, and import traceability.

**Must have (table stakes):**
- Multi-axis catalog (age range, category, brand, origin) with structured min/max age and safety-cert (QCVN 3:2019/BKHCN "hợp quy") fields — this is a real Vietnamese regulatory requirement, not just UX polish
- Dual pricing resolved per-viewer (retail visible to B2C, tiered wholesale visible to approved B2B accounts) — architectural decision, not a UI toggle
- Dealer registration + manual admin approval + tier-based price lists + quantity-break discounts + MOQ enforcement
- Carton/case-multiple ordering (unit vs. thùng/kiện) built on packaging-spec data per SKU
- Multi-warehouse, batch/lot-tracked inventory as a single shared ledger between B2C and B2B (non-negotiable per project's core value — no separate stock pools)
- Import/export tracking: supplier registry, PO, structured records + attachments for Commercial Invoice/Packing List/B/L/C-O, shipment status pipeline, exchange-rate capture, landed cost per batch
- Credit limit / debt (công nợ) enforcement at order commit, RFQ flow for large/custom orders, bilingual (VI/EN) content throughout

**Should have (competitive differentiators):**
- Genuinely unified catalog/inventory model serving both channels (the platform's core architectural bet)
- Batch/lot traceability surfaced to B2B buyers as a trust/provenance report
- Landed-cost-aware margin visibility (true cost after freight/duty, not FOB)
- Age+occasion+budget faceted discovery for gift-buying context; combo/bundle products; flash sales

**Defer (v2+):**
- Marketplace sync (Shopee/Lazada/TikTok Shop), ERP/accounting/CRM integration, AI recommendations/chatbot, multi-currency, full FCL container self-service pre-booking, dedicated mobile scanning app, e-invoice integration

Full detail: `.planning/research/FEATURES.md`

### Architecture Approach

NestJS modular monolith (one module per business domain, not per technical layer) behind a single PostgreSQL instance, serving three separate Next.js apps over REST/JWT. Orders live in one table with a `channel` discriminator (retail/wholesale) rather than two order systems, avoiding duplicated lifecycle logic. A single `PriceResolutionService` is the only code path allowed to compute a price — never trust a client-sent price. Heavy/slow/external-facing work (PDF generation, Excel processing, notifications) runs async via BullMQ, not inline in the request cycle.

**Major components:**
1. NestJS API (`apps/api`) — single source of truth for all business logic and the only component with direct DB/Redis/MinIO credentials; modules: auth, catalog, pricing, inventory, sales, customers, import-export, shipping, payments, content, admin, notifications
2. Three Next.js frontends (`storefront`, `dealer-portal`, `admin`) — divergent IA/caching/bundle needs justify separate apps, not route groups within one app; share types via `packages/shared-types` and `packages/api-client`
3. PostgreSQL (schemas: catalog, pricing, inventory, sales, import_export, customers, content, auth, audit) — single instance, logical schema separation
4. Redis (BullMQ queues + cache + sessions) and MinIO (product media, generated PDFs/Excel) as supporting single-VPS services behind Caddy

Full detail: `.planning/research/ARCHITECTURE.md`

### Critical Pitfalls

1. **B2C-first schema retrofitted with B2B flags** — model `price_list`/tier as first-class entities from day one, not a second `gia_si` column; retrofitting a real pricing engine after orders exist is a HIGH-cost migration.
2. **Inventory oversell across B2C+B2B sharing one stock pool** — check-and-reserve must be one atomic conditional UPDATE (or `SELECT FOR UPDATE`), with an explicit `reserved_qty` distinct from `available_qty`; COD and B2B credit orders need a stock hold with no payment event to trigger it.
3. **Landed cost computed as purchase-price-only** — must allocate freight/duty/insurance/handling per shipment down to SKU/lot by value or weight, snapshot exchange rate at settlement, and attach cost to the lot/batch (not the SKU) since the same SKU imported twice can have different landed costs.
4. **Batch/lot tracking bolted onto an already-built SKU-only inventory model** — design inventory from the start as `(sku, warehouse, lot)` grain; retrofitting is a HIGH-cost migration requiring backfill and rewriting every stock-mutation code path.
5. **Trusting payment gateway return URLs instead of server-to-server IPN** — the browser return URL is UX-only; only the signed IPN/webhook (with signature verification and idempotency via gateway transaction ID) may mark an order paid. This is a direct free-goods exploit if skipped.
6. **Single-VPS Docker treated as set-and-forget** — untested backups, missing `restart: unless-stopped`, and DB ports exposed via Docker's iptables manipulation (bypassing ufw) are common production post-mortem causes; must be addressed in an early "walking skeleton" deploy phase.

Full detail: `.planning/research/PITFALLS.md` (9 critical pitfalls total, all mapped to a specific phase)

## Implications for Roadmap

Based on combined research, the dependency chain is clear and consistent across all four research files: **foundation (auth, bilingual schema, pricing model, inventory model) must land before either storefront or B2B ordering is built on top of it**, and **import/export + batch/lot tracking must be designed together** since landed cost attaches to the lot, not the SKU.

### Phase 1: Foundation — Auth, Bilingual Catalog Schema, Pricing Engine, Monorepo/Deploy Skeleton
**Rationale:** Every subsequent phase reads from these models; PITFALLS.md identifies schema-first design here as the single highest-leverage decision (Pitfalls 1 and 9 are both "cheap to build in now, HIGH cost to retrofit").
**Delivers:** pnpm/Turborepo monorepo scaffold; NestJS auth module (JWT/Passport, RBAC roles: admin/staff/dealer/customer); bilingual (`locale`-dimensioned) catalog/CMS schema with per-locale slugs; `price_list`/tier entities and a stub `PriceResolutionService`; walking-skeleton Docker Compose deploy (Caddy, Postgres, Redis, named volumes, `restart: unless-stopped`, backup cron, DB port bound to internal network only).
**Addresses:** Catalog table stakes, dual-pricing foundation, bilingual VI/EN requirement.
**Avoids:** Pitfall 1 (B2C-first schema), Pitfall 9 (late bilingual retrofit), Pitfall 6 (VPS reliability as afterthought).

### Phase 2: Multi-Warehouse Batch-Tracked Inventory Core
**Rationale:** Both B2C checkout and B2B ordering (and import-export receiving) consume the same reservation API; ARCHITECTURE.md and PITFALLS.md both flag this as needing to exist before either channel's ordering flow is built.
**Delivers:** `(sku, warehouse, lot)`-grain stock model with `available_qty`/`reserved_qty`; atomic reserve/commit/release inventory service; movement-log-driven stock in/out/transfer with an explicit in-transit state; low-stock alerts.
**Uses:** PostgreSQL transactions/`SELECT FOR UPDATE`, Redis for cached stock summaries.
**Implements:** `inventory` module from ARCHITECTURE.md, single shared ledger (Anti-Pattern 1 avoidance).
**Avoids:** Pitfall 2 (oversell race), Pitfall 4 (SKU-only retrofit), Pitfall 8 (transfer atomicity).

### Phase 3: B2C Storefront — Catalog Browse, Cart, Checkout, Payments
**Rationale:** Now that pricing and inventory foundations exist, the retail channel can be built end-to-end without retrofitting; payment-gateway correctness is isolated to this phase per PITFALLS.md recommendation (definition of done includes IPN, not just happy path).
**Delivers:** Storefront Next.js app (SSR/ISR catalog+PDP), cart, checkout, COD + one payment gateway (VNPay first — most mature library) with signed-IPN-only payment-status writes, order tracking, reviews.
**Addresses:** General B2C table stakes, safety-cert display on PDP.
**Avoids:** Pitfall 5 (return-URL-as-truth).

### Phase 4: B2B Dealer Portal — Approval, Tiered Pricing, Carton Ordering, Credit
**Rationale:** Depends on Phase 1's pricing-tier model and Phase 2's inventory reservation API; FEATURES.md dependency graph shows carton ordering and Excel reorder both require tiered pricing + carton-spec data to exist first.
**Delivers:** Dealer registration + admin approval workflow; tier price lists + quantity-break discounts; carton/unit toggle with MOQ; Excel/SKU quick reorder; RFQ flow; credit-limit enforcement as an atomic conditional update tied to a debt ledger (not a UI-only check).
**Addresses:** All B2B table stakes from FEATURES.md.
**Avoids:** Pitfall 7 (credit-limit race condition), Pitfall 2 (shared reservation, not a second decrement path).

### Phase 5: Import/Export & Landed Cost
**Rationale:** Can proceed in parallel with Phase 3/4 once inventory (Phase 2) exists, since batch/lot identity originates at import; landed cost and batch tracking are "the same underlying data problem" per PITFALLS.md and must be designed together.
**Delivers:** Supplier registry, PO tracking, structured Commercial Invoice/Packing List/B-L/C-O records + attachments, shipment status pipeline, exchange-rate capture per shipment, landed-cost allocation attached to the lot (simple average acceptable for v1, sophisticated allocation deferred to v1.x).
**Addresses:** Import/export table stakes, traceability differentiator groundwork.
**Avoids:** Pitfall 3 (landed cost miscalculation).

### Phase 6: Admin Console, RBAC Hardening, Reporting, i18n Polish
**Rationale:** Cross-cuts everything built so far; audit logging and reporting are only meaningful once real transactional data exists in prior phases.
**Delivers:** Admin app (product/inventory/order/customer management, RBAC enforcement at API layer, audit log via interceptor), Excel import/export validation hardening, margin/revenue reports (precomputed, not live-joined per PITFALLS.md performance guidance), 2FA before broad B2B self-registration.

### Phase Ordering Rationale

- Pricing and inventory models are prerequisites for both B2C and B2B, so they must precede both storefronts (confirmed independently by FEATURES.md's dependency graph, ARCHITECTURE.md's data-flow diagram, and PITFALLS.md's phase mapping for Pitfalls 1, 2, and 4).
- Payment-gateway correctness is scoped to its own phase's definition-of-done (IPN + signature + idempotency tests) rather than a later hardening pass, per PITFALLS.md explicit recommendation.
- Import/export and batch/lot tracking are grouped because landed cost is lot-attached, not SKU-attached — building them separately risks the exact retrofit PITFALLS.md warns against.
- Deployment reliability (backups, restart policy, network exposure) is pulled into Phase 1 as a "walking skeleton" rather than deferred to a final launch phase, since retrofitting backup/security onto a live system with real orders is riskier than building it in from the first deploy.

### Research Flags

Needs deeper research during planning:
- **Phase 3 (payments):** MoMo/ZaloPay have no trustworthy first-party npm SDK — direct REST+HMAC implementation needs careful validation of signature schemes and amount-format quirks before coding.
- **Phase 5 (landed cost allocation):** the allocation algorithm (by value/weight/volume across multi-SKU shipments) is flagged HIGH complexity in FEATURES.md and needs a concrete spec before implementation.
- **Phase 4 (credit limit / debt ledger):** needs a concrete decision on hard-block vs. sales-rep-mediated approval queue behavior before building the transaction logic.

Standard patterns (skip research-phase):
- **Phase 1 (auth/RBAC, monorepo, deploy skeleton):** well-documented NestJS/Next.js/Docker Compose patterns.
- **Phase 2 (inventory reservation):** atomic conditional-UPDATE / SELECT FOR UPDATE pattern is standard and well-corroborated (multiple sources including a real medusajs production fix).
- **Phase 6 (admin/RBAC/reporting):** standard NestJS interceptor-based audit logging and materialized-view reporting patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core technologies (NestJS, Next.js, Prisma, PostgreSQL, Redis) verified via Context7/official docs; MEDIUM confidence specifically on MoMo/ZaloPay integration approach since no first-party maintained npm SDK exists for either |
| Features | MEDIUM-HIGH | B2B/B2C commerce patterns HIGH (multiple corroborating vendor/industry sources); Vietnamese toy safety regulation HIGH (official government/legal source); import/export document workflow MEDIUM (verified against trade-doc software vendors, not a live customs system) |
| Architecture | MEDIUM-HIGH | Patterns verified across multiple current sources (OroCommerce, Spree, WizCommerce) and consistent with NestJS official module conventions; single-VPS compose topology cross-checked against multiple production-deployment write-ups |
| Pitfalls | MEDIUM-HIGH | Inventory/costing/schema pitfalls verified across multiple independent sources including a real production bug-fix PR; VNPay/MoMo/ZaloPay specifics verified against integration guides/QA write-ups but not against a live merchant account; single-VPS Docker pitfalls verified against multiple production post-mortems |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- MoMo and ZaloPay integration: no first-party maintained SDK confirmed at research time — validate `@zalopay-oss/zalopay-nodejs` maintenance recency before adoption, and plan on direct REST+HMAC for MoMo. Flag for validation at the start of Phase 3/5's payment work.
- Landed-cost allocation methodology (by value/weight/volume) is described conceptually but not spec'd to an exact formula — needs a concrete decision (likely by-value allocation as the default) before Phase 5 implementation.
- Credit-limit breach behavior (hard block vs. sales-rep approval queue) is explicitly left as an open product decision in PITFALLS.md — needs resolution before Phase 4.
- Exact NestJS 11.1.x / nestjs-vnpay compatibility should be re-verified against the exact minor versions in use at implementation time, since third-party wrapper libraries lag core framework releases.
- Import/export document workflow research is grounded in trade-documentation SaaS vendor patterns, not a live Vietnamese customs system — the "tracker/repository, not document-of-record generator" scope decision should be re-confirmed with actual import/export staff during Phase 5 planning.

## Sources

### Primary (HIGH confidence)
- Context7 `/nestjs/nest`, `/lehuygiang28/vnpay`, `/lehuygiang28/nestjs-vnpay` — framework/library version and maintenance verification
- Next.js 16 official blog (nextjs.org/blog/next-16-3) and upgrade docs (nextjs.org/docs/app/guides/upgrading/version-16)
- Prisma ORM release status (prisma.io/docs/prisma-orm/release-status) — official docs
- PostgreSQL release notes (postgresql.org/docs/release/), Node.js releases (nodejs.org/en/about/previous-releases)
- thuvienphapluat.vn — QCVN 3:2019/BKHCN An toàn đồ chơi trẻ em — Vietnamese toy safety regulation
- Trade.gov — Common Export Documents (trade.gov/common-export-documents)
- Project source documents: D:\Work\Work-out\kid-toy\.planning\PROJECT.md, D:\Work\Work-out\kid-toy\requirements.txt.txt

### Secondary (MEDIUM confidence)
- OroCommerce — Unified Commerce Architecture, WizCommerce B2B architecture, Spree multi-store
- Zoey — B2B ecommerce for toy sellers, Finale Inventory landed cost guide
- Docker Compose in Production on a Single VPS: An Honest Audit (jguillaumesio.com)
- medusajs/medusa PR #16575 — real-world oversell bug fix
- MoMo Developers portal (developers.momo.vn), ZaloPay Node.js SDK (github.com/zalopay-oss/zalopay-nodejs)

### Tertiary (LOW confidence)
- Wholesale Suite — credit limit plugin — plugin vendor, corroboration only
- WebSearch aggregate findings on Caddy vs. Nginx, monorepo tooling conventions — community consensus, no single authoritative source

---
*Research completed: 2026-09-21*
*Ready for roadmap: yes*

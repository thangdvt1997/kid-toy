# Architecture Research

**Domain:** B2C + B2B e-commerce platform (toy import/export/wholesale/retail), shared backend
**Researched:** 2026-09-21
**Confidence:** MEDIUM-HIGH (architecture patterns verified against multiple current sources; specifics tuned to this project's stated stack/constraints)

## Standard Architecture

### System Overview

The dominant pattern for "one backend, two storefronts" B2B+B2C commerce (confirmed across OroCommerce, Spree, Shopify B2B, Adobe Commerce hybrid write-ups) is: **shared catalog/inventory/customer/order data**, **channel-specific pricing resolved at request time**, and **separate frontend experiences** because B2C and B2B buyers need fundamentally different IA (browse-and-buy vs. account-gated bulk ordering, quotes, credit terms). For this project, that maps onto a **NestJS modular monolith** (not microservices — explicitly out of scope per constraints) behind a single Postgres database, with three thin Next.js frontends and shared TypeScript packages in a monorepo.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              EDGE (Caddy)                                  │
│         TLS termination, host/path routing, gzip/br compression            │
├───────────────┬───────────────────┬───────────────────┬───────────────────┤
│  storefront.   │  dealer.          │  admin.            │  api.             │
│  domain (B2C)  │  domain (B2B)     │  domain (backoff.) │  domain (REST)    │
├───────────────┼───────────────────┼───────────────────┼───────────────────┤
│  Next.js       │  Next.js          │  Next.js           │  NestJS API       │
│  Storefront    │  Dealer Portal    │  Admin Console     │  (all business    │
│  (SSR/ISR)     │  (SSR + auth)     │  (SPA-ish, auth)   │   logic lives     │
│                │                   │                    │   here)           │
└───────┬────────┴─────────┬─────────┴─────────┬──────────┴─────────┬────────┘
        │  fetch (HTTPS, server + client)       │                    │
        └────────────────────┴───────────────────┴────────────────────┘
                                       │
                                       ▼
                        ┌───────────────────────────────┐
                        │      NestJS Modular Monolith   │
                        │  Auth/RBAC │ Catalog │ Pricing  │
                        │  Inventory │ Orders  │ Customers│
                        │  Import-Export │ Warehouse      │
                        │  Payments  │ Shipping │ Content │
                        │  Admin/Audit │ Notifications    │
                        └───────┬──────────────┬─────────┘
                                │              │
                     ┌──────────┘              └───────────┐
                     ▼                                      ▼
          ┌───────────────────┐                  ┌────────────────────┐
          │   PostgreSQL       │                  │   Redis             │
          │  (schemas: catalog,│                  │  BullMQ queues,     │
          │  pricing, inventory│                  │  cache, sessions     │
          │  sales, import_    │                  └────────────────────┘
          │  export, customers,│
          │  content, auth,    │                  ┌────────────────────┐
          │  audit)            │                  │   MinIO (S3-compat) │
          └───────────────────┘                  │  product images/    │
                                                    │  video, PO/invoice  │
                                                    │  PDFs, Excel exports│
                                                    └────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Storefront (B2C) | Browse/search catalog, cart, checkout, COD + VNPay/MoMo/ZaloPay, order tracking, reviews | Next.js App Router, SSR for SEO on product/category pages, client cart state |
| Dealer Portal (B2B) | Dealer registration/approval flow, tiered price lists, quantity discounts, carton/pallet ordering, quote requests, SKU/Excel bulk order, credit/debt view | Next.js, auth-gated (no public SEO pages needed), heavier data-grid UI |
| Admin Console | Product/inventory/order/customer management, RBAC, audit log, Excel import/export, import-export document management, dashboards | Next.js, internal-only, staff RBAC-gated |
| NestJS API | Single source of truth for all business logic and data access; only component that talks to Postgres/Redis/MinIO directly | Modular monolith, one module per domain (see below) |
| PostgreSQL | System of record: products, pricing, inventory, orders, customers, import/export docs, content, audit log | Single instance, logical separation via Postgres schemas |
| Redis | Job queues (BullMQ) for async work: import/export doc processing, low-stock alerts, email/SMS/Zalo notifications, Excel export generation; also API response caching | Single instance, persisted volume |
| MinIO | Object storage for product images/video, invoice/BOL/C-O PDFs, generated Excel/QR/barcode files | S3-compatible, single bucket set, signed URLs for private docs |
| Caddy | Reverse proxy, automatic Let's Encrypt TLS, host-based routing to the 4 app containers | Config-as-code Caddyfile, no manual cert renewal |

## Recommended Project Structure

Use a **monorepo** (pnpm workspaces + Turborepo) so the three frontends and the API share types, an API client, and a design system. This also lets B2C and B2B ship in parallel from day one (per the project's explicit "B2C and B2B in parallel" constraint) without duplicating domain types.

```
kid-toy/
├── apps/
│   ├── api/                     # NestJS backend — single source of truth
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/            # JWT, RBAC guards, dealer/staff/customer roles, 2FA
│   │   │   │   ├── catalog/         # products, variants/SKU, categories, brands, attributes
│   │   │   │   ├── pricing/         # retail price, dealer tier price lists, qty-break rules
│   │   │   │   ├── inventory/       # warehouses, stock, batches/lots, transfers, low-stock
│   │   │   │   ├── sales/           # orders (retail+wholesale), quotes, invoices, payments
│   │   │   │   ├── customers/       # retail profiles, dealer accounts, approval, credit limit
│   │   │   │   ├── import-export/   # suppliers, PO, CI, packing list, BOL, C/O, customs, landed cost
│   │   │   │   ├── shipping/        # fee calc, carrier integration
│   │   │   │   ├── payments/        # COD, VNPay/MoMo/ZaloPay adapters + webhooks
│   │   │   │   ├── content/         # news, banners, flash sale, combos, SEO fields
│   │   │   │   ├── admin/           # audit log, Excel import/export, system config
│   │   │   │   └── notifications/   # email/SMS/Zalo, BullMQ processors
│   │   │   ├── common/              # guards, interceptors, pipes, decorators
│   │   │   └── main.ts
│   │   └── Dockerfile
│   ├── storefront/              # Next.js — B2C public site
│   ├── dealer-portal/           # Next.js — B2B, auth-gated
│   └── admin/                   # Next.js — internal backoffice
├── packages/
│   ├── shared-types/            # DTOs/interfaces shared API ↔ frontends (generated or hand-kept)
│   ├── api-client/              # typed fetch wrapper per frontend (storefront/dealer/admin scopes)
│   ├── ui/                      # shared design tokens/components (buttons, form fields)
│   └── i18n/                    # vi/en message catalogs, shared across all 3 frontends
├── docker-compose.yml
├── docker-compose.prod.yml
├── Caddyfile
└── .planning/
```

### Structure Rationale

- **`apps/api/src/modules/*`:** one module per business domain, not per technical layer — avoids the classic "controllers/ services/ repositories" split that scatters a single feature across three unrelated folders and makes ownership fuzzy. Each module exports only what other modules need (e.g., `pricing` exports a `PriceResolutionService`, `inventory` exports `StockService`) — no reaching into another module's internals.
- **Three separate Next.js apps, not one app with route groups:** B2C and B2B have divergent IA (SEO-driven catalog browsing vs. gated bulk-order tooling), different caching strategies (ISR for storefront, no-cache for dealer pricing), and different bundle concerns (B2B pricing/quote UI should never ship to anonymous B2C visitors). Separate apps also let the two ship and deploy independently, matching the "parallel from MVP" constraint. Admin is kept separate from the dealer portal because RBAC/audit tooling is a different concern from B2B commerce UX, even though both are "internal."
- **`packages/shared-types` and `packages/api-client`:** prevents each frontend from re-declaring the same `Product`/`Order`/`DealerTier` shapes and re-implementing fetch/auth-refresh logic three times — single point of truth for the contract with the API.
- **No separate microservice per domain:** explicitly out of scope per project constraints (single VPS, no microservices at v1). Domain boundaries are enforced at the module/TypeScript level, which is enough to split out a service later if needed (e.g., import-export or notifications could become standalone services in a future milestone without a rewrite, because they're already isolated modules).

## Architectural Patterns

### Pattern 1: Single Orders Table with Channel Discriminator, Not Two Order Systems

**What:** Retail (B2C) and wholesale (B2B) orders share one `orders` table with a `channel` enum (`retail` | `wholesale`) and a `status` state machine common to both. B2B-only fields (PO number, credit terms, approval state, quote reference, carton/pallet quantities) live in a `wholesale_order_details` 1:1 extension table rather than nullable columns bolted onto `orders`.
**When to use:** Whenever the two channels share inventory, fulfillment, and reporting — which is this project's explicit core value ("both flows run on the same product catalog and accurate inventory").
**Trade-offs:** Slightly more join complexity for B2B-specific queries; but avoids duplicating order lifecycle logic (payment status, fulfillment, returns) in two places, which is the #1 cause of inventory drift in hybrid platforms.

**Example:**
```typescript
// orders.entity.ts
export enum OrderChannel { RETAIL = 'retail', WHOLESALE = 'wholesale' }

@Entity({ schema: 'sales' })
export class Order {
  @Column({ type: 'enum', enum: OrderChannel })
  channel: OrderChannel;

  @Column()
  customerId: string; // FK to customers.customer (both retail + dealer)

  @OneToOne(() => WholesaleOrderDetail, (d) => d.order, { nullable: true })
  wholesaleDetail?: WholesaleOrderDetail; // present only when channel = wholesale
}
```

### Pattern 2: Centralized Price Resolution Service

**What:** A single `PriceResolutionService` in the `pricing` module is the only code path allowed to compute a price for a SKU. Given `(sku, customerId | dealerTier, quantity)`, it resolves: base retail price → applicable dealer price list (by tier) → quantity-break override → active promotion. Both the storefront and dealer portal call the same catalog endpoint; the API decides what price to return based on the caller's auth context — the frontend never computes or is trusted to state a price.
**When to use:** Any time retail price and one-or-more wholesale tiers exist on the same SKU (this project has exactly that: "bảng giá riêng theo cấp đại lý, chiết khấu theo số lượng").
**Trade-offs:** Adds one more service to the critical path of every catalog/cart request; mitigate with Redis caching of resolved price lists (invalidate on price-list update), not per-request caching of final prices (which must reflect live quantity-break logic).

### Pattern 3: Async Document/Workflow Processing via Queue, Not Inline Requests

**What:** Import/export document generation (commercial invoice PDFs, packing lists), Excel import/export for bulk dealer orders and admin catalog uploads, low-stock alert emails, and Zalo/SMS notifications are all pushed to BullMQ jobs (Redis-backed) rather than handled synchronously in the HTTP request.
**When to use:** Any operation that touches an external system (payment gateway webhook aside), generates a file, or could take >1-2s — keeps API response times predictable and lets the single VPS handle traffic spikes (e.g., a dealer uploading a 2,000-row Excel order) without blocking other requests.
**Trade-offs:** Requires a job status/polling or webhook-back pattern on the frontend for long operations; worth it given this project's heavy document/report surface (PO, CI, packing list, BOL, C/O, revenue reports).

## Data Flow

### Request Flow (example: dealer places a bulk order)

```
Dealer Portal (Next.js)
    ↓ POST /dealer/orders (JWT: dealer role, tier B)
NestJS: AuthGuard → RBAC check → OrdersController
    ↓
OrdersService.createWholesaleOrder()
    ↓                              ↓
PriceResolutionService        InventoryService.reserveStock()
(resolve tier-B price          (check SKU/warehouse availability,
 + qty-break per line)          decrement reservable qty)
    ↓                              ↓
    └──────────► Order + WholesaleOrderDetail persisted (Postgres, txn)
                            ↓
                 BullMQ job: generate order confirmation,
                 notify assigned sales rep, check credit limit
                            ↓
                 Response ← Order summary (status: pending_approval | confirmed)
```

### Key Data Flows

1. **Catalog read (both channels):** Both frontends hit the same `GET /catalog/products` family of endpoints; the API strips/includes dealer pricing fields based on auth context. There is one product/SKU/inventory dataset — no per-channel catalog duplication.
2. **Import → Inventory → Costing:** Supplier PO → shipment received → `import-export` module records landed cost (goods + freight + duty, converted at recorded exchange rate) → `inventory` module creates a stock batch/lot with that cost → `pricing`/`sales` reporting modules read cost basis from the batch for margin reports. This is a one-directional pipeline: import-export never reads back from sales, only inventory does.
3. **Order → Payment → Fulfillment:** Order created (pending) → payment leg (COD marks pending-on-delivery; VNPay/MoMo/ZaloPay redirect + webhook confirms) → `sales` module transitions order status → `inventory` module commits the stock reservation → notification job fires to customer.
4. **Admin/audit:** Every mutating admin action (price change, stock adjustment, dealer approval) writes to an `audit` schema table via a NestJS interceptor, independent of the domain transaction, so it can't be bypassed by calling a service method directly.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Launch / 0-5k orders/mo | Exactly the topology above on one VPS. Modular monolith, single Postgres, Redis for queue+cache, MinIO for assets. This comfortably fits a 4-8GB VPS. |
| Growth / dealer volume rises | First bottleneck is almost always Postgres read load from catalog browsing + reporting queries — add read replicas or move heavy reports to scheduled materialized views before touching the app architecture. Add a CDN (Cloudflare in front of Caddy) for product images/static assets. |
| 100k+ users or multi-warehouse at scale | Only then consider splitting `import-export` and `notifications` modules into standalone services (they're already module-isolated, so this is a lift-and-shift, not a rewrite). Move MinIO to managed S3/R2. Not a near-term concern for this project. |

### Scaling Priorities

1. **First bottleneck:** Postgres under combined catalog-browse (B2C) + reporting (B2B/admin) read load. Fix: add indexes on the actual query patterns once real traffic exists, add Redis caching for catalog reads, defer read replicas until proven necessary.
2. **Second bottleneck:** Image/video delivery bandwidth from a single VPS. Fix: put Cloudflare (or similar) in front of Caddy for static asset caching before scaling the VPS itself.

## Anti-Patterns

### Anti-Pattern 1: Separate Databases (or Duplicated Tables) for B2C vs. B2B

**What people do:** Stand up a second product/inventory table set "for B2B" to move fast, planning to sync later.
**Why it's wrong:** This directly contradicts the project's core value ("both flows run on the same product catalog and accurate inventory") and guarantees stock/price drift the moment both channels are live — exactly the failure mode hybrid-commerce case studies warn about.
**Do this instead:** One catalog/inventory dataset, channel-aware pricing and order handling as described above.

### Anti-Pattern 2: Frontends Talking Directly to Postgres/MinIO

**What people do:** Let a Next.js server component query Postgres directly "since it's all TypeScript anyway," bypassing the NestJS API for convenience.
**Why it's wrong:** Breaks the single source of truth for business rules (price resolution, RBAC, audit logging) — any of the three frontends could then diverge in what a "valid order" looks like, and there's no enforcement point for stock reservation races.
**Do this instead:** All three frontends talk only to the NestJS API over HTTP; only the API container has Postgres/Redis/MinIO credentials.

### Anti-Pattern 3: Pricing Logic Embedded in the Orders Module (or in the Frontend)

**What people do:** Compute the dealer's tier price inline inside `OrdersService.createOrder()`, or worse, have the dealer portal send the price it displayed and trust it.
**Why it's wrong:** Duplicates price logic across cart, checkout, quote, and Excel-bulk-order code paths, and trusting a client-sent price is a direct revenue/fraud risk.
**Do this instead:** `PriceResolutionService` is the only place price is computed; every code path (cart, order, quote, Excel bulk import) calls it server-side at the moment of order creation, re-validating against the price shown at cart time.

### Anti-Pattern 4: Storing Product Images/Documents as DB Bytea or on the App Container's Local Disk

**What people do:** Save uploaded images/PDFs to the NestJS container's local filesystem "for now."
**Why it's wrong:** Container filesystems are ephemeral on redeploy; local disk also doesn't survive horizontal scaling and bloats Postgres backups if stored as bytea.
**Do this instead:** MinIO (S3-compatible) container with a persisted volume, referenced by URL/key from Postgres rows.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| VNPay / MoMo / ZaloPay | Redirect-to-gateway + server-side webhook/IPN callback into `payments` module | Each gateway has its own signature/checksum verification — isolate behind a common `PaymentGateway` interface in the `payments` module so adding a 4th gateway later doesn't touch `sales` |
| COD | No external call; `payments` module just tracks a `cod_pending` → `cod_collected` state tied to fulfillment | Simplest v1 payment path, should be the default fallback |
| Domestic shipping fee calc | Start with rule-based calculation (by weight/zone) inside the `shipping` module; real carrier API (GHN/GHTK/Viettel Post, etc.) integration explicitly listed as a later "mở rộng" item, not v1 | Keep a `ShippingRateProvider` interface now so a real carrier API slots in later without touching checkout |
| Zalo (customer care) | Listed as v1 content/CS channel ("Zalo chăm sóc khách hàng") but full chatbot/CRM integration is out of scope | v1: outbound notification via Zalo OA API from the `notifications` queue is enough; no inbound chat integration needed yet |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Storefront/Dealer Portal/Admin ↔ NestJS API | HTTPS REST, JWT bearer auth, role/channel-scoped endpoints | No GraphQL needed at this scale; REST keeps the surface simple and matches NestJS conventions well |
| `pricing` ↔ `catalog`/`sales`/`customers` | Direct in-process service injection (same monolith) | Enforce via NestJS module exports — `pricing` should be importable by `sales`, not the reverse |
| `import-export` ↔ `inventory` | In-process service call at "goods received" event (landed cost → stock batch creation) | Model as a domain event (`GoodsReceivedEvent`) even inside the monolith so it's easy to extract later |
| `admin` (audit) ↔ everything else | NestJS interceptor on mutating admin endpoints, writes to `audit` schema | Keep decoupled from business transactions (audit write failure should not roll back the business action) |
| API ↔ Redis (BullMQ) | Producer/consumer within the same NestJS process (separate `@Processor` classes) | One NestJS app can run both HTTP server and queue workers in v1; split into a dedicated worker container only if queue load becomes a bottleneck |

## Single-VPS Docker Compose Topology

Recommended service list for `docker-compose.prod.yml`, all on one internal Docker network, only Caddy publishing 80/443:

| Service | Image/Base | Exposed | Volume |
|---------|-----------|---------|--------|
| `caddy` | `caddy:2-alpine` | 80, 443 (host) | `caddy_data`, `caddy_config` (TLS certs) |
| `storefront` | Next.js standalone build | internal 3000 | — (stateless) |
| `dealer-portal` | Next.js standalone build | internal 3000 | — (stateless) |
| `admin` | Next.js standalone build | internal 3000 | — (stateless) |
| `api` | NestJS build | internal 4000 | — (stateless; connects to postgres/redis/minio) |
| `postgres` | `postgres:16-alpine` | internal 5432 only | `pg_data` |
| `redis` | `redis:7-alpine` | internal 6379 only | `redis_data` (BullMQ jobs should survive restarts) |
| `minio` | `minio/minio` | internal 9000/9001 (console via Caddy admin subdomain, IP-allowlisted or auth-gated) | `minio_data` |

Routing via Caddyfile (host-based, one cert per subdomain, auto-renewed):
```
shop.example.com {
    reverse_proxy storefront:3000
}
dealer.example.com {
    reverse_proxy dealer-portal:3000
}
admin.example.com {
    reverse_proxy admin:3000
}
api.example.com {
    reverse_proxy api:4000
}
```

Notes:
- Postgres/Redis/MinIO ports are **not** published to the host in production compose — only reachable on the internal Docker network by `api`. A separate `docker-compose.override.yml` for local dev can expose them for direct DB access during development.
- `storefront`/`dealer-portal`/`admin` use Next.js `output: 'standalone'` for small, fast-building images.
- Back up `pg_data` and `minio_data` on a schedule (e.g., nightly `pg_dump` + `mc mirror` to off-VPS storage) — single-VPS deployments have no built-in redundancy, and this project handles orders/payments/customs documents, so backup is not optional.
- Given "chỉ một VPS," size Postgres/Redis memory limits conservatively in compose (`mem_limit`) so a traffic spike on the Next.js containers can't starve the database.

## Sources

- [NestJS and Modular Architecture: Principles and Best Practices](https://levelup.gitconnected.com/nest-js-and-modular-architecture-principles-and-best-practices-806c2cb008d5?gi=c38c85f10bfd) — MEDIUM confidence, community source, consistent with NestJS official module docs
- [NestJS Project Structure Best Practices 2026 - Encore.dev](https://encore.dev/articles/nestjs-project-structure-best-practices) — MEDIUM confidence
- [Modular Monolith in NestJS — Synapse Studios Standards](https://docs.synapsestudios.com/implementation/frameworks/nest/modular-monolith) — MEDIUM confidence
- [Multi-Store eCommerce: How B2B Businesses Are Expanding into B2C — Spree Commerce](https://spreecommerce.org/multi-store-ecommerce-how-b2b-businesses-are-expanding-into-b2c-without-doubling-their-infrastructure/) — MEDIUM confidence, confirms shared-backend/multi-storefront pattern
- [Unified Commerce Architecture Explained — OroCommerce](https://oroinc.com/b2b-ecommerce/blog/unified-commerce-architecture/) — MEDIUM confidence, confirms tiered pricing resolved server-side per customer/channel
- [B2B E-Commerce Website Architecture: Diagrams, Patterns & Stack Choices (2026) — WizCommerce](https://wizcommerce.com/blog/b2b-ecommerce-website-architecture/) — MEDIUM confidence
- [Efficient Deployment of Next.js and Nest.js Mono Repo Applications using Docker-Compose, Nginx Reverse Proxy — Medium](https://medium.com/@wwdhfernando/efficient-deployment-of-next-js-11a4e8947d9b) — LOW-MEDIUM confidence, single-source pattern reference for compose topology; cross-checked against general Docker/Next.js standalone-output guidance
- Project source documents: `D:\Work\Work-out\kid-toy\.planning\PROJECT.md`, `D:\Work\Work-out\kid-toy\requirements.txt.txt` — HIGH confidence, primary requirements

---
*Architecture research for: B2C + B2B toy import/export e-commerce platform, shared NestJS/Next.js/PostgreSQL backend, single-VPS Docker deployment*
*Researched: 2026-09-21*

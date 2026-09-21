<!-- GSD:project-start source:PROJECT.md -->
## Project

**Kid Toy Import-Export Platform**

Nền tảng thương mại điện tử cho một công ty xuất nhập khẩu, bán sỉ và bán lẻ đồ chơi trẻ em. Gồm hai khu vực dùng chung dữ liệu: website B2C bán lẻ cho người tiêu dùng, và cổng B2B bán sỉ cho đại lý/cửa hàng/trường học/nhà phân phối, cùng một backend quản trị dùng chung (sản phẩm, kho, đơn hàng, khách hàng, xuất nhập khẩu).

**Core Value:** Người mua lẻ có thể tìm và mua được đồ chơi phù hợp độ tuổi qua website, và đại lý có thể đăng ký tài khoản B2B, xem bảng giá sỉ riêng và đặt hàng số lượng lớn — cả hai luồng chạy trên cùng một catalog sản phẩm và tồn kho chính xác.

### Constraints

- **Tech stack**: Node.js (NestJS) backend + Next.js frontend + PostgreSQL — do người dùng chọn, ưu tiên TypeScript toàn bộ và dev nhanh
- **Deploy**: phải chạy được dạng container hoá gọn (docker compose) trên một VPS duy nhất, không tách microservices ngay từ đầu
- **Thanh toán v1**: COD + cổng thanh toán nội địa (VNPay/MoMo/ZaloPay) — không cần thanh toán quốc tế ở v1
- **Ngôn ngữ**: song ngữ Việt/Anh ngay từ v1; không cần đa tiền tệ
- **Ưu tiên roadmap**: B2C và B2B triển khai song song ngay từ MVP đầu tiên (không làm B2C xong mới tới B2B)
- **Bảo mật**: không lưu mật khẩu/SSH key/secrets trong repo hay planning docs — chỉ trong `.env.deploy` (gitignored) hoặc biến môi trường CI
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 24.x (Active LTS) | Runtime | Active LTS since Oct 2025, supported until Apr 2028. Node 22 is Maintenance LTS (fine as fallback if a dependency lags); avoid Node 26 (Current, not yet LTS until Oct 2026) for a production greenfield build. |
| TypeScript | 5.9.x | Language | Required baseline for Prisma 7/8, NestJS 11, and Next.js 16. End-to-end type safety across backend/frontend is the main reason this stack was chosen — enforce `strict: true` everywhere. |
| NestJS | 11.1.x | Backend framework | **Do not use NestJS 12** — it shipped ~days before this research (Q3 2026) and is a breaking full-ESM rewrite (Jest→Vitest, ESLint→oxlint, Webpack→Rspack). No stable migration guide exists yet and most community modules (payment SDKs, i18n, queues) haven't caught up. NestJS 11 is CommonJS, battle-tested, and everything in this stack targets it. |
| Next.js | 16.x (App Router) | Frontend framework (both B2C storefront and B2B portal) | App Router is now the stable, recommended default; Pages Router is in maintenance mode. Turbopack is stable and default for `dev`/`build` in v16, meaningfully faster local iteration. Use `output: "standalone"` for lean Docker images. |
| React | 19.x | UI library | Ships as the peer dependency of Next.js 16; Server Components + Server Actions reduce the amount of custom API glue needed for simple CRUD admin screens. |
| PostgreSQL | 17.x | Primary database | 17 is the mature, widely-supported major (18 is newest stable but tooling/extension coverage is still catching up; 17 has a full year of ecosystem validation). Handles the relational complexity of this domain well: multi-warehouse stock, batch/lot tracking, tiered B2B pricing, ACID guarantees for concurrent order/inventory writes. Use official `postgres:17-alpine` image. |
| Prisma ORM | 7.x (NOT 8) | ORM / migrations | Prisma 7 rewrote the client to pure TypeScript (no Rust engine binary — smaller Docker images, faster cold start), which matters on a single-VPS deploy. **Prisma 8 is only a release candidate as of Sept 2026** (GA expected Oct 2026) and is explicitly missing `$extends`, most nested writes, and transaction isolation levels — all of which this project needs for order/inventory transactions. Start on 7, plan an upgrade to 8 after it's GA + a few patch releases. |
| Redis | 7.x | Cache, session store, BullMQ backend, rate-limit counters | One Redis instance backing three concerns keeps the single-VPS footprint small. Use `redis:7-alpine`. |
| Docker Compose | v2 (Compose Specification) | Container orchestration | Matches the explicit constraint (single VPS, no microservices/K8s). Services: `api` (NestJS), `web` (Next.js), `postgres`, `redis`, `minio`, `meilisearch`, `caddy`. |
| Caddy | 2.x | Reverse proxy / TLS termination | Automatic Let's Encrypt HTTPS with a ~3-line Caddyfile per host, vs. hand-rolled certbot + nginx.conf. For a single-VPS deployment with 2-3 hostnames (storefront, B2B portal, API/admin), Caddy removes an entire class of renewal/config bugs. Use Nginx instead only if the team already has nginx operational expertise or needs advanced request-level rules Caddy doesn't cover cleanly. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@nestjs/passport`, `passport-jwt`, `passport-local`, `bcrypt` | latest | Auth (access + refresh JWT) | Custom JWT/Passport on the NestJS backend, **not** NextAuth/Auth.js. Both B2C storefront and B2B portal (and potentially a future dealer API) consume the *same* backend — Auth.js couples auth to a single Next.js runtime and fights a multi-client architecture. Standard pattern: `AuthModule` issues access+refresh tokens, `JwtStrategy` validates, `RolesGuard` + custom `@Roles()` decorator handles RBAC (admin, sales staff, dealer, customer). |
| `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` | latest v3 | Object storage client | Use against **MinIO**, not a cloud bucket, since MinIO is fully S3-API-compatible — same SDK code, zero vendor lock-in, and it self-hosts in the same docker-compose stack. Stores product images/videos, uploaded Excel files, and generated PO/invoice/packing-list PDFs. |
| MinIO | latest (`minio/minio` image) | S3-compatible object storage server | Self-hosted, single container, persistent volume. Avoids paying cloud egress/storage fees on a low-margin toy e-commerce business and keeps all product media + trade documents on the same VPS. |
| `@nestjs/bullmq` + `bullmq` | latest | Background jobs / queues | BullMQ is the actively-maintained successor to Bull (Bull is now maintenance-only). Use for: PDF generation (invoice/PO/packing list), Excel import processing (B2B bulk order upload, product catalog import), low-stock alert emails, order-status webhooks from payment gateways, image resizing. Keeps request/response cycles fast and gives retry/backoff for flaky third-party calls (payment gateway status checks, email/Zalo notifications). |
| Meilisearch (+ `meilisearch` JS client) | latest | Product search & filtering | Self-hosted, single binary/container, sub-50ms search, built-in typo-tolerance and automatic language handling — good fit for a catalog with Vietnamese *and* English product names/descriptions searched by both retail and dealer users. Simpler ops than Elasticsearch/Typesense for a single-VPS team (no JVM, minimal config, memory-mapped storage so RAM isn't a hard cap). Reindex product docs via BullMQ job on create/update. |
| `nestjs-i18n` | 10.8.x | Backend i18n (API error messages, email/notification templates, generated PDF labels) | Actively maintained (2 months old release seen at research time), Accept-Language header detection built in, structured for exactly a vi/en bilingual NestJS app. |
| `next-intl` | latest (v4+) | Frontend i18n (storefront + B2B portal UI, routing) | The de-facto standard for Next.js **App Router** in 2026 — built around Server Components, integrated locale routing (`/vi/...`, `/en/...`), ~2KB runtime. Prefer over `next-i18next` (its App Router support only shipped in v16, March 2026 — too new/unproven for this build) or raw `react-i18next` (no native App Router/RSC integration). |
| `vnpay` + `nestjs-vnpay` (by lehuygiang28) | latest | VNPay payment gateway integration | Actively maintained, TypeScript-first, tree-shakeable, purpose-built NestJS wrapper. High-reputation open-source library, closest thing to an "official" Node SDK VNPay has. Handles payment URL generation, IPN/return-URL signature verification, refund/query APIs. |
| Custom integration via `axios` + Node `crypto` (HMAC-SHA256) | — | MoMo payment gateway integration | **No trustworthy MoMo (Vietnam, developers.momo.vn) npm package exists.** Packages named `mtn-momo`/`mtn-momo-sdk` etc. are for MTN Mobile Money (Africa) — wrong provider entirely, do not install them by mistake. MoMo Vietnam publishes official Node.js sample code and full API docs (signature spec, `payWithMethod`, IPN) at developers.momo.vn — implement directly against that REST API using `axios` for HTTP and Node's built-in `crypto` for the HMAC-SHA256 signature. This is small, low-risk, and avoids depending on an unmaintained community wrapper for money-moving code. |
| `zalopay-nodejs` (`@zalopay-oss/zalopay-nodejs`) OR direct REST + HMAC (fallback) | latest | ZaloPay payment gateway integration | Official SDK published under the `zalopay-oss` GitHub org — prefer this. If it proves stale/unmaintained by implementation time (verify commit recency before adopting), fall back to the same direct-REST-call pattern used for MoMo; ZaloPay's API is also HMAC-signed and well documented at docs.zalopay.vn. |
| ExcelJS | latest (~4.x) | Excel import/export (B2B bulk order upload, price list download, product/inventory import) | **Do not use `xlsx` (SheetJS)** — the free npm package is abandoned with unpatched high-severity ReDoS and prototype-pollution CVEs (no fix planned; maintainer moved to a paid product). ExcelJS is actively maintained (~1.9M weekly downloads) and covers this project's needs (cell formatting, streaming read/write for large B2B order sheets). Sanitize/validate all uploaded cell data server-side before use — don't render raw uploaded sheet content unescaped in the browser. |
| `bwip-js` | latest | Barcode generation (SKU labels, carton labels) | Broadest format support (100+ symbologies: Code128, EAN-13, QR, PDF417, Data Matrix) in pure JS — needed because the platform must print both product barcodes and QR codes from the same warehouse module. Renders server-side to PNG/SVG for label printing and PDF embedding (packing lists, shelf labels). |
| `qrcode` | latest | QR code generation (order pickup codes, product page deep links, B2B quick-reorder links) | Lightweight, single-purpose, simpler API than bwip-js when you only need QR (not barcodes) — e.g., generating a QR on an order confirmation page. |
| Puppeteer | latest | PDF generation for trade & sales documents (PO, Commercial Invoice, Packing List, Bill of Lading references, sales invoices) | These are **layout-sensitive multi-language documents** with tables, letterhead, signatures — HTML/CSS templates rendered by a real browser engine give pixel-accurate, easy-to-maintain output (a frontend dev can edit an HTML template; nobody wants to hand-code PDF drawing commands for a B/L layout). Run generation as a BullMQ job (not inline in the request) since headless Chromium is CPU/memory-heavy — critical on a single VPS. Alternative: `pdfmake` (JSON-defined, lighter weight, no Chromium) is acceptable for simpler single-page documents (e.g., a plain sales invoice) if VPS resources are tight; keep Puppeteer for the more complex multi-section import/export docs. |
| `sharp` | latest | Image processing (product photo resize/optimize on upload) | Standard high-performance Node image library; run in the upload pipeline (or as a BullMQ job) before storing to MinIO — keeps storefront page-load fast without relying on an external image CDN. |
| `class-validator` + `class-transformer` | latest | DTO validation for NestJS HTTP layer | Decorator-based validation integrates natively with Nest's `ValidationPipe` — the standard, lowest-friction choice for request/response DTOs across ~10 domain modules (product, order, inventory, B2B pricing, import/export docs, etc.). |
| `zod` | latest (v4) | Environment variable / config validation, and validating third-party webhook payloads (payment gateway IPNs) | Use narrowly, not as a class-validator replacement: fail fast at boot with clear errors on missing/malformed env vars, and validate untrusted external payloads (VNPay/MoMo/ZaloPay callback bodies) before trusting them. |
| `@nestjs/cache-manager` + `cache-manager-ioredis-yet` (or `ioredis` directly) | latest | Caching (product catalog reads, B2B price-tier lookups, session data) | Same Redis instance as BullMQ — cache hot reads (category trees, active price tiers, flash-sale state) to reduce PostgreSQL load under B2C traffic spikes. |
| `@nestjs/throttler` | latest | Rate limiting | Protect login, OTP/registration, and payment-callback endpoints from abuse; single-VPS deployments are more exposed to noisy-neighbor/DoS risk than an auto-scaled cloud setup. |
| `@nestjs/swagger` | latest | OpenAPI/Swagger docs | Auto-generates API docs from existing DTOs/decorators — useful both for internal frontend/backend coordination and as a contract reference if a future dealer-facing API is exposed. |
| `nestjs-pino` + `pino-pretty` (dev) | latest | Structured logging | JSON structured logs are what you actually want to grep/ship from a single VPS (e.g., to a lightweight log file rotation or later to a log aggregator); far lower overhead than Nest's default logger under load. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| pnpm (workspaces) + Turborepo | Monorepo tooling | Put `apps/api` (NestJS), `apps/web` (Next.js), and `packages/shared-types` (DTOs/enums shared via `workspace:*`) in one repo. This directly addresses the domain's biggest cross-cutting risk: keeping product/order/pricing shapes consistent between backend and two frontends (B2C + B2B) without manual duplication. Turborepo adds task caching/pipelining (`build`, `lint`, `test`) across the two apps. |
| ESLint + Prettier | Linting/formatting | Standard NestJS/Next.js defaults; do not switch to oxlint yet — that's a NestJS 12 concern, out of scope while on v11. |
| Jest | Testing (backend + frontend unit/integration) | Ships as NestJS 11's default test runner; keep it (Vitest migration is a v12-era concern). |
| Docker Compose (dev override file) | Local dev parity | `docker-compose.yml` + `docker-compose.dev.yml` so local dev runs against the same Postgres/Redis/MinIO/Meilisearch versions as production — avoids "works on my machine" drift for a small team. |
| GitHub Actions (or equivalent CI) | CI: lint, typecheck, test, build Docker images | Build both `api` and `web` images on push; optionally push to VPS via SSH/`docker compose pull && up -d` for deploy. |
## Installation
# Monorepo scaffolding
# Backend (apps/api)
# Frontend (apps/web)
# Infra images (docker-compose.yml) — no install, reference in compose:
# postgres:17-alpine, redis:7-alpine, minio/minio, getmeili/meilisearch:latest, caddy:2-alpine
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Prisma 7 | Drizzle ORM | Choose Drizzle if the team is SQL-comfortable and wants zero abstraction/max raw performance — valid choice, especially since this is a VPS deploy (not serverless, so Drizzle's cold-start edge advantage doesn't matter as much here). Prisma wins for this project specifically because of Prisma Studio (non-technical staff/ops can eyeball data), mature migration tooling, and a schema-first model that's easier to onboard mid-level devs onto for a ~15-20 table e-commerce+trade-docs domain. |
| PostgreSQL 17 | PostgreSQL 18 | Use 18 if the team wants the newest features (e.g., improved async I/O) and is comfortable being an early adopter on a newer major version with less third-party tool validation. Not recommended for a first production deploy where stability matters more than bleeding-edge features. |
| Caddy | Nginx (+ certbot) | Use Nginx if the team already has nginx runbooks/expertise, or later needs advanced request routing (complex header rewriting, WAF modules) that's easier to express in nginx.conf than a Caddyfile. |
| Meilisearch | Typesense | Typesense is a reasonable alternative (similar self-hosted profile) but holds its full index in RAM (Meilisearch memory-maps to disk, less RAM pressure on a modest VPS) and uses plain Unicode tokenization vs. Meilisearch's language-aware tokenization — a small edge for mixed vi/en product content. |
| Puppeteer (PDF) | `pdfmake` | Use pdfmake for high-volume, simple, single-page documents (e.g., a plain retail receipt) where you don't need HTML/CSS fidelity and want a lighter process than spinning up Chromium — relevant if VPS RAM becomes a bottleneck under concurrent PDF generation. |
| Custom JWT/Passport | NextAuth.js / Auth.js | Only reconsider if the backend is ever dropped and Next.js becomes the sole server — not the case here (NestJS is the API of record for two frontends). |
| `next-intl` | `next-i18next` v16 | Consider if the team specifically wants the broader i18next plugin ecosystem (translation management platforms, AI-assisted translation). Its Next.js App Router support only shipped March 2026 — treat as unproven for a production greenfield build in this research window. |
| pnpm + Turborepo monorepo | Separate repos for `api` and `web` | Use separate repos only if the team plans to have fully independent release cadences/ownership per app from day one — adds friction to sharing DTOs (would need a published npm package instead of a workspace reference), not worth it for a small team building both sides in parallel. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `xlsx` / SheetJS (free npm package) | Two unpatched high-severity CVEs (ReDoS, prototype pollution); maintainer abandoned the free package for a paid product. Directly handles untrusted B2B-uploaded files — a real attack surface. | ExcelJS |
| `mtn-momo`, `mtn-momo-sdk`, `mtn-momo-gateway` npm packages | These integrate **MTN Mobile Money (Africa)**, an entirely different payment provider — not Vietnamese MoMo (M_Service/developers.momo.vn). Easy naming trap to fall into. | Direct REST integration against developers.momo.vn using axios + crypto |
| NestJS 12 | Released only days before this research; full ESM rewrite plus toolchain swap (Jest→Vitest, ESLint→oxlint, Webpack→Rspack) with no stable migration guide yet, and the community payment/i18n/queue modules this project depends on haven't caught up. | NestJS 11.1.x |
| Prisma 8 | Still a release candidate (GA ~Oct 2026); explicitly missing nested writes, `$extends`, and transaction isolation levels — all needed for correct order/inventory transaction handling. | Prisma 7.x, upgrade after GA stabilizes |
| Splitting into microservices from day one | Explicit project constraint is a single VPS with docker-compose; microservices add operational overhead (service discovery, distributed tracing, network hops) with zero benefit at this scale. | NestJS modular monolith — enforce boundaries with Nest modules, not network calls |
| NextAuth/Auth.js as the *only* auth layer | Ties auth to the Next.js server runtime; awkward when the same backend must also serve a to-be-built dealer API, admin tooling, or future mobile app. | Backend-owned JWT/Passport auth, Next.js just calls the API |
| Multi-currency support / i18n libraries assuming currency conversion (e.g., pulling in a full currency-conversion package) | Out of scope per PROJECT.md — VND only for v1, bilingual content only. Adding currency abstraction now is premature complexity. | Store all money as VND integer (smallest unit, no decimals needed for VND), format display client-side per locale |
## Stack Patterns by Variant
- Move Puppeteer into a dedicated worker container (separate from the `api` container) consuming a BullMQ queue, with `puppeteer-cluster` or a capped browser-instance pool.
- Because: headless Chromium is memory-hungry; isolating it prevents a PDF spike from starving the main API process on a single VPS.
- Re-evaluate Typesense or a managed search service.
- Because: Meilisearch is right for MVP-to-mid-scale; re-benchmark once catalog size and concurrent B2B search load are known from production data.
- The existing NestJS JWT/Passport auth and Swagger-documented REST API already support this without rework.
- Because: this is exactly why NextAuth/Auth.js (frontend-coupled) was avoided in favor of backend-owned auth.
- Move Meilisearch and/or MinIO to a second small VPS, keep Postgres/Redis/api/web together.
- Because: Meilisearch and Puppeteer/PDF workers are the two most memory-hungry non-database services in this stack; they're the first candidates to split out if a single VPS is undersized.
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| NestJS 11.1.x | Node.js 20/22/24, TypeScript 5.x | Confirmed production-safe combination per NestJS 11 docs; avoid Node 26 until it's LTS (Oct 2026). |
| Prisma 7.x | Node.js 22.18+ (or 24.11+ on the 24 line), TypeScript 5.9+ | Prisma's own stated minimum — pin CI/Docker base image accordingly. |
| Next.js 16.x | React 19.x, Node.js 20.9+ | React 19 is a hard peer dependency; don't mix with React 18 code patterns (some libraries still assume React 18 semantics — audit any third-party UI kit before adopting). |
| nestjs-vnpay | NestJS 10/11 | Purpose-built wrapper; verify against the exact NestJS 11 minor version in use before deploying. |
| next-intl | Next.js 13+ App Router | Explicitly designed around RSC; do not mix with Pages Router in the same app. |
## Sources
- Context7 `/lehuygiang28/vnpay`, `/lehuygiang28/nestjs-vnpay` — confirmed high-reputation, actively maintained VNPay libraries (HIGH confidence)
- Context7 `/nestjs/nest` version listing — confirmed NestJS 11.1.x / 12.0.x version numbers (HIGH confidence)
- [NestJS v12 Roadmap: Full ESM Migration — InfoQ](https://www.infoq.com/news/2026/04/nestjs-12-roadmap-esm/) — MEDIUM confidence, cross-checked against npm version history
- [NestJS v12 is Coming: What's New — Trilon Consulting](https://trilon.io/blog/nestjs-12-is-coming) — MEDIUM confidence
- [Next.js 16.3 — official blog](https://nextjs.org/blog/next-16-3) — HIGH confidence (official source)
- [Upgrading: Version 16 — Next.js docs](https://nextjs.org/docs/app/guides/upgrading/version-16) — HIGH confidence (official docs)
- [Prisma ORM release status — official docs](https://www.prisma.io/docs/prisma-orm/release-status) — HIGH confidence (official source); confirmed Prisma 8 is RC, GA ~Oct 2026, missing nested writes/transaction isolation/$extends
- [ORM releases and maturity levels (Prisma v7) — official docs](https://www.prisma.io/docs/orm/v7/more/releases) — HIGH confidence
- [PostgreSQL: Release Notes — official](https://www.postgresql.org/docs/release/) — HIGH confidence, confirmed 18.6/17.11 as latest stable minors, PG19 in beta
- [Node.js — official releases](https://nodejs.org/en/about/previous-releases) — HIGH confidence, confirmed Node 24 Active LTS, Node 22 Maintenance LTS, Node 26 Current
- MoMo Developers official portal (developers.momo.vn) and [momo-wallet/payment GitHub](https://github.com/momo-wallet/payment) — MEDIUM confidence (official docs exist, but no first-party maintained npm package was found — hence recommending direct REST integration)
- [ZaloPay Node.js SDK — zalopay-oss/zalopay-nodejs](https://github.com/zalopay-oss/zalopay-nodejs) and [ZaloPay official docs](https://docs.zalopay.vn/docs/guides/payment-acceptance/payment-gateway/intro/) — MEDIUM confidence (official org, but exact maintenance recency not independently verified — flagged for validation before adoption)
- [SheetJS/js-xlsx vulnerability reports — Snyk / git.sheetjs.com issues](https://git.sheetjs.com/sheetjs/sheetjs/issues/3098) — HIGH confidence (multiple corroborating CVE reports)
- [Meilisearch vs Typesense — official Meilisearch comparison](https://www.meilisearch.com/comparisons/meilisearch-vs-typesense) — MEDIUM confidence (vendor-authored comparison, directionally corroborated by independent Typesense-side comparison page)
- WebSearch aggregate findings on Caddy vs Nginx, pnpm/Turborepo monorepo patterns, Next.js standalone Docker builds, next-intl vs next-i18next, class-validator vs Zod — MEDIUM confidence (multiple independent 2026-dated community sources agreeing; no single authoritative doc for these ecosystem-consensus topics)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

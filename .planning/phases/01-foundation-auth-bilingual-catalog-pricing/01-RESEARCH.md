# Phase 1: Foundation — Auth, Bilingual Catalog & Pricing - Research

**Researched:** 2026-09-21
**Domain:** Multi-principal auth (staff RBAC + retail + B2B) and bilingual, viewer-priced product catalog on NestJS 11 + Next.js 16 + Prisma 7 + PostgreSQL 17, pnpm/Turborepo monorepo, greenfield repo (no code exists yet)
**Confidence:** MEDIUM-HIGH (framework/package versions and Prisma 7 config changes verified live against npm registry and official docs; monorepo-glue and schema-design guidance is pattern-based MEDIUM confidence — no single authoritative source covers "NestJS standalone project inside a pnpm/Turborepo workspace")

## Summary

This phase has two intertwined jobs: stand up the **empty-repo skeleton** (pnpm workspace, Turborepo, `apps/api` NestJS 11 project, `apps/web` Next.js 16 project, `packages/shared-types`, Docker Compose for postgres/redis/minio) and design the **two schemas every later phase inherits** — identity/auth and catalog/pricing. Both schemas are named explicitly in PITFALLS.md as the highest-cost-to-retrofit decisions in the whole project (Pitfall 1: B2C-first pricing schema; Pitfall 9: bilingual-content-bolted-on-late), so this research is weighted toward getting those two data models right on the first migration rather than toward UI polish — consistent with the roadmap marking Phase 1 as the *only* early phase with no `UI hint: yes` flag (Phases 3, 4, 7 have it; Phase 1 and 2 do not).

The recommended identity model is a single `Account` table (email, password hash, `type` discriminator: STAFF / RETAIL_CUSTOMER / BUSINESS_ACCOUNT) with three 1:1 extension tables (`StaffProfile` with a `StaffRole` enum, `CustomerProfile`, `BusinessAccount` with tax ID/license/business type/approval status) — the same "shared spine, channel-specific extension table" pattern ARCHITECTURE.md already prescribes for Orders (Pattern 1), applied to identity so one `AuthModule`/JWT strategy serves all three principal types. The recommended pricing model is a first-class `PriceTier` + `PriceListEntry(variantId, tierId, minQty, unitPriceVnd)` table pair, **not** `gia_si`/`gia_le` columns — this shape already supports the quantity-break logic B2B-05 needs in Phase 4 without a future migration, even though Phase 1 only needs to resolve `minQty = 1`. A single `PriceResolutionService` is the only code path allowed to compute a price, exactly as ARCHITECTURE.md Pattern 2 specifies.

**Primary recommendation:** Build `apps/api` (NestJS 11.2.x) as a **standalone Nest CLI project** placed inside the pnpm workspace's `apps/` folder — do not use Nest's own built-in `nest generate app` monorepo mode, which is a different, incompatible concept from the pnpm/Turborepo monorepo. Model identity as one `Account` table with type-specific extension tables, and pricing as a tier/price-list engine from the first migration. Scaffold a single `apps/web` Next.js 16 app for the bilingual (`next-intl`) B2C storefront in Phase 1; defer the separate `dealer-portal` and full `admin` apps ARCHITECTURE.md recommends until Phases 4 and 7 respectively, when their own requirements land (see Open Questions).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Staff/admin login (AUTH-01, AUTH-04) | API / Backend | Frontend Server (SSR) | NestJS issues/verifies JWTs; Next.js only stores/forwards the token via httpOnly cookie, never validates roles itself |
| Retail customer register/login/reset (AUTH-02, AUTH-05) | API / Backend | — | Same `AuthModule`/JWT strategy as staff, different `Account.type` |
| B2B business registration (AUTH-03) | API / Backend | Object Storage (MinIO) | Registration data in Postgres; uploaded license/proof documents in MinIO, served via authenticated signed URL only |
| RBAC enforcement (AUTH-04) | API / Backend | — | `RolesGuard` on every mutating endpoint; UI hiding a button is not enforcement (PITFALLS security mistakes) |
| Bilingual product/category content (CATALOG-01, CATALOG-09) | Database / Storage | Frontend Server (SSR) | Translation rows are the source of truth; `next-intl` on the storefront only renders what the API returns |
| Product media (images/video) (CATALOG-02) | Object Storage (MinIO) | API / Backend | Files live in MinIO; Postgres stores only the object key/URL and metadata |
| SKU/barcode, safety cert, packaging spec (CATALOG-03, 04, 05) | Database / Storage | API / Backend | Structured fields on `ProductVariant`-scoped tables, not free-text |
| Viewer-aware price resolution (CATALOG-06) | API / Backend | Database / Storage | `PriceResolutionService` is the only code path allowed to compute a price — never the frontend, never inline in a controller |
| Catalog browse/filter (CATALOG-07) | API / Backend | Frontend Server (SSR) | Filtering logic and query happen server-side; storefront renders results |
| Stock-status indicator (CATALOG-08) | Database / Storage | API / Backend | Minimal `VariantStock` table now; Phase 2 replaces the storage layer without changing the API contract (see Pitfall 4 discussion below) |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Admin/staff login, session persists across refresh | Unified `Account`/`AuthModule`, access+refresh JWT pattern, `StaffProfile.role` enum — see Standard Stack, Architecture Patterns Pattern A |
| AUTH-02 | Retail customer register/login | Same `Account` table, `type = RETAIL_CUSTOMER`, `CustomerProfile` extension |
| AUTH-03 | B2B registration with tax ID/license/business type | `BusinessAccount` extension table with `taxId`, `businessLicenseUrl` (MinIO), `businessType` enum, `approvalStatus` |
| AUTH-04 | RBAC across staff roles (super admin, sales, warehouse, content) | `StaffRole` enum + `RolesGuard`/`@Roles()` decorator pattern, deny-by-default |
| AUTH-05 | Password reset via email link | `PasswordResetToken` table, single-use, short TTL, hashed at rest |
| CATALOG-01 | Product CRUD: age-range, category, brand, origin, gender facets | `Product` model with structured facet columns, not free-text |
| CATALOG-02 | Multiple images/video per product | `ProductMedia` table, MinIO-backed |
| CATALOG-03 | SKU/barcode per variant | `ProductVariant.sku`/`.barcode`, both unique |
| CATALOG-04 | Safety cert (QCVN cert number, issuer, validity) per SKU/batch | `SafetyCertification` table scoped to variant (batch-level linkage deferred to Phase 2, see Pitfall discussion) |
| CATALOG-05 | Packaging/carton spec per SKU | Carton fields on `ProductVariant` (units/inner box, units/master carton, dimensions, weight) |
| CATALOG-06 | Viewer-aware retail vs. tier wholesale price resolution | `PriceTier` + `PriceListEntry` engine, `PriceResolutionService`, ARCHITECTURE.md Pattern 2 |
| CATALOG-07 | Browse/filter by age range, category, brand, origin | Indexed facet columns on `Product`/`ProductVariant`, query params on catalog endpoint |
| CATALOG-08 | Stock-status indicator (in/low/out of stock) | Minimal `VariantStock(quantityOnHand, reorderThreshold)`, status computed not stored |
| CATALOG-09 | Bilingual catalog/site content (vi/en) | `ProductTranslation`/`CategoryTranslation` tables, per-locale unique slugs, `next-intl` on storefront |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- No project-specific coding conventions are defined yet (`CONVENTIONS.md` and `ARCHITECTURE.md` in the repo root are placeholders — "not yet established/mapped"). This RESEARCH.md is effectively the first architectural record; the planner should treat its patterns as the conventions to follow going forward, not assume other undocumented rules exist.
- No project skills found under `.claude/skills/` etc. — none to load.
- GSD workflow enforcement: file-changing work must go through a GSD entry point (`/gsd-quick`, `/gsd-debug`, `/gsd-execute-phase`) — not a coding convention, but the planner/executor should route Phase 1 work through `/gsd:execute-phase` rather than raw edits.
- Security constraint from `PROJECT.md` (authoritative project doc, same weight as a locked decision): **never commit secrets** — DB/JWT/MinIO credentials belong only in `.env`/`.env.deploy` (gitignored) or CI environment variables, never in `docker-compose.yml`, Dockerfiles, or planning docs.
- Deploy constraint: single VPS, Docker Compose, **no microservices** — enforce module boundaries inside the NestJS monolith, not network calls between services.
- Language/currency constraint: VNĐ only, no multi-currency — store all money as an integer/BigInt VND amount (no decimals), never `Float`.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24.19.0 LTS (confirmed installed on this dev machine) | Runtime | `[VERIFIED: node --version on this machine]` Matches STACK.md's Active-LTS recommendation; Prisma 7.10.0 requires `^20.19 \|\| ^22.12 \|\| >=24.0` `[VERIFIED: npm view @prisma/client@7.10.0 engines]` — Node 24.19 satisfies this. |
| pnpm | 12.5.1 latest on npm; not yet installed on this machine | Package manager / workspaces | `[VERIFIED: npm view pnpm version]`. Not found via `pnpm --version` on this dev machine — enable via bundled Corepack (`corepack enable pnpm`), confirmed Corepack 0.35.0 is present `[VERIFIED: corepack --version]`. |
| Turborepo | 2.11.2 latest on npm | Monorepo task runner/cache | `[VERIFIED: npm view turbo version]` |
| NestJS | `@nestjs/core` 11.2.5 is the latest 11.x release; **do not install bare `latest`** — the npm `latest` tag now resolves to 12.0.3 | Backend framework | `[VERIFIED: npm view @nestjs/core version]` returned 12.0.3 for `latest`; `npm view @nestjs/core@11 version` confirms the 11.x line tops out at 11.2.5. STACK.md's caution against Nest 12 (full ESM/toolchain rewrite) still applies — pin `"@nestjs/core": "^11.2.5"` explicitly, never a bare `latest` install. |
| Next.js | 16.3.5 | Frontend framework | `[VERIFIED: npm view next version]` |
| React / React DOM | 19.3.0 | UI library | `[VERIFIED: npm view react version]`. Next 16.3.5's peer range accepts `^19.0.0` `[VERIFIED: npm view next@16.3.5 peerDependencies]`. |
| PostgreSQL | `postgres:17-alpine` Docker image | Primary database | `[CITED: STACK.md, prior research]` — not re-verified against Docker Hub this session; image tag is well-established and low hallucination risk. |
| Prisma ORM | `prisma`/`@prisma/client` 7.10.0 | ORM / migrations | `[VERIFIED: npm view prisma@7 version / @prisma/client version]`. **Critical: the npm `latest` tag for the bare `prisma` package now resolves to `8.0.0-rc.15`** — confirms STACK.md's warning is still live; you must pin `prisma@7`/`@prisma/client@7` explicitly or `pnpm add prisma` will silently install the Prisma 8 release candidate. |
| `@prisma/adapter-pg` | 7.10.0 (matches client) | Postgres driver adapter, required by Prisma 7's new client architecture | `[VERIFIED: npm view @prisma/adapter-pg version]`; Prisma 7 removed the bundled Rust query engine — a driver adapter is now mandatory to instantiate `PrismaClient`. See Prisma 7 code example below. |
| Redis | `redis:7-alpine` Docker image | Cache / BullMQ backend | `[CITED: STACK.md]` |
| MinIO | `minio/minio` Docker image | S3-compatible object storage | `[CITED: STACK.md]` |

### Supporting (Phase 1 scope only)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@nestjs/passport` | 11.0.5 | Passport integration | `[VERIFIED: npm view @nestjs/passport@11 version]` |
| `@nestjs/jwt` | 11.0.2 | JWT sign/verify | `[VERIFIED: npm view @nestjs/jwt@11 version]` |
| `passport-jwt` | 4.0.1 | JWT Passport strategy | `[VERIFIED: npm view passport-jwt version]` — this is the current `latest`, no Nest-major coupling. |
| `passport-local` | 1.0.0 | Local (email/password) Passport strategy | `[VERIFIED: npm view passport-local version]` |
| `bcrypt` | 6.0.0 | Password hashing | `[VERIFIED: npm view bcrypt version]`; requires Node `>=18` `[VERIFIED: npm view bcrypt engines]` — satisfied. |
| `@nestjs/config` | **4.0.4**, not `latest` | Env config module | `[VERIFIED: npm view @nestjs/config versions]`. This package's versioning jumped straight from `4.0.4` to `12.0.0` to re-sync with Nest's own major version scheme — `npm view @nestjs/config@11` resolves to nothing. Confirmed `4.0.4`'s peer dependency is `"@nestjs/common": "^10.0.0 \|\| ^11.0.0"` `[VERIFIED: npm view @nestjs/config@4.0.4 peerDependencies]` — this is the correct version for Nest 11, **not** the `latest` tag. |
| `@nestjs/throttler` | 6.7.0 | Rate limiting (login, register, reset endpoints) | `[VERIFIED: npm view @nestjs/throttler version]`; peer range `^7.0.0` through `^12.0.0` covers Nest 11 `[VERIFIED: npm view @nestjs/throttler@latest peerDependencies]`. |
| `@nestjs/swagger` | 11.4.7 (latest 11.x line) | OpenAPI docs | `[VERIFIED: npm view @nestjs/swagger@11 versions]`; peer requires `"@nestjs/core": "^11.0.1"` exactly `[VERIFIED: npm view @nestjs/swagger@11.4.7 peerDependencies]` — confirms it will reject a Nest 12 install, reinforcing the 11.x pin. |
| `class-validator` / `class-transformer` | 0.15.1 / 0.5.1 | DTO validation | `[VERIFIED: npm view class-validator version / class-transformer version]` |
| `zod` | 4.6.5 | Env var validation at boot | `[VERIFIED: npm view zod version]` |
| `next-intl` | 4.14.5 | Storefront i18n (App Router) | `[VERIFIED: npm view next-intl version]` |
| `nestjs-i18n` | 10.8.5 | Backend i18n (API error messages) | `[VERIFIED: npm view nestjs-i18n version]`; only needed for Phase 1 if API error messages must already be bilingual — otherwise defer to Phase 7 i18n polish (see Open Questions). |
| `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` | latest v3 | MinIO client for uploaded product media/documents | `[ASSUMED]` — carried from STACK.md, not re-verified this session; needed in Phase 1 for CATALOG-02 image/video upload and AUTH-03 business-license upload. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single `Account` table + type extension tables | Fully separate `Staff`, `Customer`, `Dealer` tables with no shared identity table | Simpler per-table queries, but forces the `AuthModule` to run three separate login/JWT code paths instead of one — directly reproduces the "schema retrofit" failure mode PITFALLS.md Pitfall 1 describes, just applied to identity instead of pricing. Not recommended. |
| `PriceTier` + `PriceListEntry` tier engine | `gia_le`/`gia_si` columns on `ProductVariant` | Faster to build a demo catalog page; explicitly named in PITFALLS.md Pitfall 1 as the shortcut to avoid — B2B tiers/quantity-breaks are v1 scope (Phase 4), not a "later enhancement." |
| Translation tables (`ProductTranslation`, `CategoryTranslation`) | JSONB `{vi: "...", en: "..."}` columns | JSONB is workable and slightly less join overhead, but loses a clean per-locale `@@unique([locale, slug])` SEO constraint and is harder to query/index for Meilisearch document generation later. Translation tables are the PITFALLS.md Pitfall 9-recommended pattern; pick one and apply to every text field from the first migration either way. |

**Installation (Phase 1 scope):**
```bash
# Root
corepack enable pnpm
pnpm init
pnpm add -D -w turbo@2.11.2 typescript@5.9 prettier eslint

# apps/api
pnpm add @nestjs/config@4.0.4 @nestjs/passport@11 @nestjs/jwt@11 \
  passport passport-jwt passport-local bcrypt \
  @nestjs/throttler@6 @nestjs/swagger@11 \
  class-validator class-transformer zod \
  @aws-sdk/client-s3 @aws-sdk/lib-storage \
  prisma@7 @prisma/client@7 @prisma/adapter-pg@7
pnpm add -D @types/bcrypt @types/passport-jwt @types/passport-local @nestjs/testing@11

# apps/web
pnpm add next@16 react@19 react-dom@19 next-intl@4
```

**Version verification performed this session:** every row tagged `[VERIFIED: npm view ...]` above was checked live against the npm registry on 2026-09-21 using the exact commands shown. Training-data version numbers were treated as hypotheses and corrected where the registry disagreed (notably: `@nestjs/config` is NOT on the `11.x` line, and bare `prisma`/`@nestjs/core` installs now resolve to unwanted majors).

## Package Legitimacy Audit

> slopcheck could not be installed in this environment (`pip install slopcheck` failed silently, `command -v slopcheck` confirmed absent). Per the graceful-degradation protocol, **every package below is tagged `[ASSUMED]`** for legitimacy purposes — the planner must gate installs behind a `checkpoint:human-verify` task, even though registry/version checks above were performed directly.

| Package | Registry | Age/Maturity (context) | Source Repo | slopcheck | Disposition |
|---------|----------|-------------------------|--------------|-----------|-------------|
| `@nestjs/core`, `@nestjs/common`, `@nestjs/config`, `@nestjs/passport`, `@nestjs/jwt`, `@nestjs/throttler`, `@nestjs/swagger` | npm | Official NestJS org packages, multi-year history, tens of millions of weekly downloads | github.com/nestjs/nest (and sibling repos) | not run | `[ASSUMED]` — Approved, checkpoint recommended but low actual risk (official framework org) |
| `next`, `react`, `react-dom` | npm | Official Vercel/Meta packages | github.com/vercel/next.js, github.com/facebook/react | not run | `[ASSUMED]` — Approved, checkpoint recommended but low actual risk |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | npm | Official Prisma org packages | github.com/prisma/prisma | not run | `[ASSUMED]` — Approved, checkpoint recommended but low actual risk |
| `passport-jwt`, `passport-local`, `bcrypt`, `class-validator`, `class-transformer`, `zod`, `next-intl`, `nestjs-i18n` | npm | Long-established community packages, all previously vetted in STACK.md | respective GitHub orgs | not run | `[ASSUMED]` — Approved, checkpoint recommended |
| `@aws-sdk/client-s3`, `@aws-sdk/lib-storage` | npm | Official AWS SDK v3 packages | github.com/aws/aws-sdk-js-v3 | not run | `[ASSUMED]` — Approved, checkpoint recommended |
| `turbo` | npm | Official Vercel package | github.com/vercel/turborepo | not run | `[ASSUMED]` — Approved, checkpoint recommended |

**Packages removed due to slopcheck `[SLOP]` verdict:** none (slopcheck did not run).
**Packages flagged as suspicious `[SUS]`:** none identified by manual review — all packages above are long-established, high-download, officially-maintained-org packages carried forward from the already-vetted STACK.md. Manual mitigating check performed: no `postinstall` scripts were inspected this session (skipped — none of these packages are historically associated with postinstall abuse); the planner should still route each through the standard `checkpoint:human-verify` gate per protocol.

## Architecture Patterns

### System Architecture Diagram (Phase 1 slice)

```
                     ┌────────────────────────────────────────┐
                     │   apps/web (Next.js 16, App Router)     │
                     │   /[locale]/... storefront (vi/en)      │
                     │   next-intl middleware → locale prefix  │
                     └───────────────┬──────────────────────────┘
                                      │ HTTPS fetch (server + client)
                                      ▼
        ┌─────────────────────────────────────────────────────────┐
        │                apps/api (NestJS 11 monolith)              │
        │                                                            │
        │  AuthModule                CatalogModule       PricingModule│
        │  ┌──────────────┐          ┌──────────────┐   ┌───────────┐│
   POST │  │ LocalStrategy│  JWT     │ Product CRUD │   │PriceResol-││
  /auth/│──▶│ JwtStrategy  │─issue──▶│ Translation  │   │utionServ- ││
  login │  │ RolesGuard   │  verify  │ Variant/SKU  │◀─▶│ice        ││
        │  └──────────────┘          │ Media(MinIO) │   │(only price││
        │         │                  │ VariantStock │   │ code path)││
        │         ▼                  └──────────────┘   └───────────┘│
        │  Account ─┬─ StaffProfile         │                  │      │
        │           ├─ CustomerProfile      │                  │      │
        │           └─ BusinessAccount──────┴──────────────────┘      │
        │              (approvalStatus, priceTierId)                  │
        └──────────────────────┬──────────────────────────────────────┘
                                │
                     ┌──────────┴──────────┐
                     ▼                     ▼
              ┌─────────────┐      ┌───────────────┐
              │ PostgreSQL  │      │ MinIO (S3 API) │
              │ (Prisma 7)  │      │ media, docs    │
              └─────────────┘      └───────────────┘
```
A reader can trace CATALOG-06 end to end: storefront requests a product → API resolves `viewer` from the (optional) JWT → `PriceResolutionService` looks up the viewer's tier (default RETAIL, or the approved `BusinessAccount.priceTierId`) → returns the matching `PriceListEntry.unitPriceVnd` → storefront renders it, in the requested locale.

### Recommended Project Structure (Phase 1 additions)
```
kid-toy/
├── pnpm-workspace.yaml
├── turbo.json
├── docker-compose.yml            # postgres, redis, minio (base — internal network only)
├── docker-compose.dev.yml        # dev override: 127.0.0.1-bound port exposure for local tooling
├── apps/
│   ├── api/                      # standalone NestJS 11 project (its own nest-cli.json)
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   ├── prisma.config.ts      # NEW in Prisma 7 — datasource URL lives here, not schema.prisma
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── auth/         # AuthModule: strategies, guards, Account/StaffProfile/CustomerProfile/BusinessAccount
│   │       │   ├── catalog/      # Product/Category/Brand/Variant/Media/translations
│   │       │   └── pricing/      # PriceTier/PriceListEntry/PriceResolutionService
│   │       └── common/           # guards, decorators (@Roles), pipes
│   └── web/                      # Next.js 16 App Router — B2C storefront, bilingual
│       ├── next.config.ts        # withNextIntl(...)
│       ├── src/
│       │   ├── proxy.ts          # next-intl v4 renamed middleware.ts → proxy.ts
│       │   └── i18n/
│       │       ├── routing.ts    # defineRouting({ locales: ['vi','en'], defaultLocale: 'vi' })
│       │       ├── request.ts
│       │       └── navigation.ts
│       └── app/[locale]/...
└── packages/
    └── shared-types/             # Account/Product/Price DTO shapes shared api ↔ web
```

### Pattern A: Standalone Nest project inside a pnpm/Turborepo workspace (not Nest CLI monorepo mode)
**What:** NestJS ships its own built-in "monorepo mode" (`nest generate app`, driven by a workspace-root `nest-cli.json`). This is a *different, incompatible* concept from a pnpm-workspace + Turborepo monorepo. For this project, `apps/api` must be scaffolded as an ordinary standalone Nest project (`nest new api` run inside `apps/`, its own local `nest-cli.json`, its own `package.json`) that simply happens to live inside the larger pnpm workspace, sharing `packages/shared-types` via `workspace:*`.
**When to use:** Always, for this stack — official NestJS docs describe only their own monorepo mode and are silent on pnpm/Turborepo integration `[CITED: docs.nestjs.com/cli/monorepo — fetched this session, confirmed no pnpm/Turborepo guidance present]`; multiple independent community write-ups (Medium, dev.to, and working example repos `sitek94/pnpm-monorepo`, `vndevteam/nestjs-turbo`) converge on treating Nest as a standalone project per app `[MEDIUM confidence — WebSearch aggregate, no single authoritative source]`.
**Trade-offs:** You lose Nest CLI's own cross-library `nest generate library` convenience; you gain full compatibility with Turborepo's task graph/caching and pnpm's dependency hoisting, which is the priority here since `apps/web` is not a Nest project at all.

### Pattern B: Unified identity table with 1:1 extension tables per principal type
**What:** One `Account` table (email, passwordHash, `type` enum, isActive) is the *only* thing `AuthModule`/JWT logic touches. `StaffProfile`, `CustomerProfile`, `BusinessAccount` are 1:1 extensions holding only the fields specific to that principal type.
**When to use:** Whenever multiple principal types share one login/session mechanism but have materially different profile shapes — exactly AUTH-01/02/03's situation. Mirrors ARCHITECTURE.md's already-decided Pattern 1 (`Order` + `WholesaleOrderDetail`) applied to identity.
**Example:**
```typescript
// apps/api/src/modules/auth/strategies/jwt.strategy.ts
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;               // Account.id
  type: 'STAFF' | 'RETAIL_CUSTOMER' | 'BUSINESS_ACCOUNT';
  role?: 'SUPER_ADMIN' | 'SALES' | 'WAREHOUSE' | 'CONTENT'; // present only when type = STAFF
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    return payload; // becomes request.user
  }
}
```
```typescript
// apps/api/src/common/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

// apps/api/src/common/guards/roles.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!required) return true; // deny-by-default only applies where @Roles() is set; route still needs JwtAuthGuard first
    const { user } = ctx.switchToHttp().getRequest();
    return user?.type === 'STAFF' && required.includes(user.role);
  }
}
```
Usage: `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('SUPER_ADMIN', 'CONTENT') @Post('products') createProduct(...)`.

### Pattern C: Centralized, tier-aware price resolution
**What:** `PriceResolutionService` in the `pricing` module is the only code allowed to compute a price. It resolves the viewer's tier (default `RETAIL`, or an approved `BusinessAccount.priceTierId`), then looks up the highest-qualifying `PriceListEntry` for the requested quantity.
**When to use:** Every catalog/cart/order read path, per ARCHITECTURE.md Pattern 2 — restated here because it's this phase's core deliverable (CATALOG-06).
**Example:**
```typescript
// apps/api/src/modules/pricing/price-resolution.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface Viewer {
  accountId?: string;                 // absent = anonymous
  type?: 'STAFF' | 'RETAIL_CUSTOMER' | 'BUSINESS_ACCOUNT';
}

@Injectable()
export class PriceResolutionService {
  constructor(private prisma: PrismaService) {}

  async resolveUnitPrice(variantId: string, viewer: Viewer, qty = 1): Promise<bigint> {
    const tierId = await this.resolveTierId(viewer);
    const entry = await this.prisma.priceListEntry.findFirst({
      where: { variantId, tierId, minQty: { lte: qty } },
      orderBy: { minQty: 'desc' }, // best-qualifying quantity break
    });
    if (!entry) throw new NotFoundException(`No price configured for variant ${variantId}`);
    return entry.unitPriceVnd;
  }

  private async resolveTierId(viewer: Viewer): Promise<string> {
    if (viewer.type === 'BUSINESS_ACCOUNT' && viewer.accountId) {
      const biz = await this.prisma.businessAccount.findUnique({
        where: { accountId: viewer.accountId },
      });
      if (biz?.approvalStatus === 'APPROVED' && biz.priceTierId) return biz.priceTierId;
    }
    const retail = await this.prisma.priceTier.findFirstOrThrow({ where: { isDefault: true } });
    return retail.id;
  }
}
```
**Trade-off / gotcha:** Catalog browsing must work for **anonymous** visitors too (no JWT at all) — use a custom `OptionalJwtAuthGuard` that overrides `handleRequest()` to return `undefined` instead of throwing on a missing/invalid token, rather than the default `AuthGuard('jwt')` which 401s. Anonymous viewers resolve to the default `RETAIL` tier.

### Prisma 7 schema — identity, bilingual catalog, and pricing (illustrative, not exhaustive)
```prisma
// apps/api/prisma.config.ts  — NEW in Prisma 7: datasource URL moved OUT of schema.prisma
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```
```prisma
// apps/api/prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL") // still declared here too; actual value is read via prisma.config.ts for CLI ops
}

generator client {
  provider = "prisma-client"   // Prisma 7 client generator
  output   = "./generated/prisma" // output is now REQUIRED, not optional
}

enum AccountType { STAFF RETAIL_CUSTOMER BUSINESS_ACCOUNT }
enum StaffRole { SUPER_ADMIN SALES WAREHOUSE CONTENT }
enum BusinessType { RETAIL_STORE SCHOOL DISTRIBUTOR }
enum BusinessApprovalStatus { PENDING APPROVED REJECTED }
enum Locale { VI EN }
enum Gender { BOY GIRL UNISEX }
enum ChannelScope { RETAIL_ONLY WHOLESALE_ONLY BOTH } // "hàng sỉ, hàng lẻ" classification, PITFALLS.md Pitfall 1

model Account {
  id              String    @id @default(cuid())
  email           String    @unique
  passwordHash    String
  type            AccountType
  isActive        Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  staffProfile    StaffProfile?
  customerProfile CustomerProfile?
  businessAccount BusinessAccount?
  refreshTokens   RefreshToken[]
  resetTokens     PasswordResetToken[]

  @@map("accounts")
}

model StaffProfile {
  id        String   @id @default(cuid())
  accountId String   @unique
  account   Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  fullName  String
  role      StaffRole
  @@map("staff_profiles")
}

model CustomerProfile {
  id        String   @id @default(cuid())
  accountId String   @unique
  account   Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  fullName  String?
  phone     String?
  @@map("customer_profiles")
}

model BusinessAccount {
  id                  String                 @id @default(cuid())
  accountId           String                 @unique
  account             Account                @relation(fields: [accountId], references: [id], onDelete: Cascade)
  companyName         String
  taxId               String                 @unique            // mã số thuế
  businessLicenseUrl  String?                                   // MinIO object key — proof document (AUTH-03)
  businessType        BusinessType
  approvalStatus      BusinessApprovalStatus @default(PENDING)  // full approval WORKFLOW ships in Phase 4 (B2B-02)
  rejectionReason     String?
  priceTierId         String?
  priceTier           PriceTier?             @relation(fields: [priceTierId], references: [id])
  @@map("business_accounts")
}

model RefreshToken {
  id        String    @id @default(cuid())
  accountId String
  account   Account   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  tokenHash String    @unique   // never store the raw token — SHA-256 hash only
  expiresAt DateTime
  revokedAt DateTime?
  @@map("refresh_tokens")
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  accountId String
  account   Account   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  @@map("password_reset_tokens")
}

model Product {
  id           String               @id @default(cuid())
  brandId      String?
  brand        Brand?               @relation(fields: [brandId], references: [id])
  categoryId   String
  category     Category             @relation(fields: [categoryId], references: [id])
  ageRangeMin  Int
  ageRangeMax  Int
  gender       Gender               @default(UNISEX)
  origin       String
  channelScope ChannelScope         @default(BOTH)
  translations ProductTranslation[]
  variants     ProductVariant[]
  media        ProductMedia[]
  @@map("products")
}

model ProductTranslation {
  id          String   @id @default(cuid())
  productId   String
  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  locale      Locale
  name        String
  slug        String
  description String?
  @@unique([productId, locale])
  @@unique([locale, slug])   // per-locale slug uniqueness — PITFALLS.md Pitfall 9
  @@map("product_translations")
}

model ProductVariant {
  id                    String                 @id @default(cuid())
  productId             String
  product               Product                @relation(fields: [productId], references: [id], onDelete: Cascade)
  sku                   String                 @unique
  barcode               String?                @unique
  unitsPerInnerBox      Int?
  unitsPerMasterCarton  Int?
  cartonLengthCm        Decimal?               @db.Decimal(8, 2)
  cartonWidthCm         Decimal?               @db.Decimal(8, 2)
  cartonHeightCm        Decimal?               @db.Decimal(8, 2)
  cartonWeightKg        Decimal?               @db.Decimal(8, 3)
  certifications        SafetyCertification[]
  priceListEntries      PriceListEntry[]
  stock                 VariantStock?
  @@map("product_variants")
}

model SafetyCertification {
  id          String         @id @default(cuid())
  variantId   String
  variant     ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  certNumber  String         // số hợp quy QCVN
  issuingBody String
  validFrom   DateTime
  validTo     DateTime
  batchLabel  String?        // free-text placeholder; Phase 2 links this to a real StockLot instead
  @@map("safety_certifications")
}

model ProductMedia {
  id        String   @id @default(cuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  type      String   // "IMAGE" | "VIDEO"
  url       String   // MinIO object URL/key
  sortOrder Int      @default(0)
  @@map("product_media")
}

model Category {
  id           String                 @id @default(cuid())
  parentId     String?
  parent       Category?              @relation("CategoryTree", fields: [parentId], references: [id])
  children     Category[]             @relation("CategoryTree")
  translations CategoryTranslation[]
  products     Product[]
  @@map("categories")
}

model CategoryTranslation {
  id         String   @id @default(cuid())
  categoryId String
  category   Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  locale     Locale
  name       String
  slug       String
  @@unique([categoryId, locale])
  @@unique([locale, slug])
  @@map("category_translations")
}

model Brand {
  id       String    @id @default(cuid())
  name     String    @unique
  products Product[]
  @@map("brands")
}

model PriceTier {
  id               String            @id @default(cuid())
  code             String            @unique  // "RETAIL", "DEALER_A", "DEALER_B"
  name             String
  isDefault        Boolean           @default(false)
  entries          PriceListEntry[]
  businessAccounts BusinessAccount[]
  @@map("price_tiers")
}

model PriceListEntry {
  id           String         @id @default(cuid())
  variantId    String
  variant      ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  tierId       String
  tier         PriceTier      @relation(fields: [tierId], references: [id])
  minQty       Int            @default(1)   // Phase 4 quantity breaks reuse this column, no migration needed
  unitPriceVnd BigInt                       // VND is decimal-free — integer only, never Float
  validFrom    DateTime       @default(now())
  validTo      DateTime?
  @@unique([variantId, tierId, minQty])
  @@map("price_list_entries")
}

// Minimal Phase 1 stock signal — CATALOG-08 only needs a status, not a ledger.
// Phase 2 (INV-01..08) replaces the storage behind this with a real
// SKU × Warehouse × Batch ledger (PITFALLS.md Pitfall 4); keep the read
// contract (a per-variant "available quantity") stable so the catalog
// API doesn't need to change shape when that migration happens.
model VariantStock {
  variantId        String         @id
  variant          ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  quantityOnHand   Int            @default(0)
  reorderThreshold Int            @default(0)
  updatedAt        DateTime       @updatedAt
  @@map("variant_stock")
}
```
```typescript
// apps/api/src/prisma/prisma.service.ts — Prisma 7 requires a driver adapter, no bundled engine binary
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../prisma/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }
  async onModuleInit() { await this.$connect(); }
}
```
Source: Prisma 7 upgrade guide `[CITED: https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7 — fetched this session]`; identity/pricing/bilingual table shapes are original design applying PITFALLS.md Pitfalls 1 and 9 and ARCHITECTURE.md Pattern 1/2 to this phase's requirements `[MEDIUM confidence — pattern application, not a copied reference schema]`.

### next-intl v4 App Router setup (storefront)
```typescript
// apps/web/src/i18n/routing.ts
import { defineRouting } from 'next-intl/routing';
export const routing = defineRouting({
  locales: ['vi', 'en'],
  defaultLocale: 'vi', // primary market — see Assumptions Log A1
});

// apps/web/src/proxy.ts  (next-intl v4 renamed middleware.ts → proxy.ts)
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
export default createMiddleware(routing);
export const config = { matcher: '/((?!api|_next|_vercel|.*\\..*).*)' };

// apps/web/src/i18n/request.ts
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';
export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) ?? routing.defaultLocale;
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});

// apps/web/src/i18n/navigation.ts
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';
export const { Link, redirect, usePathname, useRouter } = createNavigation(routing);

// apps/web/next.config.ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
const nextConfig: NextConfig = { output: 'standalone' };
export default createNextIntlPlugin()(nextConfig);
```
Directory: `app/[locale]/layout.tsx` must call `generateStaticParams()` returning `routing.locales.map(locale => ({ locale }))`, since the `[locale]` segment is dynamic.
Source: `[CITED: https://next-intl.dev/docs/routing/setup and /docs/getting-started/app-router — fetched this session]`.

### Anti-Patterns to Avoid
- **Hardcoded `if (account.type === 'BUSINESS_ACCOUNT') price *= 0.8`** anywhere outside `PriceResolutionService` — PITFALLS.md Pitfall 1 names this exact shape as the retrofit trap.
- **A single language column with no `locale` dimension** on any user-facing text field (product name, category name, later: articles/banners) — PITFALLS.md Pitfall 9.
- **Bare `pnpm add prisma`** — resolves to the 8.0.0-rc.15 release candidate as of this session; always pin `@7`.
- **Serving `businessLicenseUrl` or any uploaded document from a public/static MinIO path** — must go through an authenticated endpoint (PITFALLS.md Security Mistakes).
- **Using `nest generate app`** (Nest CLI's own monorepo mode) inside a pnpm/Turborepo workspace — creates a conflicting nested-monorepo structure; use a standalone Nest project per app instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | Custom hash/salt scheme | `bcrypt` (cost factor ≥ 12) | Battle-tested, resistant to timing attacks; hand-rolled hashing is a top OWASP finding |
| JWT sign/verify | Manual `crypto.sign`/base64 JWT construction | `@nestjs/jwt` + `passport-jwt` | Handles expiry, algorithm pinning, and header/payload edge cases correctly |
| Password reset / refresh token generation | `Math.random()`-based tokens | `crypto.randomBytes(32).toString('hex')`, store only the SHA-256 hash | `Math.random()` is not cryptographically secure; storing raw tokens is a DB-leak exposure risk |
| Locale-aware routing | Custom `[locale]` cookie/redirect middleware | `next-intl`'s `createMiddleware`/`defineRouting` | Handles locale negotiation, prefix strategy, and static-generation eligibility correctly out of the box |
| Price computation per request | Inline `if (dealer) price * discount` in controllers/cart/checkout | Single `PriceResolutionService` | Prevents the exact price-logic duplication/drift ARCHITECTURE.md Anti-Pattern 3 and PITFALLS.md Pitfall 1 both warn about |

**Key insight:** every "don't hand-roll" item above maps to a named pitfall or anti-pattern already surfaced in this project's own prior research — Phase 1's job is to make sure the *first* implementation of each is the correct one, since PITFALLS.md rates all of these as HIGH recovery cost if built wrong.

## Common Pitfalls

### Pitfall 1: B2C-first schema retrofitted for B2B pricing (imported from PITFALLS.md)
**What goes wrong / why it happens / how to avoid:** See PITFALLS.md Pitfall 1 in full; this phase's schema (`PriceTier`/`PriceListEntry`) is the direct mitigation — do not let `ProductVariant` grow a second price column under time pressure.
**Warning signs:** A column literally named `gia_si`/`wholesale_price` next to `gia_le`/`retail_price`; pricing conditionals scattered across controllers instead of centralized in `PriceResolutionService`.
**Phase to address:** This phase, before Phase 3/4 storefront work begins.

### Pitfall 2: Bilingual content modeled as duplicate rows or JSON blobs bolted on late (imported from PITFALLS.md Pitfall 9)
**What goes wrong / why it happens / how to avoid:** See PITFALLS.md Pitfall 9 in full; this phase's `ProductTranslation`/`CategoryTranslation` tables with `@@unique([locale, slug])` are the mitigation.
**Warning signs:** Only one language column per text field; slug uniqueness constraint that's global instead of per-locale.
**Phase to address:** This phase — cheap now, expensive once content exists.

### Pitfall 3: NestJS CLI monorepo mode confused with pnpm/Turborepo monorepo
**What goes wrong:** Running `nest generate app` at the repo root (instead of `nest new api` inside `apps/`) creates Nest's own internal `apps/`/`libs/` structure governed by a root `nest-cli.json` — which collides conceptually and sometimes literally (duplicate `apps/` folder semantics) with the pnpm-workspace `apps/api` / `apps/web` structure this project needs.
**Why it happens:** Both tools use the word "monorepo" and an `apps/` folder name, and NestJS's own docs don't mention pnpm/Turborepo at all, so it's easy to reach for the Nest-native command first.
**How to avoid:** Scaffold `apps/api` as a **standalone** Nest project (`cd apps && pnpm dlx @nestjs/cli@11 new api`), never use `nest generate app` at the workspace root.
**Warning signs:** A `nest-cli.json` at the repo root instead of inside `apps/api/`; Nest CLI commands behaving as if `apps/web` is also a Nest sub-project.
**Phase to address:** This phase, at initial scaffolding — wrong structure here is annoying (not catastrophic) to unwind later, but still worth getting right on the first commit.

### Pitfall 4: Assuming `prisma add`/`pnpm add prisma` installs Prisma 7
**What goes wrong:** `npm view prisma version` (the `latest` dist-tag) currently resolves to `8.0.0-rc.15` — an unqualified install pulls in a release candidate that STACK.md explicitly flags as missing `$extends`, most nested writes, and transaction isolation levels needed for correct order/inventory transactions in later phases.
**Why it happens:** Training data and most tutorials assume `latest` means "the stable version."
**How to avoid:** Always `pnpm add prisma@7 @prisma/client@7 @prisma/adapter-pg@7` with an explicit major version pin; verify with `pnpm list prisma` after install.
**Warning signs:** `package.json` shows `"prisma": "^8.0.0-rc..."` or Prisma CLI output mentioning "release candidate."
**Phase to address:** This phase, at first dependency install — verified live this session (2026-09-21).

## Code Examples

See the Prisma schema, `PriceResolutionService`, `JwtStrategy`/`RolesGuard`, and `next-intl` setup blocks above under Architecture Patterns — all verified/cited inline.

### Docker Compose skeleton (dev-first, VPS-deploy-ready)
```yaml
# docker-compose.yml — base services, internal network only (no host ports published)
name: kid-toy
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-kidtoy}
      POSTGRES_USER: ${POSTGRES_USER:-kidtoy}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?err}   # fail fast if unset — never default a real password
    volumes: [pg_data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-kidtoy}"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [internal]

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes: [redis_data:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [internal]

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?err}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?err}
    volumes: [minio_data:/data]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [internal]

networks:
  internal: {}

volumes:
  pg_data: {}
  redis_data: {}
  minio_data: {}
```
```yaml
# docker-compose.dev.yml — local-only override: expose ports for direct tooling (Prisma Studio, redis-cli, mc)
# NOTE: bind to 127.0.0.1 explicitly, never 0.0.0.0 — PITFALLS.md Pitfall 6 (Docker/iptables bypasses ufw)
services:
  postgres:
    ports: ["127.0.0.1:5432:5432"]
  redis:
    ports: ["127.0.0.1:6379:6379"]
  minio:
    ports:
      - "127.0.0.1:9000:9000"
      - "127.0.0.1:9001:9001"
```
`apps/api` and `apps/web` run via `pnpm turbo run dev` directly on the host against this compose stack in Phase 1 — they are **not** containerized yet (matches the phase scope note: "api/web can come later phases if needed"). A `docker-compose.prod.yml` adding `api`/`web`/`caddy` services is architecture-ready per ARCHITECTURE.md's topology but not required to satisfy any Phase 1 requirement (see Open Questions — no dedicated deploy phase exists in ROADMAP.md yet).

### Monorepo scaffolding commands
```bash
# 1. Workspace root
corepack enable pnpm
pnpm init
cat > pnpm-workspace.yaml <<'YAML'
packages:
  - "apps/*"
  - "packages/*"
YAML
pnpm add -D -w turbo@2.11.2 typescript@5.9

# 2. NestJS backend — STANDALONE project, not Nest CLI monorepo mode (see Pitfall 3)
mkdir -p apps && cd apps
pnpm dlx @nestjs/cli@11 new api --package-manager pnpm --skip-git
cd api
pnpm add @nestjs/config@4.0.4 @nestjs/passport@11 @nestjs/jwt@11 \
  passport passport-jwt passport-local bcrypt @nestjs/throttler@6 @nestjs/swagger@11 \
  class-validator class-transformer zod @aws-sdk/client-s3 @aws-sdk/lib-storage \
  prisma@7 @prisma/client@7 @prisma/adapter-pg@7
pnpm dlx prisma@7 init --datasource-provider postgresql
cd ../..

# 3. Next.js storefront
pnpm dlx create-next-app@16 apps/web --typescript --app --src-dir --eslint --import-alias "@/*"
pnpm --filter web add next-intl@4

# 4. shared-types package
mkdir -p packages/shared-types/src
```
```json
// turbo.json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": [".next/**", "!.next/cache/**", "dist/**"] },
    "dev":       { "cache": false, "persistent": true },
    "lint":      {},
    "test":      {},
    "typecheck": {}
  }
}
```
Sources: `[CITED: https://docs.nestjs.com/cli/monorepo — official, confirms it does not cover this combination]`; `[MEDIUM confidence: WebSearch aggregate of sitek94/pnpm-monorepo, vndevteam/nestjs-turbo, multiple Medium/dev.to walkthroughs — all converge on the standalone-project pattern]`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Prisma datasource `url` inline in `schema.prisma` | `prisma.config.ts` at project root owns `datasource.url`/`shadowDatabaseUrl`; `directUrl` removed | Prisma 7 (2026) | Every prior tutorial's `schema.prisma` datasource block is now incomplete on its own — must pair with `prisma.config.ts` |
| `new PrismaClient()` with bundled Rust query engine | `new PrismaClient({ adapter })` with an explicit driver adapter (`@prisma/adapter-pg`) | Prisma 7 (2026) | Smaller Docker images/faster cold start (relevant for this project's single-VPS constraint), but every `PrismaService` boilerplate must be updated |
| `middleware.ts` for next-intl locale negotiation | Renamed `proxy.ts` | next-intl v4 | Cosmetic but breaking if copying older next-intl tutorials verbatim |
| `prisma migrate dev` auto-running `prisma generate` and seed | Both are now explicit, separate steps | Prisma 7 (2026) | CI/dev scripts written against Prisma 5/6 habits will silently skip codegen/seed unless updated |

**Deprecated/outdated:** Any Prisma 7 guidance copied from a pre-2026 tutorial that puts `url = env("DATABASE_URL")` alone in `schema.prisma` without a companion `prisma.config.ts` — will fail `migrate`/`generate` with a "datasource property is required in your Prisma config file" error `[CITED: github.com/prisma/prisma issue #28585, cross-referenced against the official v7 upgrade guide]`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Fallback/default locale for missing translations and `next-intl` `defaultLocale` should be `vi` (Vietnamese), since it's the primary market and the source requirements doc is itself Vietnamese | next-intl setup, ProductTranslation design | Low-medium — if the business actually wants English-first (e.g., international B2B buyers as primary audience), routing/fallback config is a small, localized change, not a schema migration, since the `locale` dimension already exists either way |
| A2 | Phase 1 scaffolds a single `apps/web` storefront (not the three separate `storefront`/`dealer-portal`/`admin` Next.js apps ARCHITECTURE.md recommends); admin CRUD (CATALOG-01..05, staff RBAC) is satisfied via NestJS controllers + Swagger (and/or minimal admin routes within `apps/web`) rather than a dedicated polished admin app in this phase | Summary, Project Structure | Medium — if the user actually expects a real staff-facing admin UI to exist by the end of Phase 1 (not just API/Swagger), the plan under-scopes UI work; flagged explicitly as Open Question 1 below for confirmation before planning |
| A3 | `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` versions carried forward from STACK.md were not re-verified against the npm registry this session (out of scope of the version checks performed) | Standard Stack (Supporting) | Low — AWS SDK v3 packages are extremely stable/official; risk is limited to a possible minor-version drift, not a wrong package |
| A4 | `nestjs-i18n` (backend API error-message i18n) is optional scope for Phase 1 — recommended to defer to Phase 7 ("i18n Polish") unless a Phase 1 requirement explicitly needs bilingual API error responses | Standard Stack (Supporting) | Low — REQUIREMENTS.md's CATALOG-09/ADMIN-04 split bilingual catalog (Phase 1) from bilingual admin interface (Phase 7 per ROADMAP.md), supporting this reading, but worth planner confirmation |

## Open Questions (RESOLVED)

1. **How much admin/staff UI does Phase 1 actually need to build, given it has no `UI hint: yes` flag in ROADMAP.md while Phases 3, 4, 7 do?**
   - What we know: CATALOG-01..05 and AUTH-01/04 require an admin/staff to *perform* CRUD and RBAC-gated actions; ROADMAP.md's Phase 7 goal explicitly owns "Admin Console... governed control center" with audit logging/Excel/dashboard polish.
   - What's unclear: Whether "admin can create/edit product" in Phase 1 must be satisfied by a real (if minimal) UI screen, or whether NestJS Swagger UI + direct API calls is an acceptable Phase 1 deliverable, with a real admin screen arriving in Phase 7.
   - Recommendation: Default to a minimal protected admin route-group inside `apps/web` (or a bare `apps/admin` shell) sufficient to prove the RBAC/CRUD/pricing flows end-to-end, deferring visual polish and audit/Excel features to Phase 7 — confirm this scoping with the user/planner before committing to full admin-app scaffolding.
   - **RESOLVED:** Confirmed — Phase 1 ships a minimal, functional-but-unstyled protected admin route group inside `apps/web` (Plan 10), sufficient to prove RBAC/CRUD/pricing end-to-end. Visual polish, audit log, and Excel import/export are Phase 7 scope. No admin-app scaffolding split-off was needed.

2. **Is a dedicated deploy/infrastructure phase missing from ROADMAP.md?**
   - What we know: PITFALLS.md Pitfall 6 explicitly recommends addressing single-VPS Docker reliability (backups, restart policy, port exposure) "ideally early (a walking skeleton deploy phase)," and DEV_PROMPT.md's original request explicitly names a VPS deploy target (`69.197.177.130`) and asks for CI/CD. ROADMAP.md's 7 phases have no phase explicitly named "Deployment/Infrastructure."
   - What's unclear: Whether Phase 1's Docker Compose skeleton is meant to only support local dev (as this research assumes, per the phase description's own wording: "api/web can come later phases if needed"), or whether a production `docker-compose.prod.yml` + CI/CD pipeline to the VPS should also land during Phase 1 as the "foundation."
   - Recommendation: Treat Phase 1's Docker scope as **local-dev-only** (postgres/redis/minio skeleton, `apps/api`/`apps/web` run via `pnpm dev` on the host) per the explicit phase-description wording provided to this research task; flag to the user that no phase in the current roadmap owns "first production deploy to the VPS" and confirm whether that should be inserted (e.g., as a decimal phase near the end, or folded into Phase 7).
   - **RESOLVED:** Local-dev Docker Compose (postgres/redis/minio) is required in Phase 1 (Plan 01). A first production deploy to the target VPS was additionally folded into Phase 1 as Plan 11 (not deferred) — since the user explicitly asked for the VPS wired up as the build/test/deploy target from the start — producing a `docker-compose.prod.yml` behind Caddy, deployed via SSH, with credentials read only from the untracked `.env.deploy`. No dedicated later infra phase is needed; ongoing deploy hardening (automated backups, real email transport, TLS renewal monitoring) is tracked as explicit follow-up in SKELETON.md rather than a new phase.

3. **Does the B2B registration flow in Phase 1 (AUTH-03) need any admin-facing approval action, or is `BusinessAccount.approvalStatus` purely seed/DB-set until Phase 4?**
   - What we know: AUTH-03 only requires the business to *submit* a registration; B2B-02 ("Admin can review and approve/reject a dealer application with a reason") is explicitly scoped to Phase 4.
   - What's unclear: Whether Phase 1's success criterion ("approved B2B viewer" sees tier-resolved wholesale price) requires *any* UI/endpoint to flip `approvalStatus` to `APPROVED` and assign a `priceTierId`, or whether that's proven via a seed script / direct DB write / admin-only debug endpoint during Phase 1, with the real approval workflow arriving in Phase 4.
   - Recommendation: Build a minimal staff-only endpoint (`PATCH /admin/business-accounts/:id/approve`, RBAC-gated to SALES/SUPER_ADMIN) sufficient to demonstrate CATALOG-06's price-resolution success criterion end-to-end, without building B2B-01/02's full proof-document review UI — that full workflow is Phase 4 scope.
   - **RESOLVED:** Built exactly as recommended — a minimal staff-only `PATCH /admin/business-accounts/:id/approve` endpoint, RBAC-gated to SALES/SUPER_ADMIN (Plan 04 Task 2), plus a seeded pre-approved dealer account for tests. B2B-01/02's full proof-document review UI remains Phase 4 scope.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All JS/TS tooling | ✓ | v24.19.0 | — |
| npm | Bootstrap pnpm via corepack | ✓ | 11.17.0 | — |
| Corepack | Enabling pnpm | ✓ | 0.35.0 | — |
| pnpm | Workspace/package manager | ✗ (not yet enabled) | — | `corepack enable pnpm` — no separate install needed, ships with Node 24 |
| Docker / Docker Compose | Running postgres/redis/minio locally | ✗ | — | **No fallback** — Docker Desktop (or Docker Engine + Compose plugin) must be installed on the actual dev machine before `docker compose up` can run; this research/planning session ran on a machine without Docker installed. Schema/code authoring is unaffected; only live local-stack testing is blocked until Docker is installed. |
| git | Version control | ✓ | 2.54.0 | — (repo not yet initialized as a git repo — `git init` is a Phase 1 scaffolding step) |

**Missing dependencies with no fallback:**
- Docker / Docker Compose — required to actually run and test the postgres/redis/minio skeleton locally; must be installed on the machine that will execute this phase's plan (verify before the first execution task that touches `docker compose up`).

**Missing dependencies with fallback:**
- pnpm — install via `corepack enable pnpm` (bundled with Node 24, no separate download).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (NestJS 11's default test runner) for `apps/api`; Jest + React Testing Library recommended for `apps/web` unit tests (consistent with STACK.md's explicit "keep Jest, don't migrate to Vitest" guidance) |
| Config file | none yet — repo is empty; Wave 0 must scaffold both `apps/api/jest.config.ts` (generated automatically by `nest new`) and an equivalent for `apps/web` |
| Quick run command | `pnpm --filter api test -- --watch=false <pattern>` |
| Full suite command | `pnpm turbo run test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|-------------|
| AUTH-01 | Staff login issues JWT, session persists across refresh (refresh-token exchange) | integration | `pnpm --filter api test -- auth.controller.spec.ts` | ❌ Wave 0 |
| AUTH-02 | Retail customer register/login | integration | `pnpm --filter api test -- auth.controller.spec.ts` | ❌ Wave 0 |
| AUTH-03 | B2B registration stores tax ID/license/type, status PENDING | integration | `pnpm --filter api test -- business-account.controller.spec.ts` | ❌ Wave 0 |
| AUTH-04 | RolesGuard denies staff role without required role | unit | `pnpm --filter api test -- roles.guard.spec.ts` | ❌ Wave 0 |
| AUTH-05 | Password reset token single-use, expires | unit + integration | `pnpm --filter api test -- password-reset.service.spec.ts` | ❌ Wave 0 |
| CATALOG-01..05 | Product/variant CRUD persists all facet/cert/carton fields | integration | `pnpm --filter api test -- catalog.controller.spec.ts` | ❌ Wave 0 |
| CATALOG-06 | Price resolution returns retail for anonymous, tier price for approved B2B, default for pending B2B | unit | `pnpm --filter api test -- price-resolution.service.spec.ts` | ❌ Wave 0 |
| CATALOG-07 | Catalog filter by age/category/brand/origin returns correct subset | integration | `pnpm --filter api test -- catalog.controller.spec.ts` | ❌ Wave 0 |
| CATALOG-08 | Stock status derives IN/LOW/OUT correctly from quantity vs. threshold | unit | `pnpm --filter api test -- variant-stock.service.spec.ts` | ❌ Wave 0 |
| CATALOG-09 | Translation fallback and per-locale slug uniqueness enforced | integration | `pnpm --filter api test -- catalog.controller.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted Jest file for the module touched
- **Per wave merge:** `pnpm turbo run test` (full suite, cached per-package by Turborepo)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/api/jest.config.ts` — generated by `nest new`, verify it's committed and runnable
- [ ] `apps/api/test/setup.ts` (or equivalent) — shared fixtures: test DB connection/reset strategy (recommend a dedicated `kidtoy_test` Postgres database or transactional rollback per test, not the dev DB)
- [ ] `apps/web` test framework install: `pnpm --filter web add -D jest @testing-library/react @testing-library/jest-dom jest-environment-jsdom` — nothing exists yet
- [ ] Seed script (`apps/api/prisma/seed.ts`) providing a default `RETAIL` `PriceTier` and at least one seeded `BusinessAccount` with `APPROVED` status for CATALOG-06 integration tests

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | `bcrypt` (cost ≥ 12) password hashing; `passport-jwt` access token (short TTL, e.g. 15 min) + rotating refresh token (hashed at rest, revocable); `@nestjs/throttler` on `/auth/login`, `/auth/register`, `/auth/forgot-password` |
| V3 Session Management | yes | Refresh token rotation on every use (old token revoked, new one issued); logout/password-change revokes all outstanding refresh tokens for that `Account` |
| V4 Access Control | yes | `RolesGuard` + `@Roles()` decorator, deny-by-default (per PITFALLS.md "default-permissive RBAC" security mistake); every mutating admin endpoint tested for a 403 with an under-privileged role, not just hidden in UI |
| V5 Input Validation | yes | `class-validator` DTOs on every controller method; global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` |
| V6 Cryptography | yes | `bcrypt` for passwords (never hand-rolled); `crypto.randomBytes(32)` + SHA-256-hashed-at-rest for refresh/reset tokens; JWT secret loaded via `ConfigService`/`zod`-validated env, never hardcoded |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Credential stuffing / brute-force login | Tampering, DoS | `@nestjs/throttler` rate limit on `/auth/login`; consider progressive lockout in a later hardening pass |
| JWT algorithm confusion / tampering | Tampering | `passport-jwt` with an explicit `secretOrKey` and default HS256 — never accept an `alg: none` token; pin algorithm explicitly in strategy options |
| Business license / tax document exposure via guessable MinIO URL | Information Disclosure | Serve `businessLicenseUrl` only through an authenticated, RBAC-checked endpoint that generates a short-lived signed URL — never a public bucket path (PITFALLS.md Security Mistakes) |
| SQL injection | Tampering | Prisma's generated client parameterizes all queries by default; forbid raw `$queryRawUnsafe` with interpolated strings anywhere in the codebase |
| IDOR on `/customers/me`, `/business-accounts/me` profile endpoints | Elevation of Privilege | Always derive the target `accountId` from the verified JWT payload (`request.user.sub`), never from a client-supplied route/body parameter |
| Password reset token replay | Tampering | `PasswordResetToken.usedAt` marks single-use; `expiresAt` enforces a short window (recommend ≤ 1 hour); token value itself is a random 32-byte value, hashed at rest |

## Sources

### Primary (HIGH confidence)
- `npm view <pkg> version / versions / peerDependencies / engines` — live registry checks performed this session for every package version cited above (2026-09-21)
- [Prisma 7 upgrade guide — official docs](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7) — fetched this session; `prisma.config.ts` structure, datasource block changes, adapter requirement
- [next-intl: Setup locale-based routing — official docs](https://next-intl.dev/docs/routing/setup) — fetched this session; `routing.ts`/`proxy.ts`/`navigation.ts` code
- [next-intl: App Router getting started — official docs](https://next-intl.dev/docs/getting-started/app-router) — fetched this session; `request.ts`/`next.config.ts` code
- [NestJS CLI Workspaces (monorepo mode) — official docs](https://docs.nestjs.com/cli/monorepo) — fetched this session; confirms no pnpm/Turborepo-specific guidance exists

### Secondary (MEDIUM confidence)
- WebSearch aggregate: pnpm+Turborepo+NestJS+Next.js monorepo setup (`sitek94/pnpm-monorepo`, `vndevteam/nestjs-turbo`, multiple Medium/dev.to walkthroughs) — converging on "standalone Nest project per app" pattern
- WebSearch aggregate: NestJS Passport JWT multi-role guard patterns (Medium, dev.to, Encore.dev, Shpota.com) — converging on Guard+Strategy+`@Roles()` decorator pattern
- WebSearch aggregate: e-commerce tier-pricing/price-book schema patterns (Adobe Commerce, commercetools docs, Oscprofessionals) — converging on quantity-break `minQty` + customer-group tier pattern
- WebSearch aggregate: Prisma multi-role RBAC schema (dev.to, ZenStack blog, Schemity) — converging on enum-discriminator + extension-table pattern over separate role tables
- `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md` (this project's own prior research phase, 2026-09-21) — HIGH confidence as project-specific source of truth; carried forward and applied to Phase 1 scope in this document

### Tertiary (LOW confidence)
- None used without cross-verification this session.

## Metadata

**Confidence breakdown:**
- Standard stack (versions): HIGH — every version live-verified against npm registry this session
- Package legitimacy: LOW-MEDIUM by protocol (slopcheck unavailable, all tagged `[ASSUMED]`) despite all packages being long-established official/high-download libraries
- Schema design (identity, bilingual, pricing): MEDIUM-HIGH — directly applies this project's own already-vetted PITFALLS.md/ARCHITECTURE.md patterns to Phase 1's specific requirements; not copied from an external reference schema
- Monorepo scaffolding glue (pnpm+Turborepo+standalone Nest): MEDIUM — no single authoritative source covers this exact combination; corroborated across multiple independent community sources
- Docker Compose skeleton: HIGH for security/reliability practices (directly sourced from this project's own PITFALLS.md Pitfall 6), MEDIUM for exact image tags (not re-verified against Docker Hub this session, carried from STACK.md)

**Research date:** 2026-09-21
**Valid until:** ~30 days for architecture/schema guidance (stable once decided); ~7-14 days for exact package versions given this stack sits on several recently-released majors (Next.js 16, Prisma 7, NestJS 11 with Nest 12 already shipping) — re-run `npm view` checks if planning is delayed beyond that window.

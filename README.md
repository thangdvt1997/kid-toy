# Kid Toy

B2C/B2B toy import-export platform. Bilingual (vi/en) storefront + dealer portal
sharing one product catalog, inventory, and pricing backend.

## Prerequisites

- Node.js 24.19+ (bundled Corepack)
- Corepack-enabled pnpm — run `corepack enable pnpm` once per machine
- Docker Desktop (Windows/Mac) or Docker Engine + the Compose plugin (Linux)

## Getting started

```bash
corepack enable pnpm
pnpm install
cp .env.example .env   # fill in real local values — never commit .env
```

## Local development

Start the data stack (PostgreSQL, Redis, MinIO):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Then run both apps (`apps/api` on port 4000, `apps/web` on port 3000):

```bash
pnpm turbo run dev
```

This pair — Docker Compose data stack + `pnpm turbo run dev` — is the documented
local full-stack run for this project. `apps/api` and `apps/web` are not
containerized in Phase 1; they run directly on the host against the Dockerized
data stack.

## Workspace layout

- `apps/api` — standalone NestJS 11 API (pnpm workspace member, not Nest CLI monorepo mode)
- `apps/web` — Next.js 16 bilingual (vi/en) storefront using next-intl
- `packages/shared-types` — DTO/type definitions shared between `api` and `web` via `workspace:*`

## Testing

Three tiers, each with a distinct database/infra requirement — never mix them up:

| Command | Scope | Requires |
|---------|-------|----------|
| `pnpm test` | Routine unit tests for both `apps/api` and `apps/web` (mocked dependencies, no network/DB) | Nothing — safe to run anywhere, anytime |
| `pnpm --filter api test:integration` | Database-backed specs (currently: `price-resolution.service.integration-spec.ts`, which needs real seeded tier/entry rows to prove SQL-level ordering/filtering) | `apps/api/.env.test` pointed at the dedicated `kidtoy_test` database (see `apps/api/.env.test.example`) — refuses to run against anything else |
| `pnpm --filter api test:e2e` | Full API HTTP e2e suite (`apps/api/test/*.e2e-spec.ts`) | Same `kidtoy_test` database — TRUNCATEs every table before seeding, never point this at dev/prod |
| `pnpm --filter web test:e2e` | Browser/HTTP-level auth-session regression coverage (`apps/web/test/*.e2e-spec.ts`) | A running internal-only preview of `apps/web` + its backing API, plus `E2E_WEB_BASE_URL`/`E2E_API_BASE_URL`/`E2E_SEED_EMAIL`/`E2E_SEED_PASSWORD` env vars — no default/fallback base URL, so a missing var fails loudly instead of silently probing an unintended host |

A database-backed spec is named `*.integration-spec.ts` (not `*.spec.ts`) specifically so
`apps/api`'s plain `pnpm test` never accidentally runs it against whatever
`DATABASE_URL` happens to be set to locally — only `test:integration`'s own Jest config
(`apps/api/test/jest-integration.json`) loads `.env.test` and matches that suffix.

## Secrets

Never commit `.env` or `.env.deploy`. `.env.example` documents every required
key with a placeholder value only. Deployment credentials for the VPS live
exclusively in `.env.deploy` (gitignored).

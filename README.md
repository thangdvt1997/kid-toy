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

## Secrets

Never commit `.env` or `.env.deploy`. `.env.example` documents every required
key with a placeholder value only. Deployment credentials for the VPS live
exclusively in `.env.deploy` (gitignored).

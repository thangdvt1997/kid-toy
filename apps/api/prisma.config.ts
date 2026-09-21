import { config } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Local dev secrets live in the repo-root `.env` (established in Plan 01,
// shared with docker-compose). This file always runs with apps/api as the
// working directory (`pnpm --filter api exec prisma ...`), so load the root
// file explicitly instead of relying on dotenv's default `./.env` lookup.
config({ path: resolve(process.cwd(), '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: env('DATABASE_URL'),
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
});

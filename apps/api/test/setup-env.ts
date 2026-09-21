import { config } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Jest `setupFiles` entry — runs before any test module is required, so
 * `process.env.DATABASE_URL` (and every other key) is populated from
 * `.env.test` before `test-app.ts`'s `assertTestDatabase()` or Nest's own
 * `ConfigModule.forRoot` ever inspect it. dotenv never overrides an
 * already-set env var, so this always wins over the repo-root `.env`
 * that `ConfigModule`/`prisma/seed.ts` also load as a fallback.
 */
config({ path: resolve(__dirname, '../.env.test') });

import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedDatabase } from '../../prisma/seed';

// Mirrors the BigInt shim in src/main.ts — without it, any response body
// containing a `unitPriceVnd` BigInt throws "Do not know how to serialize a
// BigInt" the first time supertest/JSON.stringify touches it. main.ts is
// never imported directly here (it would call bootstrap() and start a real
// HTTP listener), so the shim is duplicated rather than shared.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};

/**
 * Boots the full AppModule with the SAME global configuration main.ts
 * applies (global `api` prefix excluding `health`, the strict
 * ValidationPipe), against an isolated `kidtoy_test` database only.
 */
export async function createTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  assertTestDatabase();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.setGlobalPrefix('api', { exclude: ['health'] });

  await app.init();

  const prisma = app.get(PrismaService);
  return { app, prisma };
}

/**
 * Truncates every table (FK-safe via CASCADE, order-independent) and
 * re-runs the idempotent seed script. Call once per test file in
 * `beforeAll` — never against the dev database (see assertTestDatabase).
 */
export async function resetAndSeed(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "refresh_tokens", "password_reset_tokens", "staff_profiles", "customer_profiles",
      "business_accounts", "price_list_entries", "variant_stock", "safety_certifications",
      "product_media", "product_variants", "product_translations", "products",
      "category_translations", "categories", "brands", "price_tiers", "accounts"
    RESTART IDENTITY CASCADE;
  `);
  await seedDatabase(prisma);
}

/** Deterministic-prefix, collision-free email for one-off test accounts. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}+${randomUUID()}@test.local`;
}

/**
 * Refuses to run against anything but the dedicated test database — the
 * single most important safety rail in this file. A misconfigured
 * DATABASE_URL here would TRUNCATE the real dev/prod dataset.
 */
function assertTestDatabase(): void {
  const raw = process.env.DATABASE_URL ?? '';
  let dbName: string;
  try {
    dbName = new URL(raw).pathname.replace(/^\//, '');
  } catch {
    throw new Error(
      `Refusing to run e2e tests: DATABASE_URL is not a valid URL (got: "${raw}"). ` +
        'Copy apps/api/.env.test.example to apps/api/.env.test and point it at the kidtoy_test database.',
    );
  }
  if (dbName !== 'kidtoy_test') {
    throw new Error(
      `Refusing to run e2e tests against database "${dbName}" — DATABASE_URL must target ` +
        '"kidtoy_test", never the dev/prod database. Check apps/api/.env.test ' +
        '(see .env.test.example) and confirm test:e2e loads it.',
    );
  }
}

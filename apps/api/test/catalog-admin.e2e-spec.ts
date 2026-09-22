import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, resetAndSeed, uniqueEmail } from './utils/test-app';
import type { PrismaService } from '../src/prisma/prisma.service';

const SEED_PASSWORD = process.env.SEED_DEFAULT_PASSWORD as string;

describe('Catalog Admin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: App;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    server = app.getHttpServer() as App;
    await resetAndSeed(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function loginAs(email: string): Promise<string> {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email, password: SEED_PASSWORD })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  function bothLocaleTranslations(seed: string) {
    return [
      { locale: 'vi', name: `Ten ${seed}`, slug: `slug-vi-${seed}` },
      { locale: 'en', name: `Name ${seed}`, slug: `slug-en-${seed}` },
    ];
  }

  // -----------------------------------------------------------------
  // Taxonomy (Task 1) — CATALOG-09 write path: categories + brands
  // -----------------------------------------------------------------
  describe('taxonomy', () => {
    let contentToken: string;
    let adminToken: string;
    let salesToken: string;
    let warehouseToken: string;

    beforeAll(async () => {
      contentToken = await loginAs('content@kidtoy.local');
      adminToken = await loginAs('admin@kidtoy.local');
      salesToken = await loginAs('sales@kidtoy.local');
      warehouseToken = await loginAs('warehouse@kidtoy.local');
    });

    describe('POST /api/admin/categories', () => {
      it('1. creates a category with both vi + en translations (201) and exactly 2 translation rows', async () => {
        const seed = uniqueEmail('cat').split('@')[0]!;
        const res = await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ translations: bothLocaleTranslations(seed) })
          .expect(201);

        expect(res.body.translations.vi.name).toBe(`Ten ${seed}`);
        expect(res.body.translations.en.name).toBe(`Name ${seed}`);

        const count = await prisma.categoryTranslation.count({
          where: { categoryId: res.body.id as string },
        });
        expect(count).toBe(2);
      });

      it('2. rejects a vi-only translations array (400 BOTH_LOCALES_REQUIRED)', async () => {
        const seed = uniqueEmail('cat-vi-only').split('@')[0]!;
        const res = await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ translations: [{ locale: 'vi', name: 'X', slug: `x-${seed}` }] })
          .expect(400);
        expect(res.body.message).toBe('BOTH_LOCALES_REQUIRED');
      });

      it('3. rejects a duplicate-locale translations array (400)', async () => {
        const seed = uniqueEmail('cat-dup-locale').split('@')[0]!;
        await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({
            translations: [
              { locale: 'vi', name: 'X', slug: `x1-${seed}` },
              { locale: 'vi', name: 'Y', slug: `x2-${seed}` },
            ],
          })
          .expect(400);
      });

      it('4. rejects a duplicate en slug within the same locale (409)', async () => {
        const seed = uniqueEmail('cat-slug-dup').split('@')[0]!;
        await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ translations: bothLocaleTranslations(seed) })
          .expect(201);

        await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({
            translations: [
              { locale: 'vi', name: 'Khac', slug: `khac-${seed}` },
              { locale: 'en', name: 'Different', slug: `slug-en-${seed}` }, // same en slug as above
            ],
          })
          .expect(409);
      });

      it('5. allows the SAME slug string across different locales (per-locale uniqueness)', async () => {
        const shared = `shared-${uniqueEmail('x').split('@')[0]}`;
        await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({
            translations: [
              { locale: 'vi', name: 'Ten VI', slug: shared },
              { locale: 'en', name: 'Name EN', slug: `${shared}-en` },
            ],
          })
          .expect(201);

        // A DIFFERENT category using `shared` as its VI slug's own EN
        // counterpart proves cross-locale reuse is fine — reuse the exact
        // same string as the EN slug of a second, unrelated category.
        await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({
            translations: [
              { locale: 'vi', name: 'Ten VI 2', slug: `${shared}-vi2` },
              { locale: 'en', name: 'Name EN 2', slug: shared },
            ],
          })
          .expect(201);
      });

      it('6. rejects a non-existent parentId (400 PARENT_NOT_FOUND)', async () => {
        const seed = uniqueEmail('cat-parent').split('@')[0]!;
        const res = await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ parentId: 'does-not-exist', translations: bothLocaleTranslations(seed) })
          .expect(400);
        expect(res.body.message).toBe('PARENT_NOT_FOUND');
      });

      it('7. 403 for SALES and WAREHOUSE, 401 with no token, 201 for SUPER_ADMIN', async () => {
        const seed1 = uniqueEmail('cat-sales').split('@')[0]!;
        await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${salesToken}`)
          .send({ translations: bothLocaleTranslations(seed1) })
          .expect(403);

        const seed2 = uniqueEmail('cat-wh').split('@')[0]!;
        await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${warehouseToken}`)
          .send({ translations: bothLocaleTranslations(seed2) })
          .expect(403);

        const seed3 = uniqueEmail('cat-noauth').split('@')[0]!;
        await request(server)
          .post('/api/admin/categories')
          .send({ translations: bothLocaleTranslations(seed3) })
          .expect(401);

        const seed4 = uniqueEmail('cat-admin').split('@')[0]!;
        await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ translations: bothLocaleTranslations(seed4) })
          .expect(201);
      });
    });

    describe('PATCH /api/admin/categories/:id', () => {
      it('8. rejects pointing a category at itself (400 CATEGORY_CANNOT_PARENT_ITSELF)', async () => {
        const seed = uniqueEmail('cat-self').split('@')[0]!;
        const created = await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ translations: bothLocaleTranslations(seed) })
          .expect(201);

        const res = await request(server)
          .patch(`/api/admin/categories/${created.body.id}`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ parentId: created.body.id })
          .expect(400);
        expect(res.body.message).toBe('CATEGORY_CANNOT_PARENT_ITSELF');
      });
    });

    describe('GET /api/admin/categories', () => {
      it('9. returns every category with a translations object keyed vi and en', async () => {
        const res = await request(server)
          .get('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .expect(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        for (const row of res.body as Array<Record<string, unknown>>) {
          const translations = row.translations as Record<string, { name: string; slug: string }>;
          expect(translations.vi).toBeDefined();
          expect(translations.en).toBeDefined();
        }
      });

      it('10. 401 with no token', async () => {
        await request(server).get('/api/admin/categories').expect(401);
      });
    });

    describe('POST /api/admin/brands', () => {
      it('11. creates a brand (201)', async () => {
        const name = `Brand-${uniqueEmail('b').split('@')[0]}`;
        const res = await request(server)
          .post('/api/admin/brands')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ name, originCountry: 'VN' })
          .expect(201);
        expect(res.body.name).toBe(name);
      });

      it('12. rejects a duplicate brand name (409 BRAND_NAME_TAKEN)', async () => {
        const name = `Brand-Dup-${uniqueEmail('b').split('@')[0]}`;
        await request(server)
          .post('/api/admin/brands')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ name })
          .expect(201);

        const res = await request(server)
          .post('/api/admin/brands')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ name })
          .expect(409);
        expect(res.body.message).toBe('BRAND_NAME_TAKEN');
      });

      it('13. 403 for WAREHOUSE, 401 with no token', async () => {
        const name = `Brand-RBAC-${uniqueEmail('b').split('@')[0]}`;
        await request(server)
          .post('/api/admin/brands')
          .set('Authorization', `Bearer ${warehouseToken}`)
          .send({ name })
          .expect(403);
        await request(server).post('/api/admin/brands').send({ name }).expect(401);
      });
    });

    describe('taxonomy.admin.controller.ts RBAC self-check', () => {
      it('14. every route is gated (spot-check GET brands is also protected)', async () => {
        await request(server).get('/api/admin/brands').expect(401);
      });
    });
  });
});

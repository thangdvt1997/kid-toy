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

  // -----------------------------------------------------------------
  // Products, variants, certifications (Task 2) — CATALOG-01,03,04,05,09
  // -----------------------------------------------------------------
  describe('products, variants, certifications', () => {
    let contentToken: string;
    let adminToken: string;
    let salesToken: string;
    let warehouseToken: string;
    let categoryId: string;
    let brandId: string;

    beforeAll(async () => {
      contentToken = await loginAs('content@kidtoy.local');
      adminToken = await loginAs('admin@kidtoy.local');
      salesToken = await loginAs('sales@kidtoy.local');
      warehouseToken = await loginAs('warehouse@kidtoy.local');

      const seed = uniqueEmail('pv-cat').split('@')[0]!;
      const cat = await request(server)
        .post('/api/admin/categories')
        .set('Authorization', `Bearer ${contentToken}`)
        .send({ translations: bothLocaleTranslations(seed) })
        .expect(201);
      categoryId = cat.body.id as string;

      const brand = await request(server)
        .post('/api/admin/brands')
        .set('Authorization', `Bearer ${contentToken}`)
        .send({ name: `Brand-${seed}` })
        .expect(201);
      brandId = brand.body.id as string;
    });

    function baseProductBody(seed: string) {
      return {
        categoryId,
        brandId,
        ageRangeMin: 3,
        ageRangeMax: 6,
        gender: 'UNISEX',
        origin: 'VN',
        channelScope: 'BOTH',
        translations: [
          { locale: 'vi', name: `Ten ${seed}`, slug: `p-vi-${seed}`, description: 'Mo ta' },
          { locale: 'en', name: `Name ${seed}`, slug: `p-en-${seed}`, description: 'Description' },
        ],
      };
    }

    describe('POST /api/admin/products', () => {
      it('1. creates a product with both translations (201), 2 product_translations rows', async () => {
        const seed = uniqueEmail('prod').split('@')[0]!;
        const res = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send(baseProductBody(seed))
          .expect(201);
        expect(res.body.translations.vi.name).toBe(`Ten ${seed}`);
        expect(res.body.translations.en.name).toBe(`Name ${seed}`);

        const count = await prisma.productTranslation.count({
          where: { productId: res.body.id as string },
        });
        expect(count).toBe(2);
      });

      it('2. rejects ageRangeMin > ageRangeMax (400)', async () => {
        const seed = uniqueEmail('prod-age').split('@')[0]!;
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...baseProductBody(seed), ageRangeMin: 10, ageRangeMax: 5 })
          .expect(400);
      });

      it('3. rejects ageRangeMin < 0 or ageRangeMax > 18 (400)', async () => {
        const seed = uniqueEmail('prod-age2').split('@')[0]!;
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...baseProductBody(seed), ageRangeMin: -1 })
          .expect(400);

        const seed2 = uniqueEmail('prod-age3').split('@')[0]!;
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...baseProductBody(seed2), ageRangeMax: 19 })
          .expect(400);
      });

      it('4. rejects a non-existent categoryId (400 CATEGORY_NOT_FOUND)', async () => {
        const seed = uniqueEmail('prod-cat').split('@')[0]!;
        const res = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...baseProductBody(seed), categoryId: 'does-not-exist' })
          .expect(400);
        expect(res.body.message).toBe('CATEGORY_NOT_FOUND');
      });

      it('5. rejects a non-existent brandId (400 BRAND_NOT_FOUND)', async () => {
        const seed = uniqueEmail('prod-brand').split('@')[0]!;
        const res = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...baseProductBody(seed), brandId: 'does-not-exist' })
          .expect(400);
        expect(res.body.message).toBe('BRAND_NOT_FOUND');
      });

      it('6. rejects a missing locale (400 BOTH_LOCALES_REQUIRED)', async () => {
        const seed = uniqueEmail('prod-locale').split('@')[0]!;
        const body = baseProductBody(seed);
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...body, translations: [body.translations[0]] })
          .expect(400);
      });

      it('7. rejects a product slug colliding within the same locale (409 SLUG_TAKEN)', async () => {
        const seed = uniqueEmail('prod-slugdup').split('@')[0]!;
        const body = baseProductBody(seed);
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send(body)
          .expect(201);

        const seed2 = uniqueEmail('prod-slugdup2').split('@')[0]!;
        const body2 = baseProductBody(seed2);
        body2.translations[0]!.slug = body.translations[0]!.slug; // same VI slug
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send(body2)
          .expect(409);
      });

      it('8. 403 for SALES/WAREHOUSE, 401 with no token', async () => {
        const seed = uniqueEmail('prod-rbac').split('@')[0]!;
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${salesToken}`)
          .send(baseProductBody(seed))
          .expect(403);
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${warehouseToken}`)
          .send(baseProductBody(seed))
          .expect(403);
        await request(server).post('/api/admin/products').send(baseProductBody(seed)).expect(401);
      });
    });

    describe('PATCH /api/admin/products/:id', () => {
      it('9. updating only the en translation leaves the vi row untouched', async () => {
        const seed = uniqueEmail('prod-patch').split('@')[0]!;
        const created = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send(baseProductBody(seed))
          .expect(201);

        const res = await request(server)
          .patch(`/api/admin/products/${created.body.id}`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ translations: [{ locale: 'en', name: 'Updated EN', slug: `p-en-upd-${seed}` }] })
          .expect(200);

        expect(res.body.translations.en.name).toBe('Updated EN');
        expect(res.body.translations.vi.name).toBe(`Ten ${seed}`);
      });
    });

    describe('DELETE /api/admin/products/:id', () => {
      it('10. soft-deletes (204), row still exists with isActive=false', async () => {
        const seed = uniqueEmail('prod-del').split('@')[0]!;
        const created = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send(baseProductBody(seed))
          .expect(201);

        await request(server)
          .delete(`/api/admin/products/${created.body.id}`)
          .set('Authorization', `Bearer ${contentToken}`)
          .expect(204);

        const row = await prisma.product.findUniqueOrThrow({
          where: { id: created.body.id as string },
        });
        expect(row.isActive).toBe(false);
      });
    });

    describe('POST /api/admin/products/:id/variants', () => {
      let productId: string;

      beforeAll(async () => {
        const seed = uniqueEmail('prod-var').split('@')[0]!;
        const created = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send(baseProductBody(seed))
          .expect(201);
        productId = created.body.id as string;
      });

      it('11. persists sku, barcode, variantLabel and all five carton fields; round-trips exactly', async () => {
        const sku = `KT-E2E-${uniqueEmail('v').split('@')[0]!.slice(0, 8).toUpperCase()}`;
        const res = await request(server)
          .post(`/api/admin/products/${productId}/variants`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({
            sku,
            barcode: '8938500001234',
            variantLabel: 'Hop qua tang',
            unitsPerInnerBox: 6,
            unitsPerMasterCarton: 24,
            cartonLengthCm: 40.5,
            cartonWidthCm: 30.25,
            cartonHeightCm: 20,
            cartonWeightKg: 5.5,
          })
          .expect(201);

        expect(res.body.sku).toBe(sku);
        expect(res.body.barcode).toBe('8938500001234');
        expect(res.body.variantLabel).toBe('Hop qua tang');
        expect(res.body.unitsPerInnerBox).toBe(6);
        expect(res.body.unitsPerMasterCarton).toBe(24);
        expect(res.body.cartonLengthCm).toBe(40.5);
        expect(res.body.cartonWidthCm).toBe(30.25);
        expect(res.body.cartonHeightCm).toBe(20);
        expect(res.body.cartonWeightKg).toBe(5.5);
      });

      it('12. rejects a duplicate sku (409 SKU_TAKEN)', async () => {
        const sku = `KT-DUPE-${uniqueEmail('v').split('@')[0]!.slice(0, 8).toUpperCase()}`;
        await request(server)
          .post(`/api/admin/products/${productId}/variants`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ sku })
          .expect(201);

        const res = await request(server)
          .post(`/api/admin/products/${productId}/variants`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ sku })
          .expect(409);
        expect(res.body.message).toBe('SKU_TAKEN');
      });

      it('13. rejects a duplicate barcode (409 BARCODE_TAKEN)', async () => {
        const barcode = '8938500009999';
        const sku1 = `KT-BC1-${uniqueEmail('v').split('@')[0]!.slice(0, 8).toUpperCase()}`;
        await request(server)
          .post(`/api/admin/products/${productId}/variants`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ sku: sku1, barcode })
          .expect(201);

        const sku2 = `KT-BC2-${uniqueEmail('v').split('@')[0]!.slice(0, 8).toUpperCase()}`;
        const res = await request(server)
          .post(`/api/admin/products/${productId}/variants`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ sku: sku2, barcode })
          .expect(409);
        expect(res.body.message).toBe('BARCODE_TAKEN');
      });

      it('14. rejects unitsPerMasterCarton < unitsPerInnerBox (400)', async () => {
        const sku = `KT-CTN-${uniqueEmail('v').split('@')[0]!.slice(0, 8).toUpperCase()}`;
        await request(server)
          .post(`/api/admin/products/${productId}/variants`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ sku, unitsPerInnerBox: 12, unitsPerMasterCarton: 6 })
          .expect(400);
      });

      it('15. 403 for SALES, 401 with no token', async () => {
        const sku = `KT-RBAC-${uniqueEmail('v').split('@')[0]!.slice(0, 8).toUpperCase()}`;
        await request(server)
          .post(`/api/admin/products/${productId}/variants`)
          .set('Authorization', `Bearer ${salesToken}`)
          .send({ sku })
          .expect(403);
        await request(server)
          .post(`/api/admin/products/${productId}/variants`)
          .send({ sku })
          .expect(401);
      });
    });

    describe('POST /api/admin/variants/:variantId/certifications', () => {
      let variantId: string;

      beforeAll(async () => {
        const seed = uniqueEmail('prod-cert').split('@')[0]!;
        const product = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send(baseProductBody(seed))
          .expect(201);
        const sku = `KT-CERT-${uniqueEmail('v').split('@')[0]!.slice(0, 8).toUpperCase()}`;
        const variant = await request(server)
          .post(`/api/admin/products/${product.body.id}/variants`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ sku })
          .expect(201);
        variantId = variant.body.id as string;
      });

      it('16. persists certNumber, issuingBody, validFrom, validTo, batchLabel', async () => {
        const res = await request(server)
          .post(`/api/admin/variants/${variantId}/certifications`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({
            certNumber: 'QCVN3:2019/BKHCN-9001',
            issuingBody: 'QUATEST 3',
            validFrom: '2026-01-01T00:00:00.000Z',
            validTo: '2028-01-01T00:00:00.000Z',
            batchLabel: 'LOT-001',
          })
          .expect(201);
        expect(res.body.certNumber).toBe('QCVN3:2019/BKHCN-9001');
        expect(res.body.batchLabel).toBe('LOT-001');
      });

      it('17. rejects validTo <= validFrom (400)', async () => {
        await request(server)
          .post(`/api/admin/variants/${variantId}/certifications`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({
            certNumber: 'QCVN3:2019/BKHCN-9002',
            issuingBody: 'QUATEST 3',
            validFrom: '2028-01-01T00:00:00.000Z',
            validTo: '2026-01-01T00:00:00.000Z',
          })
          .expect(400);
      });

      it('18. 403 for WAREHOUSE, 401 with no token', async () => {
        const body = {
          certNumber: 'QCVN3:2019/BKHCN-9003',
          issuingBody: 'QUATEST 3',
          validFrom: '2026-01-01T00:00:00.000Z',
          validTo: '2028-01-01T00:00:00.000Z',
        };
        await request(server)
          .post(`/api/admin/variants/${variantId}/certifications`)
          .set('Authorization', `Bearer ${warehouseToken}`)
          .send(body)
          .expect(403);
        await request(server)
          .post(`/api/admin/variants/${variantId}/certifications`)
          .send(body)
          .expect(401);
      });

      it('19. SUPER_ADMIN can also create a certification (201)', async () => {
        await request(server)
          .post(`/api/admin/variants/${variantId}/certifications`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            certNumber: 'QCVN3:2019/BKHCN-9004',
            issuingBody: 'QUATEST 3',
            validFrom: '2026-01-01T00:00:00.000Z',
            validTo: '2028-01-01T00:00:00.000Z',
          })
          .expect(201);
      });
    });
  });
});

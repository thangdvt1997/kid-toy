import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, resetAndSeed } from './utils/test-app';
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

  /**
   * A URL-safe, collision-free seed for slugs/names in this file.
   * `uniqueEmail()`'s `prefix+<uuid>@test.local` shape is right for an
   * account email but NOT for a slug: the `+` it contains fails
   * UpsertTranslationDto's `^[a-z0-9]+(?:-[a-z0-9]+)*$` slug pattern, which
   * 400'd every single test in this file that built a slug from it (found
   * via a live e2e run against the VPS stack).
   */
  function slugSeed(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 8)}`;
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
        const seed = slugSeed('cat');
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
        const seed = slugSeed('cat-vi-only');
        const res = await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ translations: [{ locale: 'vi', name: 'X', slug: `x-${seed}` }] })
          .expect(400);
        expect(res.body.message).toBe('BOTH_LOCALES_REQUIRED');
      });

      it('3. rejects a duplicate-locale translations array (400)', async () => {
        const seed = slugSeed('cat-dup-locale');
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
        const seed = slugSeed('cat-slug-dup');
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
        const shared = `shared-${slugSeed('x')}`;
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
        const seed = slugSeed('cat-parent');
        const res = await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ parentId: 'does-not-exist', translations: bothLocaleTranslations(seed) })
          .expect(400);
        expect(res.body.message).toBe('PARENT_NOT_FOUND');
      });

      it('7. 403 for SALES and WAREHOUSE, 401 with no token, 201 for SUPER_ADMIN', async () => {
        const seed1 = slugSeed('cat-sales');
        await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${salesToken}`)
          .send({ translations: bothLocaleTranslations(seed1) })
          .expect(403);

        const seed2 = slugSeed('cat-wh');
        await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${warehouseToken}`)
          .send({ translations: bothLocaleTranslations(seed2) })
          .expect(403);

        const seed3 = slugSeed('cat-noauth');
        await request(server)
          .post('/api/admin/categories')
          .send({ translations: bothLocaleTranslations(seed3) })
          .expect(401);

        const seed4 = slugSeed('cat-admin');
        await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ translations: bothLocaleTranslations(seed4) })
          .expect(201);
      });
    });

    describe('PATCH /api/admin/categories/:id', () => {
      it('8. rejects pointing a category at itself (400 CATEGORY_CANNOT_PARENT_ITSELF)', async () => {
        const seed = slugSeed('cat-self');
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
        const name = `Brand-${slugSeed('b')}`;
        const res = await request(server)
          .post('/api/admin/brands')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ name, originCountry: 'VN' })
          .expect(201);
        expect(res.body.name).toBe(name);
      });

      it('12. rejects a duplicate brand name (409 BRAND_NAME_TAKEN)', async () => {
        const name = `Brand-Dup-${slugSeed('b')}`;
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
        const name = `Brand-RBAC-${slugSeed('b')}`;
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

      const seed = slugSeed('pv-cat');
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
        const seed = slugSeed('prod');
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
        const seed = slugSeed('prod-age');
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...baseProductBody(seed), ageRangeMin: 10, ageRangeMax: 5 })
          .expect(400);
      });

      it('3. rejects ageRangeMin < 0 or ageRangeMax > 18 (400)', async () => {
        const seed = slugSeed('prod-age2');
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...baseProductBody(seed), ageRangeMin: -1 })
          .expect(400);

        const seed2 = slugSeed('prod-age3');
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...baseProductBody(seed2), ageRangeMax: 19 })
          .expect(400);
      });

      it('4. rejects a non-existent categoryId (400 CATEGORY_NOT_FOUND)', async () => {
        const seed = slugSeed('prod-cat');
        const res = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...baseProductBody(seed), categoryId: 'does-not-exist' })
          .expect(400);
        expect(res.body.message).toBe('CATEGORY_NOT_FOUND');
      });

      it('5. rejects a non-existent brandId (400 BRAND_NOT_FOUND)', async () => {
        const seed = slugSeed('prod-brand');
        const res = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...baseProductBody(seed), brandId: 'does-not-exist' })
          .expect(400);
        expect(res.body.message).toBe('BRAND_NOT_FOUND');
      });

      it('6. rejects a missing locale (400 BOTH_LOCALES_REQUIRED)', async () => {
        const seed = slugSeed('prod-locale');
        const body = baseProductBody(seed);
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ ...body, translations: [body.translations[0]] })
          .expect(400);
      });

      it('7. rejects a product slug colliding within the same locale (409 SLUG_TAKEN)', async () => {
        const seed = slugSeed('prod-slugdup');
        const body = baseProductBody(seed);
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send(body)
          .expect(201);

        const seed2 = slugSeed('prod-slugdup2');
        const body2 = baseProductBody(seed2);
        body2.translations[0]!.slug = body.translations[0]!.slug; // same VI slug
        await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send(body2)
          .expect(409);
      });

      it('8. 403 for SALES/WAREHOUSE, 401 with no token', async () => {
        const seed = slugSeed('prod-rbac');
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
        const seed = slugSeed('prod-patch');
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
        const seed = slugSeed('prod-del');
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
        const seed = slugSeed('prod-var');
        const created = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send(baseProductBody(seed))
          .expect(201);
        productId = created.body.id as string;
      });

      it('11. persists sku, barcode, variantLabel and all five carton fields; round-trips exactly', async () => {
        const sku = `KT-E2E-${slugSeed('v').slice(0, 8).toUpperCase()}`;
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
        const sku = `KT-DUPE-${slugSeed('v').slice(0, 8).toUpperCase()}`;
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
        const sku1 = `KT-BC1-${slugSeed('v').slice(0, 8).toUpperCase()}`;
        await request(server)
          .post(`/api/admin/products/${productId}/variants`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ sku: sku1, barcode })
          .expect(201);

        const sku2 = `KT-BC2-${slugSeed('v').slice(0, 8).toUpperCase()}`;
        const res = await request(server)
          .post(`/api/admin/products/${productId}/variants`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ sku: sku2, barcode })
          .expect(409);
        expect(res.body.message).toBe('BARCODE_TAKEN');
      });

      it('14. rejects unitsPerMasterCarton < unitsPerInnerBox (400)', async () => {
        const sku = `KT-CTN-${slugSeed('v').slice(0, 8).toUpperCase()}`;
        await request(server)
          .post(`/api/admin/products/${productId}/variants`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ sku, unitsPerInnerBox: 12, unitsPerMasterCarton: 6 })
          .expect(400);
      });

      it('15. 403 for SALES, 401 with no token', async () => {
        const sku = `KT-RBAC-${slugSeed('v').slice(0, 8).toUpperCase()}`;
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
        const seed = slugSeed('prod-cert');
        const product = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send(baseProductBody(seed))
          .expect(201);
        const sku = `KT-CERT-${slugSeed('v').slice(0, 8).toUpperCase()}`;
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

  // -----------------------------------------------------------------
  // Media (Task 3) — CATALOG-02
  // -----------------------------------------------------------------
  describe('media', () => {
    let contentToken: string;
    let salesToken: string;
    let warehouseToken: string;
    let productId: string;

    /** A real, complete, minimal 1x1 JPEG — file-type parses real JPEG markers, not just SOI bytes. */
    function jpegBuffer(): Buffer {
      return Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
        'base64',
      );
    }

    /** A real minimal MP4 ftyp box — file-type parses the box structure, not just leading bytes. */
    function mp4Buffer(): Buffer {
      return Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x20]), // box size = 32
        Buffer.from('ftyp', 'ascii'),
        Buffer.from('isom', 'ascii'), // major brand
        Buffer.from([0x00, 0x00, 0x02, 0x00]), // minor version
        Buffer.from('isom', 'ascii'),
        Buffer.from('iso2', 'ascii'),
        Buffer.from('avc1', 'ascii'),
        Buffer.from('mp41', 'ascii'),
      ]);
    }

    function pdfBuffer(): Buffer {
      return Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF');
    }

    beforeAll(async () => {
      contentToken = await loginAs('content@kidtoy.local');
      salesToken = await loginAs('sales@kidtoy.local');
      warehouseToken = await loginAs('warehouse@kidtoy.local');

      const catSeed = slugSeed('media-cat');
      const cat = await request(server)
        .post('/api/admin/categories')
        .set('Authorization', `Bearer ${contentToken}`)
        .send({ translations: bothLocaleTranslations(catSeed) })
        .expect(201);

      const prodSeed = slugSeed('media-prod');
      const product = await request(server)
        .post('/api/admin/products')
        .set('Authorization', `Bearer ${contentToken}`)
        .send({
          categoryId: cat.body.id,
          ageRangeMin: 3,
          ageRangeMax: 6,
          gender: 'UNISEX',
          origin: 'VN',
          channelScope: 'BOTH',
          translations: [
            { locale: 'vi', name: `Ten ${prodSeed}`, slug: `m-vi-${prodSeed}` },
            { locale: 'en', name: `Name ${prodSeed}`, slug: `m-en-${prodSeed}` },
          ],
        })
        .expect(201);
      productId = product.body.id as string;
    });

    describe('POST /api/admin/products/:id/media', () => {
      it('1. uploads a JPEG image (201), objectKey starts with product-media/ and contains a UUID', async () => {
        const res = await request(server)
          .post(`/api/admin/products/${productId}/media`)
          .set('Authorization', `Bearer ${contentToken}`)
          .field('type', 'IMAGE')
          .attach('file', jpegBuffer(), 'photo.jpg')
          .expect(201);

        expect(res.body.type).toBe('IMAGE');
        expect(res.body.url).toContain('X-Amz-Signature');
        expect(res.body.objectKey).toBeUndefined();

        const row = await prisma.productMedia.findUniqueOrThrow({ where: { id: res.body.id } });
        expect(row.objectKey).toMatch(
          /^product-media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
        );
      });

      it('2. three sequential uploads to the same product get sortOrder 0, 1, 2', async () => {
        const seed = slugSeed('media-order');
        const cat = await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ translations: bothLocaleTranslations(seed) })
          .expect(201);
        const product = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({
            categoryId: cat.body.id,
            ageRangeMin: 3,
            ageRangeMax: 6,
            gender: 'UNISEX',
            origin: 'VN',
            channelScope: 'BOTH',
            translations: [
              { locale: 'vi', name: `Ten ${seed}`, slug: `mo-vi-${seed}` },
              { locale: 'en', name: `Name ${seed}`, slug: `mo-en-${seed}` },
            ],
          })
          .expect(201);
        const pid = product.body.id as string;

        const orders: number[] = [];
        for (let i = 0; i < 3; i += 1) {
          const res = await request(server)
            .post(`/api/admin/products/${pid}/media`)
            .set('Authorization', `Bearer ${contentToken}`)
            .field('type', 'IMAGE')
            .attach('file', jpegBuffer(), `photo-${i}.jpg`)
            .expect(201);
          orders.push(res.body.sortOrder as number);
        }
        expect(orders).toEqual([0, 1, 2]);
      });

      it('3. accepts video/mp4 for type=VIDEO', async () => {
        const res = await request(server)
          .post(`/api/admin/products/${productId}/media`)
          .set('Authorization', `Bearer ${contentToken}`)
          .field('type', 'VIDEO')
          .attach('file', mp4Buffer(), { filename: 'clip.mp4', contentType: 'video/mp4' })
          .expect(201);
        expect(res.body.type).toBe('VIDEO');
      });

      it('4. rejects an image mimetype submitted as type=VIDEO (400)', async () => {
        await request(server)
          .post(`/api/admin/products/${productId}/media`)
          .set('Authorization', `Bearer ${contentToken}`)
          .field('type', 'VIDEO')
          .attach('file', jpegBuffer(), 'photo.jpg')
          .expect(400);
      });

      it('5. rejects application/pdf for both IMAGE and VIDEO (400)', async () => {
        await request(server)
          .post(`/api/admin/products/${productId}/media`)
          .set('Authorization', `Bearer ${contentToken}`)
          .field('type', 'IMAGE')
          .attach('file', pdfBuffer(), 'doc.pdf')
          .expect(400);
        await request(server)
          .post(`/api/admin/products/${productId}/media`)
          .set('Authorization', `Bearer ${contentToken}`)
          .field('type', 'VIDEO')
          .attach('file', pdfBuffer(), 'doc.pdf')
          .expect(400);
      });

      it('6. rejects an oversized image (400)', async () => {
        const oversized = Buffer.concat([jpegBuffer(), Buffer.alloc(6 * 1024 * 1024, 0)]);
        await request(server)
          .post(`/api/admin/products/${productId}/media`)
          .set('Authorization', `Bearer ${contentToken}`)
          .field('type', 'IMAGE')
          .attach('file', oversized, 'big.jpg')
          .expect(400);
      });

      it('7. uploading to a non-existent product returns 404', async () => {
        await request(server)
          .post('/api/admin/products/does-not-exist/media')
          .set('Authorization', `Bearer ${contentToken}`)
          .field('type', 'IMAGE')
          .attach('file', jpegBuffer(), 'photo.jpg')
          .expect(404);
      });

      it('8. 403 for SALES/WAREHOUSE, 401 with no token', async () => {
        await request(server)
          .post(`/api/admin/products/${productId}/media`)
          .set('Authorization', `Bearer ${salesToken}`)
          .field('type', 'IMAGE')
          .attach('file', jpegBuffer(), 'photo.jpg')
          .expect(403);
        await request(server)
          .post(`/api/admin/products/${productId}/media`)
          .set('Authorization', `Bearer ${warehouseToken}`)
          .field('type', 'IMAGE')
          .attach('file', jpegBuffer(), 'photo.jpg')
          .expect(403);
        await request(server)
          .post(`/api/admin/products/${productId}/media`)
          .field('type', 'IMAGE')
          .attach('file', jpegBuffer(), 'photo.jpg')
          .expect(401);
      });
    });

    describe('PATCH /api/admin/products/:id/media/order', () => {
      let orderProductId: string;
      let mediaIds: string[];

      beforeAll(async () => {
        const seed = slugSeed('media-reorder');
        const cat = await request(server)
          .post('/api/admin/categories')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ translations: bothLocaleTranslations(seed) })
          .expect(201);
        const product = await request(server)
          .post('/api/admin/products')
          .set('Authorization', `Bearer ${contentToken}`)
          .send({
            categoryId: cat.body.id,
            ageRangeMin: 3,
            ageRangeMax: 6,
            gender: 'UNISEX',
            origin: 'VN',
            channelScope: 'BOTH',
            translations: [
              { locale: 'vi', name: `Ten ${seed}`, slug: `ro-vi-${seed}` },
              { locale: 'en', name: `Name ${seed}`, slug: `ro-en-${seed}` },
            ],
          })
          .expect(201);
        orderProductId = product.body.id as string;

        mediaIds = [];
        for (let i = 0; i < 3; i += 1) {
          const res = await request(server)
            .post(`/api/admin/products/${orderProductId}/media`)
            .set('Authorization', `Bearer ${contentToken}`)
            .field('type', 'IMAGE')
            .attach('file', jpegBuffer(), `photo-${i}.jpg`)
            .expect(201);
          mediaIds.push(res.body.id as string);
        }
      });

      it('9. reorders with the full reversed id set', async () => {
        const reversed = [...mediaIds].reverse();
        const res = await request(server)
          .patch(`/api/admin/products/${orderProductId}/media/order`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ orderedIds: reversed })
          .expect(200);
        expect((res.body as Array<{ id: string; sortOrder: number }>).map((m) => m.id)).toEqual(
          reversed,
        );
      });

      it('10. rejects a partial id set (400)', async () => {
        await request(server)
          .patch(`/api/admin/products/${orderProductId}/media/order`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ orderedIds: [mediaIds[0]] })
          .expect(400);
      });

      it('11. rejects a duplicate id (400)', async () => {
        await request(server)
          .patch(`/api/admin/products/${orderProductId}/media/order`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ orderedIds: [mediaIds[0], mediaIds[0], mediaIds[1]] })
          .expect(400);
      });

      it('12. rejects an id belonging to another product (400)', async () => {
        await request(server)
          .patch(`/api/admin/products/${orderProductId}/media/order`)
          .set('Authorization', `Bearer ${contentToken}`)
          .send({ orderedIds: [mediaIds[0]!, mediaIds[1]!, 'foreign-id'] })
          .expect(400);
      });
    });

    describe('DELETE /api/admin/media/:mediaId', () => {
      it('13. deletes the row (204) and the row no longer exists', async () => {
        const res = await request(server)
          .post(`/api/admin/products/${productId}/media`)
          .set('Authorization', `Bearer ${contentToken}`)
          .field('type', 'IMAGE')
          .attach('file', jpegBuffer(), 'to-delete.jpg')
          .expect(201);

        await request(server)
          .delete(`/api/admin/media/${res.body.id}`)
          .set('Authorization', `Bearer ${contentToken}`)
          .expect(204);

        const row = await prisma.productMedia.findUnique({ where: { id: res.body.id as string } });
        expect(row).toBeNull();
      });

      it('14. 403 for WAREHOUSE, 401 with no token', async () => {
        const res = await request(server)
          .post(`/api/admin/products/${productId}/media`)
          .set('Authorization', `Bearer ${contentToken}`)
          .field('type', 'IMAGE')
          .attach('file', jpegBuffer(), 'rbac.jpg')
          .expect(201);

        await request(server)
          .delete(`/api/admin/media/${res.body.id}`)
          .set('Authorization', `Bearer ${warehouseToken}`)
          .expect(403);
        await request(server).delete(`/api/admin/media/${res.body.id}`).expect(401);
      });
    });
  });
});

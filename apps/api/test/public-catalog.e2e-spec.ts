import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, resetAndSeed } from './utils/test-app';
import type { PrismaService } from '../src/prisma/prisma.service';

const SEED_PASSWORD = process.env.SEED_DEFAULT_PASSWORD as string;

/**
 * Executable form of Phase 1 Success Criterion 5 (CATALOG-06/07/08/09):
 * one public catalog read path serves anonymous shoppers, retail
 * customers and approved dealers alike, returning locale-correct content,
 * viewer-resolved pricing, a stock-status indicator and correctly
 * composed facet filters — see 01-07-PLAN.md Task 1.
 */
describe('Public Catalog (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: App;

  let retailToken: string;
  let dealerToken: string; // APPROVED, DEALER_A
  let pendingDealerToken: string;

  const CATEGORY_EDUCATIONAL_ID = 'cat-educational-toys';
  const CATEGORY_VEHICLES_ID = 'cat-model-vehicles';
  const CATEGORY_BABY_ID = 'cat-baby-toys';
  const EDU_PRODUCT_ID = 'product-kt-edu';
  const VEH_PRODUCT_ID = 'product-kt-veh';
  const BABY_PRODUCT_ID = 'product-kt-baby';
  const EDU_VI_SLUG = 'bo-lego-sang-tao-giao-duc';
  const EDU_EN_SLUG = 'lego-educational-creative-set';
  const VEH_VI_SLUG = 'xe-mo-hinh-fisher-price';
  const VEH_EN_SLUG = 'fisher-price-model-vehicle';
  const BABY_VI_SLUG = 'do-choi-so-sinh-antona';

  let legoBrandId: string;

  let retailOnlyProduct: { id: string; viSlug: string };
  let inactiveProduct: { id: string; viSlug: string };
  let nullEnDescProduct: { id: string; viSlug: string; enSlug: string };

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    server = app.getHttpServer() as App;
    await resetAndSeed(prisma);

    retailToken = await loginAs('customer@kidtoy.local');
    dealerToken = await loginAs('dealer@kidtoy.local');
    pendingDealerToken = await loginAs('pending-dealer@kidtoy.local');

    const lego = await prisma.brand.findFirstOrThrow({
      where: { name: 'LEGO' },
    });
    legoBrandId = lego.id;
    const retailTier = await prisma.priceTier.findFirstOrThrow({
      where: { code: 'RETAIL' },
    });

    // The seed data has no RETAIL_ONLY product and no product with a null
    // EN description — add the minimal fixtures needed to prove the
    // remaining acceptance criteria (T-01-51's other direction, and the
    // explicit description-fallback rule).
    retailOnlyProduct = await createFixtureProduct({
      suffix: 'retail-only',
      channelScope: 'RETAIL_ONLY',
      retailTierId: retailTier.id,
    });
    inactiveProduct = await createFixtureProduct({
      suffix: 'inactive',
      channelScope: 'BOTH',
      isActive: false,
      retailTierId: retailTier.id,
    });
    nullEnDescProduct = await createFixtureProduct({
      suffix: 'null-en-desc',
      channelScope: 'BOTH',
      retailTierId: retailTier.id,
      omitEnDescription: true,
    });
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

  /** URL-safe seed for slugs/names — uniqueEmail()'s `+uuid` shape fails the slug pattern. */
  function slugSeed(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 8)}`;
  }

  async function createFixtureProduct(opts: {
    suffix: string;
    channelScope: 'RETAIL_ONLY' | 'WHOLESALE_ONLY' | 'BOTH';
    retailTierId: string;
    isActive?: boolean;
    omitEnDescription?: boolean;
  }): Promise<{ id: string; viSlug: string; enSlug: string }> {
    const seed = slugSeed(opts.suffix);
    const viSlug = `fixture-vi-${seed}`;
    const enSlug = `fixture-en-${seed}`;
    const product = await prisma.product.create({
      data: {
        categoryId: CATEGORY_EDUCATIONAL_ID,
        ageRangeMin: 1,
        ageRangeMax: 5,
        gender: 'UNISEX',
        origin: 'VN',
        channelScope: opts.channelScope,
        isActive: opts.isActive ?? true,
      },
    });
    await prisma.productTranslation.create({
      data: {
        productId: product.id,
        locale: 'VI',
        name: `Fixture VI ${seed}`,
        slug: viSlug,
        description: 'Mo ta VI',
      },
    });
    await prisma.productTranslation.create({
      data: {
        productId: product.id,
        locale: 'EN',
        name: `Fixture EN ${seed}`,
        slug: enSlug,
        ...(opts.omitEnDescription ? {} : { description: 'EN description' }),
      },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id, sku: `FIX-${seed}`, isActive: true },
    });
    await prisma.priceListEntry.create({
      data: {
        variantId: variant.id,
        tierId: opts.retailTierId,
        minQty: 1,
        unitPriceVnd: 111000n,
      },
    });
    await prisma.variantStock.create({
      data: { variantId: variant.id, quantityOnHand: 10, reorderThreshold: 2 },
    });
    return { id: product.id, viSlug, enSlug };
  }

  interface ListItem {
    id: string;
    name: string;
    slug: string;
    origin: string;
    stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
    price: { unitPriceVnd: string; tierCode: string; minQty: number } | null;
  }
  interface ListResponse {
    items: ListItem[];
    total: number;
    page: number;
    pageSize: number;
  }

  // =====================================================================
  // CATALOG-06 — viewer-aware price, same endpoint
  // =====================================================================
  describe('CATALOG-06: viewer-aware pricing from a single endpoint', () => {
    it('1. anonymous GET /api/catalog/products?locale=vi returns 200 (not 401) and every price.tierCode is RETAIL', async () => {
      const res = await request(server)
        .get('/api/catalog/products?locale=vi')
        .expect(200);
      const body = res.body as ListResponse;
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        if (item.price) {
          expect(item.price.tierCode).toBe('RETAIL');
        }
      }
    });

    it('2. the retail customer sees tierCode RETAIL with prices identical to the anonymous response', async () => {
      const anon = await request(server)
        .get('/api/catalog/products?locale=vi')
        .expect(200);
      const retail = await request(server)
        .get('/api/catalog/products?locale=vi')
        .set('Authorization', `Bearer ${retailToken}`)
        .expect(200);
      const anonEdu = (anon.body as ListResponse).items.find(
        (i) => i.id === EDU_PRODUCT_ID,
      );
      const retailEdu = (retail.body as ListResponse).items.find(
        (i) => i.id === EDU_PRODUCT_ID,
      );
      expect(retailEdu?.price?.tierCode).toBe('RETAIL');
      expect(retailEdu?.price?.unitPriceVnd).toBe(anonEdu?.price?.unitPriceVnd);
    });

    it('3. the APPROVED dealer sees tierCode DEALER_A for the LEGO product, strictly less than the anonymous price for the same variant', async () => {
      const anon = await request(server)
        .get('/api/catalog/products?locale=vi')
        .expect(200);
      const dealer = await request(server)
        .get('/api/catalog/products?locale=vi')
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
      const anonEdu = (anon.body as ListResponse).items.find(
        (i) => i.id === EDU_PRODUCT_ID,
      );
      const dealerEdu = (dealer.body as ListResponse).items.find(
        (i) => i.id === EDU_PRODUCT_ID,
      );
      expect(dealerEdu?.price?.tierCode).toBe('DEALER_A');
      expect(Number(dealerEdu?.price?.unitPriceVnd)).toBeLessThan(
        Number(anonEdu?.price?.unitPriceVnd),
      );
    });

    it('4. the PENDING dealer sees tierCode RETAIL — identical to anonymous', async () => {
      const anon = await request(server)
        .get('/api/catalog/products?locale=vi')
        .expect(200);
      const pending = await request(server)
        .get('/api/catalog/products?locale=vi')
        .set('Authorization', `Bearer ${pendingDealerToken}`)
        .expect(200);
      const anonEdu = (anon.body as ListResponse).items.find(
        (i) => i.id === EDU_PRODUCT_ID,
      );
      const pendingEdu = (pending.body as ListResponse).items.find(
        (i) => i.id === EDU_PRODUCT_ID,
      );
      expect(pendingEdu?.price?.tierCode).toBe('RETAIL');
      expect(pendingEdu?.price?.unitPriceVnd).toBe(
        anonEdu?.price?.unitPriceVnd,
      );
    });

    it('5. unitPriceVnd is a JSON string in every response, never a number', async () => {
      const res = await request(server)
        .get('/api/catalog/products?locale=vi')
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
      const body = res.body as ListResponse;
      for (const item of body.items) {
        if (item.price) {
          expect(typeof item.price.unitPriceVnd).toBe('string');
        }
      }
    });

    it('6. no response contains DEALER_B for a DEALER_A viewer, and no response exposes a price list', async () => {
      const list = await request(server)
        .get('/api/catalog/products?locale=vi')
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
      const detail = await request(server)
        .get(`/api/catalog/products/${EDU_VI_SLUG}?locale=vi`)
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
      const listText = JSON.stringify(list.body);
      const detailText = JSON.stringify(detail.body);
      expect(listText).not.toContain('DEALER_B');
      expect(detailText).not.toContain('DEALER_B');
      expect(listText).not.toContain('priceListEntries');
      expect(detailText).not.toContain('priceListEntries');
    });
  });

  // =====================================================================
  // CATALOG-07 — filters
  // =====================================================================
  describe('CATALOG-07: facet filters', () => {
    it('7. ?categoryId=<Educational Toys> returns only products in that category', async () => {
      const res = await request(server)
        .get(`/api/catalog/products?categoryId=${CATEGORY_EDUCATIONAL_ID}`)
        .expect(200);
      const body = res.body as ListResponse;
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(
          item.id === EDU_PRODUCT_ID ||
            item.id === retailOnlyProduct.id ||
            item.id === nullEnDescProduct.id,
        ).toBe(true);
      }
    });

    it('8. ?brandId=<LEGO> returns only LEGO products', async () => {
      const res = await request(server)
        .get(`/api/catalog/products?brandId=${legoBrandId}`)
        .expect(200);
      const body = res.body as ListResponse;
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(item.id).toBe(EDU_PRODUCT_ID);
      }
    });

    it('9. ?origin=VN returns only Vietnam-origin products (dealer viewer, to see the VN WHOLESALE_ONLY product)', async () => {
      const res = await request(server)
        .get('/api/catalog/products?origin=VN')
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
      const body = res.body as ListResponse;
      expect(body.items.length).toBeGreaterThan(0);
      for (const item of body.items) {
        expect(item.origin).toBe('VN');
      }
    });

    it('10. ?ageMin=0&ageMax=3 returns the baby product and excludes the 6-12 product; ?ageMin=6&ageMax=12 does the inverse (dealer viewer)', async () => {
      const young = await request(server)
        .get('/api/catalog/products?ageMin=0&ageMax=3')
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
      const youngBody = young.body as ListResponse;
      expect(youngBody.items.some((i) => i.id === BABY_PRODUCT_ID)).toBe(true);
      expect(youngBody.items.some((i) => i.id === EDU_PRODUCT_ID)).toBe(false);

      const older = await request(server)
        .get('/api/catalog/products?ageMin=6&ageMax=12')
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
      const olderBody = older.body as ListResponse;
      expect(olderBody.items.some((i) => i.id === EDU_PRODUCT_ID)).toBe(true);
      expect(olderBody.items.some((i) => i.id === BABY_PRODUCT_ID)).toBe(false);
    });

    it('11. combined filters return the intersection, and an impossible combination returns { items: [], total: 0 } with 200', async () => {
      const combined = await request(server)
        .get(
          `/api/catalog/products?categoryId=${CATEGORY_EDUCATIONAL_ID}&brandId=${legoBrandId}&origin=DK&ageMin=6&ageMax=12`,
        )
        .expect(200);
      const combinedBody = combined.body as ListResponse;
      expect(combinedBody.items).toHaveLength(1);
      expect(combinedBody.items[0]?.id).toBe(EDU_PRODUCT_ID);

      const impossible = await request(server)
        .get(
          `/api/catalog/products?categoryId=${CATEGORY_EDUCATIONAL_ID}&origin=US`,
        )
        .expect(200);
      expect(impossible.body).toEqual({
        items: [],
        total: 0,
        page: 1,
        pageSize: 24,
      });
    });

    it('12. ?search=do choi matches the current locale translated name diacritic-insensitively (dealer viewer)', async () => {
      const res = await request(server)
        .get(
          `/api/catalog/products?search=${encodeURIComponent('do choi')}&locale=vi`,
        )
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
      const body = res.body as ListResponse;
      expect(body.items.some((i) => i.id === BABY_PRODUCT_ID)).toBe(true);
    });

    it('13. ?page=2&pageSize=1 returns a different item than page 1 and the same total', async () => {
      const page1 = await request(server)
        .get(
          `/api/catalog/products?categoryId=${CATEGORY_EDUCATIONAL_ID}&pageSize=1&page=1`,
        )
        .expect(200);
      const page2 = await request(server)
        .get(
          `/api/catalog/products?categoryId=${CATEGORY_EDUCATIONAL_ID}&pageSize=1&page=2`,
        )
        .expect(200);
      const p1Body = page1.body as ListResponse;
      const p2Body = page2.body as ListResponse;
      expect(p1Body.total).toBeGreaterThanOrEqual(2);
      expect(p1Body.total).toBe(p2Body.total);
      expect(p1Body.items[0]?.id).not.toBe(p2Body.items[0]?.id);
    });

    it('14. an invalid filter (ageMin=-1, pageSize=999, gender=ROBOT) returns 400', async () => {
      await request(server).get('/api/catalog/products?ageMin=-1').expect(400);
      await request(server)
        .get('/api/catalog/products?pageSize=999')
        .expect(400);
      await request(server)
        .get('/api/catalog/products?gender=ROBOT')
        .expect(400);
    });
  });

  // =====================================================================
  // CATALOG-08 — stock status
  // =====================================================================
  describe('CATALOG-08: stock status', () => {
    it('15. variant-level stock derives IN_STOCK / LOW_STOCK / OUT_OF_STOCK from seeded quantities', async () => {
      const eduDetail = await request(server)
        .get(`/api/catalog/products/${EDU_VI_SLUG}?locale=vi`)
        .expect(200);
      const eduVariants = (
        eduDetail.body as { variants: { sku: string; stockStatus: string }[] }
      ).variants;
      expect(eduVariants.find((v) => v.sku === 'KT-EDU-001')?.stockStatus).toBe(
        'IN_STOCK',
      );
      expect(eduVariants.find((v) => v.sku === 'KT-EDU-002')?.stockStatus).toBe(
        'LOW_STOCK',
      );

      const vehDetail = await request(server)
        .get(`/api/catalog/products/${VEH_VI_SLUG}?locale=vi`)
        .expect(200);
      const vehVariants = (
        vehDetail.body as { variants: { sku: string; stockStatus: string }[] }
      ).variants;
      expect(vehVariants.find((v) => v.sku === 'KT-VEH-001')?.stockStatus).toBe(
        'OUT_OF_STOCK',
      );
    });

    it("16. a list item's top-level stockStatus is the best status across its variants", async () => {
      const res = await request(server)
        .get('/api/catalog/products?locale=vi')
        .expect(200);
      const body = res.body as ListResponse;
      const eduItem = body.items.find((i) => i.id === EDU_PRODUCT_ID);
      // KT-EDU-001 is IN_STOCK, KT-EDU-002 is LOW_STOCK — best-of must be IN_STOCK.
      expect(eduItem?.stockStatus).toBe('IN_STOCK');
    });
  });

  // =====================================================================
  // CATALOG-09 — bilingual
  // =====================================================================
  describe('CATALOG-09: bilingual content, per-locale slugs, explicit fallback', () => {
    it('17. ?locale=vi and ?locale=en for the same product return different name/slug but the same id', async () => {
      const vi = await request(server)
        .get(
          `/api/catalog/products?categoryId=${CATEGORY_VEHICLES_ID}&locale=vi`,
        )
        .expect(200);
      const en = await request(server)
        .get(
          `/api/catalog/products?categoryId=${CATEGORY_VEHICLES_ID}&locale=en`,
        )
        .expect(200);
      const viItem = (vi.body as ListResponse).items.find(
        (i) => i.id === VEH_PRODUCT_ID,
      );
      const enItem = (en.body as ListResponse).items.find(
        (i) => i.id === VEH_PRODUCT_ID,
      );
      expect(viItem?.id).toBe(enItem?.id);
      expect(viItem?.name).not.toBe(enItem?.name);
      expect(viItem?.slug).not.toBe(enItem?.slug);
      expect(enItem?.slug).toBe(VEH_EN_SLUG);
    });

    it('18. a product is fetched by its per-locale slug, and the wrong-locale slug does not resolve', async () => {
      await request(server)
        .get(`/api/catalog/products/${EDU_VI_SLUG}?locale=vi`)
        .expect(200);
      await request(server)
        .get(`/api/catalog/products/${EDU_EN_SLUG}?locale=en`)
        .expect(200);
      await request(server)
        .get(`/api/catalog/products/${EDU_VI_SLUG}?locale=en`)
        .expect(404);
    });

    it('19. locale precedence: omit -> vi; Accept-Language: en with no query -> en; explicit query wins over header', async () => {
      const omitted = await request(server)
        .get(`/api/catalog/products?categoryId=${CATEGORY_VEHICLES_ID}`)
        .expect(200);
      expect((omitted.body as ListResponse).items[0]?.name).toBe(
        'Xe Mô Hình Fisher-Price',
      );

      const headerOnly = await request(server)
        .get(`/api/catalog/products?categoryId=${CATEGORY_VEHICLES_ID}`)
        .set('Accept-Language', 'en')
        .expect(200);
      expect((headerOnly.body as ListResponse).items[0]?.name).toBe(
        'Fisher-Price Model Vehicle',
      );

      const queryWinsOverHeader = await request(server)
        .get(
          `/api/catalog/products?categoryId=${CATEGORY_VEHICLES_ID}&locale=vi`,
        )
        .set('Accept-Language', 'en')
        .expect(200);
      expect((queryWinsOverHeader.body as ListResponse).items[0]?.name).toBe(
        'Xe Mô Hình Fisher-Price',
      );
    });

    it('20. an unsupported ?locale=fr returns 400', async () => {
      await request(server).get('/api/catalog/products?locale=fr').expect(400);
    });

    it('21. a product whose EN description is null falls back to null (not the VI description) but still returns the EN name/slug', async () => {
      const res = await request(server)
        .get(`/api/catalog/products/${nullEnDescProduct.enSlug}?locale=en`)
        .expect(200);
      const body = res.body as {
        name: string;
        slug: string;
        description: string | null;
      };
      expect(body.slug).toBe(nullEnDescProduct.enSlug);
      expect(body.description).toBeNull();
    });
  });

  // =====================================================================
  // Channel scope
  // =====================================================================
  describe('Channel scope visibility', () => {
    it('22. the seeded WHOLESALE_ONLY product is absent from anonymous/retail listings and present for the APPROVED dealer', async () => {
      const anon = await request(server)
        .get(`/api/catalog/products?categoryId=${CATEGORY_BABY_ID}`)
        .expect(200);
      expect((anon.body as ListResponse).items).toHaveLength(0);

      const retail = await request(server)
        .get(`/api/catalog/products?categoryId=${CATEGORY_BABY_ID}`)
        .set('Authorization', `Bearer ${retailToken}`)
        .expect(200);
      expect((retail.body as ListResponse).items).toHaveLength(0);

      const dealer = await request(server)
        .get(`/api/catalog/products?categoryId=${CATEGORY_BABY_ID}`)
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
      expect(
        (dealer.body as ListResponse).items.some(
          (i) => i.id === BABY_PRODUCT_ID,
        ),
      ).toBe(true);
    });

    it('23. the WHOLESALE_ONLY product detail is 404 anonymously and 200 for the APPROVED dealer', async () => {
      await request(server)
        .get(`/api/catalog/products/${BABY_VI_SLUG}?locale=vi`)
        .expect(404);
      await request(server)
        .get(`/api/catalog/products/${BABY_VI_SLUG}?locale=vi`)
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
    });

    it('a RETAIL_ONLY product is visible anonymously but 404 for the APPROVED dealer (T-01-51, the other direction)', async () => {
      await request(server)
        .get(`/api/catalog/products/${retailOnlyProduct.viSlug}?locale=vi`)
        .expect(200);
      await request(server)
        .get(`/api/catalog/products/${retailOnlyProduct.viSlug}?locale=vi`)
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(404);
    });

    it('24. a soft-deleted (isActive=false) product is absent from every listing and 404 on detail for every viewer', async () => {
      const anon = await request(server)
        .get(`/api/catalog/products?categoryId=${CATEGORY_EDUCATIONAL_ID}`)
        .expect(200);
      expect(
        (anon.body as ListResponse).items.some(
          (i) => i.id === inactiveProduct.id,
        ),
      ).toBe(false);
      const dealer = await request(server)
        .get(`/api/catalog/products?categoryId=${CATEGORY_EDUCATIONAL_ID}`)
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
      expect(
        (dealer.body as ListResponse).items.some(
          (i) => i.id === inactiveProduct.id,
        ),
      ).toBe(false);

      await request(server)
        .get(`/api/catalog/products/${inactiveProduct.viSlug}?locale=vi`)
        .expect(404);
      await request(server)
        .get(`/api/catalog/products/${inactiveProduct.viSlug}?locale=vi`)
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(404);
    });
  });

  // =====================================================================
  // Media
  // =====================================================================
  describe('Media safety', () => {
    it('25. every primaryImageUrl is either null or a presigned URL containing X-Amz-Signature; no response contains objectKey', async () => {
      const res = await request(server)
        .get('/api/catalog/products?locale=vi')
        .set('Authorization', `Bearer ${dealerToken}`)
        .expect(200);
      const body = res.body as ListResponse;
      for (const item of body.items) {
        const url = (item as unknown as { primaryImageUrl: string | null })
          .primaryImageUrl;
        if (url !== null) {
          expect(url).toContain('X-Amz-Signature');
        }
      }
      expect(JSON.stringify(res.body)).not.toContain('objectKey');
    });
  });
});

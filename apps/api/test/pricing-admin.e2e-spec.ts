import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, resetAndSeed } from './utils/test-app';
import type { PrismaService } from '../src/prisma/prisma.service';
import { PriceResolutionService } from '../src/modules/pricing/price-resolution.service';

const SEED_PASSWORD = process.env.SEED_DEFAULT_PASSWORD as string;

describe('Pricing & Variant Stock Admin (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: App;
  let priceResolution: PriceResolutionService;

  let adminToken: string;
  let salesToken: string;
  let warehouseToken: string;
  let contentToken: string;

  let retailTierId: string;
  let dealerATierId: string;
  let dealerBTierId: string;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    server = app.getHttpServer() as App;
    priceResolution = app.get(PriceResolutionService);

    await resetAndSeed(prisma);

    adminToken = await loginAs('admin@kidtoy.local');
    salesToken = await loginAs('sales@kidtoy.local');
    warehouseToken = await loginAs('warehouse@kidtoy.local');
    contentToken = await loginAs('content@kidtoy.local');

    const [retail, dealerA, dealerB] = await Promise.all([
      prisma.priceTier.findFirstOrThrow({ where: { code: 'RETAIL' } }),
      prisma.priceTier.findFirstOrThrow({ where: { code: 'DEALER_A' } }),
      prisma.priceTier.findFirstOrThrow({ where: { code: 'DEALER_B' } }),
    ]);
    retailTierId = retail.id;
    dealerATierId = dealerA.id;
    dealerBTierId = dealerB.id;
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

  /** A tier code matching UpsertPriceTierDto's ^[A-Z][A-Z0-9_]{2,31}$ pattern. */
  function tierCode(prefix: string): string {
    return `${prefix}${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  /** A fresh, isolated variant (no price/stock rows) attached to any seeded product. */
  async function createTestVariant(skuPrefix: string): Promise<string> {
    const product = await prisma.product.findFirstOrThrow();
    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `${skuPrefix}-${randomUUID().slice(0, 8)}`,
        isActive: true,
      },
    });
    return variant.id;
  }

  // -----------------------------------------------------------------
  // POST /api/admin/price-tiers
  // -----------------------------------------------------------------
  describe('POST /api/admin/price-tiers', () => {
    it('1. SUPER_ADMIN creates a tier (201) with is_default=false persisted, even though isDefault is never accepted', async () => {
      const code = tierCode('T');
      const res = await request(server)
        .post('/api/admin/price-tiers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code, name: 'Test Tier' })
        .expect(201);

      expect(res.body.code).toBe(code);
      expect(res.body.isDefault).toBe(false);

      const row = await prisma.priceTier.findUniqueOrThrow({ where: { id: res.body.id as string } });
      expect(row.isDefault).toBe(false);
    });

    it('2. a request that attempts to set isDefault is rejected (400) — the field is never accepted from a client', async () => {
      await request(server)
        .post('/api/admin/price-tiers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: tierCode('T'), name: 'Test Tier', isDefault: true })
        .expect(400);
    });

    it('3. a duplicate code returns 409 TIER_CODE_TAKEN', async () => {
      const code = tierCode('T');
      await request(server)
        .post('/api/admin/price-tiers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code, name: 'Dup Tier' })
        .expect(201);

      const res = await request(server)
        .post('/api/admin/price-tiers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code, name: 'Dup Tier Again' })
        .expect(409);
      expect(res.body.message).toBe('TIER_CODE_TAKEN');
    });

    it('4. a SALES token returns 403', async () => {
      await request(server)
        .post('/api/admin/price-tiers')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ code: tierCode('T'), name: 'Nope' })
        .expect(403);
    });

    it('5. unauthenticated returns 401', async () => {
      await request(server)
        .post('/api/admin/price-tiers')
        .send({ code: tierCode('T'), name: 'Nope' })
        .expect(401);
    });
  });

  // -----------------------------------------------------------------
  // GET /api/admin/price-tiers
  // -----------------------------------------------------------------
  describe('GET /api/admin/price-tiers', () => {
    it('6. SUPER_ADMIN and SALES can list tiers (200); the seeded RETAIL tier is present and is_default', async () => {
      const res = await request(server)
        .get('/api/admin/price-tiers')
        .set('Authorization', `Bearer ${salesToken}`)
        .expect(200);
      const retail = (res.body as { code: string; isDefault: boolean }[]).find((t) => t.code === 'RETAIL');
      expect(retail?.isDefault).toBe(true);
    });
  });

  // -----------------------------------------------------------------
  // PUT /api/admin/variants/:variantId/prices
  // -----------------------------------------------------------------
  describe('PUT /api/admin/variants/:variantId/prices', () => {
    it('7. SALES upserts a new price entry (200), unitPriceVnd persisted as BigInt', async () => {
      const variantId = await createTestVariant('PRC');
      const res = await request(server)
        .put(`/api/admin/variants/${variantId}/prices`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ tierId: dealerATierId, minQty: 1, unitPriceVnd: '250000' })
        .expect(200);

      expect(res.body.unitPriceVnd).toBe('250000');
      expect(typeof res.body.unitPriceVnd).toBe('string');

      const row = await prisma.priceListEntry.findUniqueOrThrow({
        where: { variantId_tierId_minQty: { variantId, tierId: dealerATierId, minQty: 1 } },
      });
      expect(row.unitPriceVnd).toBe(250000n);
    });

    it('8. calling it twice with the same {tierId, minQty} updates rather than duplicates — exactly one row', async () => {
      const variantId = await createTestVariant('PRC');
      await request(server)
        .put(`/api/admin/variants/${variantId}/prices`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ tierId: dealerATierId, minQty: 1, unitPriceVnd: '250000' })
        .expect(200);
      await request(server)
        .put(`/api/admin/variants/${variantId}/prices`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ tierId: dealerATierId, minQty: 1, unitPriceVnd: '260000' })
        .expect(200);

      const count = await prisma.priceListEntry.count({
        where: { variantId, tierId: dealerATierId, minQty: 1 },
      });
      expect(count).toBe(1);

      const row = await prisma.priceListEntry.findUniqueOrThrow({
        where: { variantId_tierId_minQty: { variantId, tierId: dealerATierId, minQty: 1 } },
      });
      expect(row.unitPriceVnd).toBe(260000n);
    });

    it('9. a decimal (non-integer) unitPriceVnd returns 400', async () => {
      const variantId = await createTestVariant('PRC');
      await request(server)
        .put(`/api/admin/variants/${variantId}/prices`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ tierId: dealerATierId, minQty: 1, unitPriceVnd: '250000.50' })
        .expect(400);
    });

    it('10. a negative unitPriceVnd returns 400', async () => {
      const variantId = await createTestVariant('PRC');
      await request(server)
        .put(`/api/admin/variants/${variantId}/prices`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ tierId: dealerATierId, minQty: 1, unitPriceVnd: '-250000' })
        .expect(400);
    });

    it('11. a non-numeric unitPriceVnd returns 400', async () => {
      const variantId = await createTestVariant('PRC');
      await request(server)
        .put(`/api/admin/variants/${variantId}/prices`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ tierId: dealerATierId, minQty: 1, unitPriceVnd: 'abc' })
        .expect(400);
    });

    it('12. minQty < 1 returns 400', async () => {
      const variantId = await createTestVariant('PRC');
      await request(server)
        .put(`/api/admin/variants/${variantId}/prices`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ tierId: dealerATierId, minQty: 0, unitPriceVnd: '250000' })
        .expect(400);
    });

    it('13. an unknown tierId returns 400', async () => {
      const variantId = await createTestVariant('PRC');
      await request(server)
        .put(`/api/admin/variants/${variantId}/prices`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ tierId: 'nonexistent-tier-id', minQty: 1, unitPriceVnd: '250000' })
        .expect(400);
    });

    it('14. an unknown variantId returns 404', async () => {
      await request(server)
        .put('/api/admin/variants/nonexistent-variant-id/prices')
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ tierId: dealerATierId, minQty: 1, unitPriceVnd: '250000' })
        .expect(404);
    });

    it('15. a CONTENT token returns 403', async () => {
      const variantId = await createTestVariant('PRC');
      await request(server)
        .put(`/api/admin/variants/${variantId}/prices`)
        .set('Authorization', `Bearer ${contentToken}`)
        .send({ tierId: dealerATierId, minQty: 1, unitPriceVnd: '250000' })
        .expect(403);
    });

    it('16. unauthenticated returns 401', async () => {
      const variantId = await createTestVariant('PRC');
      await request(server)
        .put(`/api/admin/variants/${variantId}/prices`)
        .send({ tierId: dealerATierId, minQty: 1, unitPriceVnd: '250000' })
        .expect(401);
    });
  });

  // -----------------------------------------------------------------
  // GET /api/admin/variants/:variantId/prices
  // -----------------------------------------------------------------
  describe('GET /api/admin/variants/:variantId/prices', () => {
    it('17. returns every tier entry with unitPriceVnd as a decimal STRING, ordered by tier code then minQty', async () => {
      const variantId = await createTestVariant('LIST');
      await prisma.priceListEntry.createMany({
        data: [
          { variantId, tierId: retailTierId, minQty: 1, unitPriceVnd: 100000n },
          { variantId, tierId: dealerATierId, minQty: 12, unitPriceVnd: 70000n },
          { variantId, tierId: dealerATierId, minQty: 1, unitPriceVnd: 80000n },
        ],
      });

      const res = await request(server)
        .get(`/api/admin/variants/${variantId}/prices`)
        .set('Authorization', `Bearer ${salesToken}`)
        .expect(200);

      const body = res.body as { tierCode: string; minQty: number; unitPriceVnd: string }[];
      expect(body).toHaveLength(3);
      for (const entry of body) {
        expect(typeof entry.unitPriceVnd).toBe('string');
      }
      // Ordered by tier code ('DEALER_A' < 'RETAIL') then minQty ascending.
      expect(body.map((e) => `${e.tierCode}:${e.minQty}`)).toEqual(['DEALER_A:1', 'DEALER_A:12', 'RETAIL:1']);
    });
  });

  // -----------------------------------------------------------------
  // DELETE /api/admin/price-entries/:entryId
  // -----------------------------------------------------------------
  describe('DELETE /api/admin/price-entries/:entryId', () => {
    it('18. deletes a non-last entry and returns 204', async () => {
      const variantId = await createTestVariant('DEL');
      await prisma.priceListEntry.create({
        data: { variantId, tierId: retailTierId, minQty: 1, unitPriceVnd: 100000n },
      });
      const extra = await prisma.priceListEntry.create({
        data: { variantId, tierId: dealerATierId, minQty: 1, unitPriceVnd: 80000n },
      });

      await request(server)
        .delete(`/api/admin/price-entries/${extra.id}`)
        .set('Authorization', `Bearer ${salesToken}`)
        .expect(204);

      const remaining = await prisma.priceListEntry.findUnique({ where: { id: extra.id } });
      expect(remaining).toBeNull();
    });

    it('19. deleting the LAST remaining default-tier (RETAIL) entry for a variant returns 409 LAST_RETAIL_PRICE', async () => {
      const variantId = await createTestVariant('LASTRETAIL');
      const onlyRetail = await prisma.priceListEntry.create({
        data: { variantId, tierId: retailTierId, minQty: 1, unitPriceVnd: 100000n },
      });

      const res = await request(server)
        .delete(`/api/admin/price-entries/${onlyRetail.id}`)
        .set('Authorization', `Bearer ${salesToken}`)
        .expect(409);
      expect(res.body.message).toBe('LAST_RETAIL_PRICE');

      const stillThere = await prisma.priceListEntry.findUnique({ where: { id: onlyRetail.id } });
      expect(stillThere).not.toBeNull();
    });

    it('20. deleting a dealer-tier entry never triggers LAST_RETAIL_PRICE, even if it is the variant\'s only entry', async () => {
      const variantId = await createTestVariant('ONLYDEALER');
      const onlyDealer = await prisma.priceListEntry.create({
        data: { variantId, tierId: dealerATierId, minQty: 1, unitPriceVnd: 80000n },
      });

      await request(server)
        .delete(`/api/admin/price-entries/${onlyDealer.id}`)
        .set('Authorization', `Bearer ${salesToken}`)
        .expect(204);
    });
  });

  // -----------------------------------------------------------------
  // PUT /api/admin/variants/:variantId/stock
  // -----------------------------------------------------------------
  describe('PUT /api/admin/variants/:variantId/stock', () => {
    it('21. WAREHOUSE upserts stock (200) and the response reflects the derived status', async () => {
      const variantId = await createTestVariant('STK');
      const res = await request(server)
        .put(`/api/admin/variants/${variantId}/stock`)
        .set('Authorization', `Bearer ${warehouseToken}`)
        .send({ quantityOnHand: 3, reorderThreshold: 10 })
        .expect(200);

      expect(res.body).toEqual({ variantId, quantityOnHand: 3, reorderThreshold: 10, status: 'LOW_STOCK' });
    });

    it('22. SUPER_ADMIN can also set stock; re-setting to 0 flips status to OUT_OF_STOCK', async () => {
      const variantId = await createTestVariant('STK');
      await request(server)
        .put(`/api/admin/variants/${variantId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantityOnHand: 50, reorderThreshold: 10 })
        .expect(200);

      const res = await request(server)
        .put(`/api/admin/variants/${variantId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantityOnHand: 0, reorderThreshold: 10 })
        .expect(200);
      expect(res.body.status).toBe('OUT_OF_STOCK');
    });

    it('23. a SALES token returns 403', async () => {
      const variantId = await createTestVariant('STK');
      await request(server)
        .put(`/api/admin/variants/${variantId}/stock`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ quantityOnHand: 5, reorderThreshold: 10 })
        .expect(403);
    });

    it('24. a CONTENT token returns 403', async () => {
      const variantId = await createTestVariant('STK');
      await request(server)
        .put(`/api/admin/variants/${variantId}/stock`)
        .set('Authorization', `Bearer ${contentToken}`)
        .send({ quantityOnHand: 5, reorderThreshold: 10 })
        .expect(403);
    });

    it('25. unauthenticated returns 401', async () => {
      const variantId = await createTestVariant('STK');
      await request(server)
        .put(`/api/admin/variants/${variantId}/stock`)
        .send({ quantityOnHand: 5, reorderThreshold: 10 })
        .expect(401);
    });

    it('26. a negative quantityOnHand returns 400', async () => {
      const variantId = await createTestVariant('STK');
      await request(server)
        .put(`/api/admin/variants/${variantId}/stock`)
        .set('Authorization', `Bearer ${warehouseToken}`)
        .send({ quantityOnHand: -1, reorderThreshold: 10 })
        .expect(400);
    });

    it('27. an unknown variant returns 404', async () => {
      await request(server)
        .put('/api/admin/variants/nonexistent-variant-id/stock')
        .set('Authorization', `Bearer ${warehouseToken}`)
        .send({ quantityOnHand: 5, reorderThreshold: 10 })
        .expect(404);
    });
  });

  // -----------------------------------------------------------------
  // Integration — ties the whole plan together
  // -----------------------------------------------------------------
  describe('integration: pricing write path feeds PriceResolutionService directly', () => {
    it('28. setting a DEALER_B price for KT-EDU-001 changes resolveUnitPrice for a DEALER_B viewer, while an anonymous viewer still resolves to the unchanged retail price', async () => {
      const eduVariant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: 'KT-EDU-001' } });

      const retailBefore = await priceResolution.resolveUnitPrice(eduVariant.id, {}, 1);

      const NEW_DEALER_B_PRICE = '111500';
      await request(server)
        .put(`/api/admin/variants/${eduVariant.id}/prices`)
        .set('Authorization', `Bearer ${salesToken}`)
        .send({ tierId: dealerBTierId, minQty: 1, unitPriceVnd: NEW_DEALER_B_PRICE })
        .expect(200);

      const dealerBAccount = await prisma.account.create({
        data: {
          email: `dealerb-integration-${randomUUID()}@test.local`,
          passwordHash: 'x',
          type: 'BUSINESS_ACCOUNT',
        },
      });
      await prisma.businessAccount.create({
        data: {
          accountId: dealerBAccount.id,
          companyName: 'Integration Dealer B',
          taxId: `50550550${Math.floor(Math.random() * 100)}`,
          businessType: 'DISTRIBUTOR',
          approvalStatus: 'APPROVED',
          priceTierId: dealerBTierId,
        },
      });

      const dealerBResult = await priceResolution.resolveUnitPrice(
        eduVariant.id,
        {
          type: 'BUSINESS_ACCOUNT',
          accountId: dealerBAccount.id,
          approvalStatus: 'APPROVED',
          priceTierId: dealerBTierId,
        },
        1,
      );
      expect(dealerBResult.unitPriceVnd).toBe(BigInt(NEW_DEALER_B_PRICE));
      expect(dealerBResult.tierId).toBe(dealerBTierId);

      const retailAfter = await priceResolution.resolveUnitPrice(eduVariant.id, {}, 1);
      expect(retailAfter.unitPriceVnd).toBe(retailBefore.unitPriceVnd);
      expect(retailAfter.tierId).toBe(retailTierId);
    });
  });
});

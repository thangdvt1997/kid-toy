import { NotFoundException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, resetAndSeed } from '../../../test/utils/test-app';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../common/types/jwt-payload';
import { PriceResolutionService, type Viewer } from './price-resolution.service';

/**
 * Database-backed spec — unlike every other unit spec in this codebase
 * (mocked PrismaService), this one needs real seeded tier/entry rows to
 * prove quantity-break ordering and validity-window filtering actually
 * work at the SQL level, not just against a mocked `findFirst`/`findMany`.
 * Requires a live Postgres pointed at by DATABASE_URL (kidtoy_test) — see
 * apps/api/test/utils/test-app.ts. Not runnable on a machine with no
 * Docker; verified against the live VPS stack by the orchestrator.
 *
 * Named `*.integration-spec.ts` (01-09A Task 3), NOT `*.spec.ts`, so the
 * plain `pnpm test` command's `testRegex` (`.*\.spec\.ts$` in this
 * package's package.json — note the literal "." immediately before "spec",
 * which "integration-spec.ts" does not have) never matches this file and
 * a routine unit-test run never needs a database. Run this specifically —
 * against `kidtoy_test` only, never dev/prod — via `pnpm test:integration`
 * (see test/jest-integration.json).
 */
describe('PriceResolutionService (database-backed)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: PriceResolutionService;

  let retailTierId: string;
  let dealerATierId: string;
  let dealerBTierId: string;

  let eduVariantId: string; // KT-EDU-001 — has RETAIL@1, DEALER_A@1, DEALER_A@12, DEALER_B@1
  let vehVariantId: string; // KT-VEH-001 — retail-priced seed variant, used only for batch test
  let babyVariantId: string; // KT-BABY-001 — retail-priced seed variant, used only for batch test

  let approvedDealerAAccountId: string; // dealer@kidtoy.local — APPROVED, DEALER_A
  let pendingDealerAccountId: string; // pending-dealer@kidtoy.local — PENDING, no tier

  let dealerBAccountId: string; // test-only APPROVED account on DEALER_B
  let rejectedAccountId: string; // test-only REJECTED account with a stale priceTierId

  let retailOnlyVariantId: string; // test-only variant with ONLY a retail entry
  let noPriceVariantId: string; // test-only variant with NO price entries at all

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    service = app.get(PriceResolutionService);

    await resetAndSeed(prisma);

    const [retail, dealerA, dealerB] = await Promise.all([
      prisma.priceTier.findFirstOrThrow({ where: { code: 'RETAIL' } }),
      prisma.priceTier.findFirstOrThrow({ where: { code: 'DEALER_A' } }),
      prisma.priceTier.findFirstOrThrow({ where: { code: 'DEALER_B' } }),
    ]);
    retailTierId = retail.id;
    dealerATierId = dealerA.id;
    dealerBTierId = dealerB.id;

    const [eduVariant, vehVariant, babyVariant] = await Promise.all([
      prisma.productVariant.findUniqueOrThrow({ where: { sku: 'KT-EDU-001' } }),
      prisma.productVariant.findUniqueOrThrow({ where: { sku: 'KT-VEH-001' } }),
      prisma.productVariant.findUniqueOrThrow({ where: { sku: 'KT-BABY-001' } }),
    ]);
    eduVariantId = eduVariant.id;
    vehVariantId = vehVariant.id;
    babyVariantId = babyVariant.id;

    const approvedDealerA = await prisma.businessAccount.findFirstOrThrow({
      where: { approvalStatus: 'APPROVED' },
    });
    approvedDealerAAccountId = approvedDealerA.accountId;

    const pendingDealer = await prisma.businessAccount.findFirstOrThrow({
      where: { approvalStatus: 'PENDING' },
    });
    pendingDealerAccountId = pendingDealer.accountId;

    // A second APPROVED dealer account, on DEALER_B, purely for this spec —
    // the seed only wires one approved dealer (on DEALER_A).
    const dealerBAccount = await prisma.account.create({
      data: {
        email: `dealer-b-spec-${Date.now()}@test.local`,
        passwordHash: 'x',
        type: 'BUSINESS_ACCOUNT',
      },
    });
    await prisma.businessAccount.create({
      data: {
        accountId: dealerBAccount.id,
        companyName: 'Dealer B Spec Co',
        taxId: '3033033033',
        businessType: 'DISTRIBUTOR',
        approvalStatus: 'APPROVED',
        priceTierId: dealerBTierId,
      },
    });
    dealerBAccountId = dealerBAccount.id;

    // A REJECTED account with a non-null priceTierId still sitting on the
    // row — proves resolveTierId never trusts a stale JWT claim OR a stale
    // DB tier assignment once approvalStatus is REJECTED.
    const rejectedAccount = await prisma.account.create({
      data: {
        email: `rejected-spec-${Date.now()}@test.local`,
        passwordHash: 'x',
        type: 'BUSINESS_ACCOUNT',
      },
    });
    await prisma.businessAccount.create({
      data: {
        accountId: rejectedAccount.id,
        companyName: 'Rejected Spec Co',
        taxId: '4044044044',
        businessType: 'RETAIL_STORE',
        approvalStatus: 'REJECTED',
        priceTierId: dealerATierId,
      },
    });
    rejectedAccountId = rejectedAccount.id;

    // Two extra variants for the fallback / not-configured cases below.
    const anyProduct = await prisma.product.findFirstOrThrow();
    const retailOnlyVariant = await prisma.productVariant.create({
      data: {
        productId: anyProduct.id,
        sku: `TEST-RETAIL-ONLY-${Date.now()}`,
        isActive: true,
      },
    });
    retailOnlyVariantId = retailOnlyVariant.id;
    await prisma.priceListEntry.create({
      data: {
        variantId: retailOnlyVariantId,
        tierId: retailTierId,
        minQty: 1,
        unitPriceVnd: 111000n,
      },
    });

    const noPriceVariant = await prisma.productVariant.create({
      data: {
        productId: anyProduct.id,
        sku: `TEST-NO-PRICE-${Date.now()}`,
        isActive: true,
      },
    });
    noPriceVariantId = noPriceVariant.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function approvedDealerAViewer(): Viewer {
    return {
      type: 'BUSINESS_ACCOUNT',
      accountId: approvedDealerAAccountId,
      approvalStatus: 'APPROVED',
      priceTierId: dealerATierId,
    };
  }

  function dealerBViewer(): Viewer {
    return {
      type: 'BUSINESS_ACCOUNT',
      accountId: dealerBAccountId,
      approvalStatus: 'APPROVED',
      priceTierId: dealerBTierId,
    };
  }

  // -----------------------------------------------------------------
  // resolveTierId
  // -----------------------------------------------------------------
  describe('resolveTierId', () => {
    it('1. anonymous viewer ({}) resolves to the default RETAIL tier', async () => {
      await expect(service.resolveTierId({})).resolves.toBe(retailTierId);
    });

    it('2. a RETAIL_CUSTOMER viewer resolves to the default RETAIL tier', async () => {
      await expect(
        service.resolveTierId({ type: 'RETAIL_CUSTOMER', accountId: 'some-customer-id' }),
      ).resolves.toBe(retailTierId);
    });

    it('3. a STAFF viewer resolves to the default RETAIL tier, not a dealer tier', async () => {
      await expect(service.resolveTierId({ type: 'STAFF' })).resolves.toBe(retailTierId);
    });

    it('4. an APPROVED business account resolves to its assigned dealer tier', async () => {
      await expect(service.resolveTierId(approvedDealerAViewer())).resolves.toBe(dealerATierId);
    });

    it('5. a PENDING business account (priceTierId null) resolves to the default RETAIL tier', async () => {
      await expect(
        service.resolveTierId({
          type: 'BUSINESS_ACCOUNT',
          accountId: pendingDealerAccountId,
          approvalStatus: 'PENDING',
          priceTierId: null,
        }),
      ).resolves.toBe(retailTierId);
    });

    it('6. a REJECTED business account with a non-null priceTierId on the row still resolves to the default RETAIL tier', async () => {
      await expect(
        service.resolveTierId({
          type: 'BUSINESS_ACCOUNT',
          accountId: rejectedAccountId,
          approvalStatus: 'REJECTED',
          priceTierId: dealerATierId,
        }),
      ).resolves.toBe(retailTierId);
    });

    it('7. re-reads BusinessAccount from the database rather than trusting the JWT-carried fields (a revoked approval cannot be replayed with an old token)', async () => {
      // The DB row for this account is APPROVED / DEALER_A. Pass a viewer
      // claiming a stale PENDING/null-tier state (as an old, pre-approval
      // JWT would) — the service must ignore those claims and trust the DB.
      await expect(
        service.resolveTierId({
          type: 'BUSINESS_ACCOUNT',
          accountId: approvedDealerAAccountId,
          approvalStatus: 'PENDING',
          priceTierId: null,
        }),
      ).resolves.toBe(dealerATierId);
    });
  });

  // -----------------------------------------------------------------
  // resolveUnitPrice — quantity breaks
  // -----------------------------------------------------------------
  describe('resolveUnitPrice — quantity breaks', () => {
    it('8. qty=1 for an approved DEALER_A viewer returns the DEALER_A minQty=1 entry', async () => {
      const result = await service.resolveUnitPrice(eduVariantId, approvedDealerAViewer(), 1);
      expect(result.tierId).toBe(dealerATierId);
      expect(result.tierCode).toBe('DEALER_A');
      expect(result.minQty).toBe(1);
    });

    it('9. qty=11 still returns the minQty=1 entry (below the qty=12 break)', async () => {
      const result = await service.resolveUnitPrice(eduVariantId, approvedDealerAViewer(), 11);
      expect(result.minQty).toBe(1);
    });

    it('10. qty=12 returns the better minQty=12 quantity-break entry', async () => {
      const result = await service.resolveUnitPrice(eduVariantId, approvedDealerAViewer(), 12);
      expect(result.minQty).toBe(12);
    });

    it('11. qty=50 also returns the minQty=12 quantity-break entry', async () => {
      const result = await service.resolveUnitPrice(eduVariantId, approvedDealerAViewer(), 50);
      expect(result.minQty).toBe(12);
    });

    it('12. an anonymous viewer resolves to the RETAIL tier price for the same SKU an approved dealer resolves differently for', async () => {
      const retailResult = await service.resolveUnitPrice(eduVariantId, {}, 1);
      const dealerResult = await service.resolveUnitPrice(eduVariantId, approvedDealerAViewer(), 1);
      expect(retailResult.tierId).toBe(retailTierId);
      expect(dealerResult.tierId).toBe(dealerATierId);
      expect(retailResult.unitPriceVnd).not.toBe(dealerResult.unitPriceVnd);
    });

    it('13. a PENDING business viewer resolves to the same RETAIL price as an anonymous viewer', async () => {
      const anonymous = await service.resolveUnitPrice(eduVariantId, {}, 1);
      const pending = await service.resolveUnitPrice(
        eduVariantId,
        {
          type: 'BUSINESS_ACCOUNT',
          accountId: pendingDealerAccountId,
          approvalStatus: 'PENDING',
          priceTierId: null,
        },
        1,
      );
      expect(pending.tierId).toBe(retailTierId);
      expect(pending.unitPriceVnd).toBe(anonymous.unitPriceVnd);
    });
  });

  // -----------------------------------------------------------------
  // resolveUnitPrice — validity window
  // -----------------------------------------------------------------
  describe('resolveUnitPrice — validity window', () => {
    it('14. ignores an entry whose validFrom is in the future', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.priceListEntry.create({
        data: {
          variantId: eduVariantId,
          tierId: dealerBTierId,
          minQty: 500,
          unitPriceVnd: 1n,
          validFrom: future,
        },
      });
      const result = await service.resolveUnitPrice(eduVariantId, dealerBViewer(), 500);
      // The DEALER_B@minQty=1 seeded entry is the only valid qualifying
      // entry at qty=500 — the future-dated minQty=500 entry must be ignored.
      expect(result.minQty).toBe(1);
      expect(result.tierId).toBe(dealerBTierId);
    });

    it('15. ignores an entry whose validTo is in the past', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.priceListEntry.create({
        data: {
          variantId: eduVariantId,
          tierId: dealerBTierId,
          minQty: 600,
          unitPriceVnd: 1n,
          validFrom: new Date('2020-01-01T00:00:00Z'),
          validTo: past,
        },
      });
      const result = await service.resolveUnitPrice(eduVariantId, dealerBViewer(), 600);
      expect(result.minQty).toBe(1);
      expect(result.tierId).toBe(dealerBTierId);
    });
  });

  // -----------------------------------------------------------------
  // resolveUnitPrice — fallback and not-configured
  // -----------------------------------------------------------------
  describe('resolveUnitPrice — fallback and not-configured', () => {
    it('16. falls back to the default RETAIL tier entry when the resolved dealer tier has no entry for the variant', async () => {
      const result = await service.resolveUnitPrice(retailOnlyVariantId, approvedDealerAViewer(), 1);
      expect(result.tierId).toBe(retailTierId);
      expect(result.unitPriceVnd).toBe(111000n);
    });

    it('17. throws NotFoundException(PRICE_NOT_CONFIGURED) when neither the resolved tier nor the default tier has any entry', async () => {
      await expect(service.resolveUnitPrice(noPriceVariantId, {}, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.resolveUnitPrice(noPriceVariantId, {}, 1)).rejects.toMatchObject({
        message: 'PRICE_NOT_CONFIGURED',
      });
    });
  });

  // -----------------------------------------------------------------
  // resolveUnitPrices — batch (N+1 guard)
  // -----------------------------------------------------------------
  describe('resolveUnitPrices (batch)', () => {
    it('18. issues exactly ONE price_list_entries query for a 3-variant batch and returns a price for every variant that has one', async () => {
      const spy = jest.spyOn(prisma.priceListEntry, 'findMany');
      try {
        const variantIds = [eduVariantId, vehVariantId, babyVariantId];
        const result = await service.resolveUnitPrices(variantIds, {}, 1);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(result.size).toBe(3);
        for (const variantId of variantIds) {
          expect(result.get(variantId)?.tierId).toBe(retailTierId);
        }
      } finally {
        spy.mockRestore();
      }
    });

    it('19. an empty variantIds array short-circuits to an empty Map without querying', async () => {
      const spy = jest.spyOn(prisma.priceListEntry, 'findMany');
      try {
        const result = await service.resolveUnitPrices([], {}, 1);
        expect(result.size).toBe(0);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  // -----------------------------------------------------------------
  // viewerFromJwt
  // -----------------------------------------------------------------
  describe('viewerFromJwt', () => {
    it('20. returns {} for an undefined payload (anonymous)', () => {
      expect(service.viewerFromJwt(undefined)).toEqual({});
    });

    it('21. copies sub -> accountId, type, approvalStatus, priceTierId from a JwtPayload', () => {
      const payload: JwtPayload = {
        sub: 'acct-123',
        type: 'BUSINESS_ACCOUNT',
        approvalStatus: 'APPROVED',
        priceTierId: 'tier-456',
      };
      expect(service.viewerFromJwt(payload)).toEqual({
        accountId: 'acct-123',
        type: 'BUSINESS_ACCOUNT',
        approvalStatus: 'APPROVED',
        priceTierId: 'tier-456',
      });
    });
  });
});

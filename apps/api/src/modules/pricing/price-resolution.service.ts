import { Injectable, NotFoundException } from '@nestjs/common';
import type { PriceListEntry, PriceTier } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../common/types/jwt-payload';

/**
 * ============================================================================
 * THIS IS THE ONLY CODE PATH IN THIS REPOSITORY PERMITTED TO COMPUTE A PRICE.
 * ============================================================================
 * Any `if (dealer) price * discount` (or equivalent conditional price math)
 * written anywhere else — controllers, cart, checkout, Excel bulk import,
 * reporting — is a defect. See ARCHITECTURE.md Anti-Pattern 3 and
 * PITFALLS.md Pitfall 1: a `wholesale_price` column bolted onto the product
 * table, or price logic scattered across call sites, is exactly the retrofit
 * trap this service exists to prevent. Every caller — catalog listing, cart,
 * order creation, quote, bulk import — MUST resolve prices through
 * `PriceResolutionService`, never by reading `PriceListEntry` directly.
 */

/** A caller's pricing context. Absent fields mean "anonymous viewer". */
export interface Viewer {
  accountId?: string;
  type?: 'STAFF' | 'RETAIL_CUSTOMER' | 'BUSINESS_ACCOUNT';
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  priceTierId?: string | null;
}

export interface ResolvedPrice {
  variantId: string;
  tierId: string;
  tierCode: string;
  minQty: number;
  unitPriceVnd: bigint;
}

type EntryWithTier = PriceListEntry & { tier: PriceTier };

@Injectable()
export class PriceResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The default (RETAIL) tier id is immutable in practice — seeded once,
   * never reassigned — so it is safe to memoize for the process lifetime.
   * The per-account dealer-tier lookup below is NEVER cached: it must
   * reflect a revoked/changed approval on the very next request.
   */
  private defaultTierId: string | null = null;

  private async getDefaultTierId(): Promise<string> {
    if (this.defaultTierId) {
      return this.defaultTierId;
    }
    const retail = await this.prisma.priceTier.findFirstOrThrow({
      where: { isDefault: true },
    });
    this.defaultTierId = retail.id;
    return retail.id;
  }

  /**
   * Resolves the viewer's price tier. ALWAYS re-reads `BusinessAccount`
   * from the database for a BUSINESS_ACCOUNT viewer — `viewer.approvalStatus`
   * / `viewer.priceTierId` carried on an old JWT are never trusted, so a
   * revoked approval cannot be replayed with a stale access token (T-01-41).
   * Anonymous, retail-customer and staff viewers all resolve to the default
   * (RETAIL) tier — staff see retail pricing, not a dealer tier.
   */
  async resolveTierId(viewer: Viewer): Promise<string> {
    if (viewer.type === 'BUSINESS_ACCOUNT' && viewer.accountId) {
      const businessAccount = await this.prisma.businessAccount.findUnique({
        where: { accountId: viewer.accountId },
      });
      if (businessAccount?.approvalStatus === 'APPROVED' && businessAccount.priceTierId) {
        return businessAccount.priceTierId;
      }
    }
    return this.getDefaultTierId();
  }

  /**
   * Resolves the single best-qualifying `PriceListEntry` for one variant in
   * one tier: highest `minQty` not exceeding `qty`, within its validity
   * window (`validFrom <= now` and `validTo` either null or `> now`).
   */
  private async findBestEntry(
    variantId: string,
    tierId: string,
    qty: number,
    now: Date,
  ): Promise<EntryWithTier | null> {
    return this.prisma.priceListEntry.findFirst({
      where: {
        variantId,
        tierId,
        minQty: { lte: qty },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      orderBy: { minQty: 'desc' },
      include: { tier: true },
    });
  }

  private toResolvedPrice(entry: EntryWithTier): ResolvedPrice {
    return {
      variantId: entry.variantId,
      tierId: entry.tierId,
      tierCode: entry.tier.code,
      minQty: entry.minQty,
      unitPriceVnd: entry.unitPriceVnd,
    };
  }

  /**
   * Resolves the unit price a single variant should be sold at for this
   * viewer/quantity. Falls back from a dealer tier to the default (RETAIL)
   * tier when the dealer tier has no entry for the variant — a dealer tier
   * missing a SKU must never make that SKU unpurchasable (T-01-47). Throws
   * `NotFoundException('PRICE_NOT_CONFIGURED')` only when NEITHER the
   * resolved tier NOR the default tier has a qualifying entry.
   */
  async resolveUnitPrice(variantId: string, viewer: Viewer, qty = 1): Promise<ResolvedPrice> {
    const tierId = await this.resolveTierId(viewer);
    const defaultTierId = await this.getDefaultTierId();
    const now = new Date();

    const entry = await this.findBestEntry(variantId, tierId, qty, now);
    if (entry) {
      return this.toResolvedPrice(entry);
    }

    if (tierId !== defaultTierId) {
      const fallback = await this.findBestEntry(variantId, defaultTierId, qty, now);
      if (fallback) {
        return this.toResolvedPrice(fallback);
      }
    }

    throw new NotFoundException('PRICE_NOT_CONFIGURED');
  }

  /**
   * Batch price resolution for a page of variants — issues exactly ONE
   * `price_list_entries` query regardless of how many variant ids are
   * requested (T-01-46: an N+1 here would be the first performance bug of
   * the project). Reduces in memory to the best-qualifying entry per
   * variant, preferring the resolved tier over the default-tier fallback,
   * then the highest qualifying `minQty` within that preference.
   */
  async resolveUnitPrices(
    variantIds: string[],
    viewer: Viewer,
    qty = 1,
  ): Promise<Map<string, ResolvedPrice>> {
    if (variantIds.length === 0) {
      return new Map();
    }

    const tierId = await this.resolveTierId(viewer);
    const defaultTierId = await this.getDefaultTierId();
    const now = new Date();
    const tierIds = tierId === defaultTierId ? [tierId] : [tierId, defaultTierId];

    const entries = await this.prisma.priceListEntry.findMany({
      where: {
        variantId: { in: variantIds },
        tierId: { in: tierIds },
        minQty: { lte: qty },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      include: { tier: true },
    });

    const best = new Map<string, EntryWithTier>();
    for (const entry of entries) {
      const current = best.get(entry.variantId);
      if (!current) {
        best.set(entry.variantId, entry);
        continue;
      }
      const currentIsResolvedTier = current.tierId === tierId;
      const entryIsResolvedTier = entry.tierId === tierId;
      if (entryIsResolvedTier && !currentIsResolvedTier) {
        best.set(entry.variantId, entry);
        continue;
      }
      if (entryIsResolvedTier === currentIsResolvedTier && entry.minQty > current.minQty) {
        best.set(entry.variantId, entry);
      }
    }

    const result = new Map<string, ResolvedPrice>();
    for (const [variantId, entry] of best) {
      result.set(variantId, this.toResolvedPrice(entry));
    }
    return result;
  }

  /** `undefined` payload (no/invalid JWT) means an anonymous viewer. */
  viewerFromJwt(payload?: JwtPayload): Viewer {
    if (!payload) {
      return {};
    }
    return {
      accountId: payload.sub,
      type: payload.type,
      approvalStatus: payload.approvalStatus,
      priceTierId: payload.priceTierId,
    };
  }
}

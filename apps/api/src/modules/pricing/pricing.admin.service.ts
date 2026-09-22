import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PriceEntryDto, PriceTierDto } from '@kid-toy/shared-types';
import { Prisma } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpsertPriceEntryDto } from './dto/upsert-price-entry.dto';
import type { UpsertPriceTierDto } from './dto/upsert-price-tier.dto';

type EntryWithTier = Prisma.PriceListEntryGetPayload<{ include: { tier: true } }>;

/**
 * Price-tier and price-list-entry administration (CATALOG-06 write path).
 * This service only ever WRITES `price_tiers` / `price_list_entries` rows —
 * it never computes a price for a viewer. Reading a resolved price is
 * PriceResolutionService's job exclusively (see price-resolution.service.ts
 * header comment).
 */
@Injectable()
export class PricingAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------
  // Tiers
  // -----------------------------------------------------------------

  /** `isDefault` is always forced to false — exactly one default tier exists and it is seeded. */
  async createTier(dto: UpsertPriceTierDto): Promise<PriceTierDto> {
    try {
      const tier = await this.prisma.priceTier.create({
        data: { code: dto.code, name: dto.name, isDefault: false },
      });
      return this.toTierDto(tier);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('TIER_CODE_TAKEN');
      }
      throw err;
    }
  }

  async listTiers(): Promise<PriceTierDto[]> {
    const tiers = await this.prisma.priceTier.findMany({ orderBy: { code: 'asc' } });
    return tiers.map((tier) => this.toTierDto(tier));
  }

  private toTierDto(tier: {
    id: string;
    code: string;
    name: string;
    isDefault: boolean;
  }): PriceTierDto {
    return { id: tier.id, code: tier.code, name: tier.name, isDefault: tier.isDefault };
  }

  // -----------------------------------------------------------------
  // Entries
  // -----------------------------------------------------------------

  async listEntries(variantId: string): Promise<PriceEntryDto[]> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) {
      throw new NotFoundException('VARIANT_NOT_FOUND');
    }
    const entries = await this.prisma.priceListEntry.findMany({
      where: { variantId },
      include: { tier: true },
      orderBy: [{ tier: { code: 'asc' } }, { minQty: 'asc' }],
    });
    return entries.map((entry) => this.toEntryDto(entry));
  }

  /**
   * Upserts on the `[variantId, tierId, minQty]` compound unique — calling
   * this twice with the same triple updates the existing row rather than
   * duplicating it. Validates the variant (404) and tier (400) exist BEFORE
   * writing, so a foreign-key violation (P2003) is never surfaced raw.
   */
  async upsertEntry(variantId: string, dto: UpsertPriceEntryDto): Promise<PriceEntryDto> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) {
      throw new NotFoundException('VARIANT_NOT_FOUND');
    }
    const tier = await this.prisma.priceTier.findUnique({ where: { id: dto.tierId } });
    if (!tier) {
      throw new BadRequestException('TIER_NOT_FOUND');
    }

    // UpsertPriceEntryDto's @Matches(/^\d{1,15}$/) already guarantees a
    // digits-only string reaches here; the try/catch is defense in depth.
    let unitPriceVnd: bigint;
    try {
      unitPriceVnd = BigInt(dto.unitPriceVnd);
    } catch {
      throw new BadRequestException('UNIT_PRICE_INVALID');
    }

    const entry = await this.prisma.priceListEntry.upsert({
      where: {
        variantId_tierId_minQty: { variantId, tierId: dto.tierId, minQty: dto.minQty },
      },
      update: { unitPriceVnd },
      create: { variantId, tierId: dto.tierId, minQty: dto.minQty, unitPriceVnd },
      include: { tier: true },
    });
    return this.toEntryDto(entry);
  }

  /**
   * Deleting the LAST remaining default-tier (RETAIL) entry for a variant
   * is refused (409 LAST_RETAIL_PRICE) — a SKU must never be left with no
   * retail price at all (T-01-47). Non-default-tier entries, and default-tier
   * entries when another one still exists for the variant, delete freely.
   */
  async deleteEntry(entryId: string): Promise<void> {
    const entry = await this.prisma.priceListEntry.findUnique({
      where: { id: entryId },
      include: { tier: true },
    });
    if (!entry) {
      throw new NotFoundException('PRICE_ENTRY_NOT_FOUND');
    }

    if (entry.tier.isDefault) {
      const defaultEntryCount = await this.prisma.priceListEntry.count({
        where: { variantId: entry.variantId, tier: { isDefault: true } },
      });
      if (defaultEntryCount <= 1) {
        throw new ConflictException('LAST_RETAIL_PRICE');
      }
    }

    await this.prisma.priceListEntry.delete({ where: { id: entryId } });
  }

  private toEntryDto(entry: EntryWithTier): PriceEntryDto {
    return {
      id: entry.id,
      variantId: entry.variantId,
      tierId: entry.tierId,
      tierCode: entry.tier.code,
      minQty: entry.minQty,
      unitPriceVnd: entry.unitPriceVnd.toString(),
    };
  }
}

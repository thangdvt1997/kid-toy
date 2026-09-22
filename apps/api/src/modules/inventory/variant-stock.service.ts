import { Injectable, NotFoundException } from '@nestjs/common';
import type { StockStatus } from '@kid-toy/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * DELIBERATELY THIN Phase 1 stub (CATALOG-08) — this module publishes a
 * stable per-variant availability READ CONTRACT, not a real inventory
 * ledger. Phase 2 (INV-01..08, see PITFALLS.md Pitfall 4) replaces the
 * storage behind this module with a SKU x Warehouse x Batch ledger and
 * MUST keep `getAvailability`/`getAvailabilityMany`'s signatures unchanged
 * so no catalog caller has to be touched when that migration lands. Do
 * NOT add multi-location tracking, reservation holds, stock movements or
 * lot/expiry fields here — that is explicitly out of scope for Phase 1
 * (T-01-49: stale stock is an accepted display-only risk until Phase 2).
 */

export function deriveStockStatus(quantityOnHand: number, reorderThreshold: number): StockStatus {
  if (quantityOnHand <= 0) {
    return 'OUT_OF_STOCK';
  }
  if (reorderThreshold > 0 && quantityOnHand <= reorderThreshold) {
    return 'LOW_STOCK';
  }
  return 'IN_STOCK';
}

export interface VariantAvailability {
  variantId: string;
  status: StockStatus;
}

export interface VariantStockRecord {
  variantId: string;
  quantityOnHand: number;
  reorderThreshold: number;
  status: StockStatus;
}

@Injectable()
export class VariantStockService {
  constructor(private readonly prisma: PrismaService) {}

  async getAvailability(variantId: string): Promise<VariantAvailability> {
    const row = await this.prisma.variantStock.findUnique({ where: { variantId } });
    if (!row) {
      return { variantId, status: 'OUT_OF_STOCK' };
    }
    return { variantId, status: deriveStockStatus(row.quantityOnHand, row.reorderThreshold) };
  }

  /** Single query keyed by `variantId in [...]` — absent rows default to OUT_OF_STOCK. */
  async getAvailabilityMany(variantIds: string[]): Promise<Map<string, StockStatus>> {
    const result = new Map<string, StockStatus>();
    if (variantIds.length === 0) {
      return result;
    }
    const rows = await this.prisma.variantStock.findMany({
      where: { variantId: { in: variantIds } },
    });
    const byId = new Map(rows.map((row) => [row.variantId, row]));
    for (const variantId of variantIds) {
      const row = byId.get(variantId);
      result.set(
        variantId,
        row ? deriveStockStatus(row.quantityOnHand, row.reorderThreshold) : 'OUT_OF_STOCK',
      );
    }
    return result;
  }

  async setStock(
    variantId: string,
    quantityOnHand: number,
    reorderThreshold: number,
  ): Promise<VariantStockRecord> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) {
      throw new NotFoundException('VARIANT_NOT_FOUND');
    }
    const row = await this.prisma.variantStock.upsert({
      where: { variantId },
      update: { quantityOnHand, reorderThreshold },
      create: { variantId, quantityOnHand, reorderThreshold },
    });
    return {
      variantId: row.variantId,
      quantityOnHand: row.quantityOnHand,
      reorderThreshold: row.reorderThreshold,
      status: deriveStockStatus(row.quantityOnHand, row.reorderThreshold),
    };
  }
}

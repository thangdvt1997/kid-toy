import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { VariantStockService, deriveStockStatus } from './variant-stock.service';

describe('deriveStockStatus', () => {
  it('quantityOnHand=0, reorderThreshold=10 -> OUT_OF_STOCK', () => {
    expect(deriveStockStatus(0, 10)).toBe('OUT_OF_STOCK');
  });

  it('quantityOnHand=5, reorderThreshold=10 -> LOW_STOCK', () => {
    expect(deriveStockStatus(5, 10)).toBe('LOW_STOCK');
  });

  it('quantityOnHand=10, reorderThreshold=10 -> LOW_STOCK (at threshold is low, not in-stock)', () => {
    expect(deriveStockStatus(10, 10)).toBe('LOW_STOCK');
  });

  it('quantityOnHand=11, reorderThreshold=10 -> IN_STOCK', () => {
    expect(deriveStockStatus(11, 10)).toBe('IN_STOCK');
  });

  it('quantityOnHand=5, reorderThreshold=0 -> IN_STOCK (no reorder threshold configured)', () => {
    expect(deriveStockStatus(5, 0)).toBe('IN_STOCK');
  });

  it('quantityOnHand=0, reorderThreshold=0 -> OUT_OF_STOCK', () => {
    expect(deriveStockStatus(0, 0)).toBe('OUT_OF_STOCK');
  });
});

describe('VariantStockService', () => {
  let service: VariantStockService;
  let prisma: {
    variantStock: { findUnique: jest.Mock; findMany: jest.Mock; upsert: jest.Mock };
    productVariant: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      variantStock: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
      productVariant: { findUnique: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [VariantStockService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(VariantStockService);
  });

  describe('getAvailability', () => {
    it('returns OUT_OF_STOCK (not a throw) when no variant_stock row exists', async () => {
      prisma.variantStock.findUnique.mockResolvedValue(null);
      const result = await service.getAvailability('v1');
      expect(result).toEqual({ variantId: 'v1', status: 'OUT_OF_STOCK' });
    });

    it('derives status from an existing row', async () => {
      prisma.variantStock.findUnique.mockResolvedValue({
        variantId: 'v1',
        quantityOnHand: 5,
        reorderThreshold: 10,
      });
      const result = await service.getAvailability('v1');
      expect(result).toEqual({ variantId: 'v1', status: 'LOW_STOCK' });
    });
  });

  describe('getAvailabilityMany', () => {
    it('issues exactly one query and defaults absent rows to OUT_OF_STOCK', async () => {
      prisma.variantStock.findMany.mockResolvedValue([
        { variantId: 'v1', quantityOnHand: 20, reorderThreshold: 10 },
      ]);
      const result = await service.getAvailabilityMany(['v1', 'v2']);
      expect(prisma.variantStock.findMany).toHaveBeenCalledTimes(1);
      expect(result.get('v1')).toBe('IN_STOCK');
      expect(result.get('v2')).toBe('OUT_OF_STOCK');
    });

    it('short-circuits an empty array without querying', async () => {
      const result = await service.getAvailabilityMany([]);
      expect(result.size).toBe(0);
      expect(prisma.variantStock.findMany).not.toHaveBeenCalled();
    });
  });

  describe('setStock', () => {
    it('throws NotFoundException(VARIANT_NOT_FOUND) when the variant does not exist', async () => {
      prisma.productVariant.findUnique.mockResolvedValue(null);
      await expect(service.setStock('missing', 5, 10)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.setStock('missing', 5, 10)).rejects.toMatchObject({
        message: 'VARIANT_NOT_FOUND',
      });
    });

    it('upserts on the variantId primary key and returns the derived status', async () => {
      prisma.productVariant.findUnique.mockResolvedValue({ id: 'v1' });
      prisma.variantStock.upsert.mockResolvedValue({
        variantId: 'v1',
        quantityOnHand: 3,
        reorderThreshold: 10,
      });

      const result = await service.setStock('v1', 3, 10);

      expect(result).toEqual({
        variantId: 'v1',
        quantityOnHand: 3,
        reorderThreshold: 10,
        status: 'LOW_STOCK',
      });
      expect(prisma.variantStock.upsert).toHaveBeenCalledWith({
        where: { variantId: 'v1' },
        update: { quantityOnHand: 3, reorderThreshold: 10 },
        create: { variantId: 'v1', quantityOnHand: 3, reorderThreshold: 10 },
      });
    });
  });
});

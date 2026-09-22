import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxonomyService } from './taxonomy.service';
import type { UpsertCategoryDto, UpdateCategoryDto } from './dto/upsert-category.dto';
import type { UpsertBrandDto } from './dto/upsert-brand.dto';

/**
 * Builds a P2002 error matching Prisma 7's ACTUAL @prisma/adapter-pg shape
 * (meta.modelName, not meta.target) — see business-accounts.service.spec.ts
 * for the full rationale; this codebase's standard pattern for every
 * P2002-mapping unit test.
 */
function makeP2002(modelName?: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
    meta: modelName ? { modelName } : {},
  });
}

function makeP2003(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
    code: 'P2003',
    clientVersion: '7.10.0',
    meta: {},
  });
}

describe('TaxonomyService', () => {
  let service: TaxonomyService;
  let prisma: {
    category: { findUnique: jest.Mock; findMany: jest.Mock };
    categoryTranslation: { createMany: jest.Mock; upsert: jest.Mock };
    brand: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const bothLocales = (): UpsertCategoryDto['translations'] => [
    { locale: 'vi', name: 'Do choi giao duc', slug: 'do-choi-giao-duc' },
    { locale: 'en', name: 'Educational Toys', slug: 'educational-toys' },
  ];

  beforeEach(async () => {
    prisma = {
      category: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      categoryTranslation: { createMany: jest.fn(), upsert: jest.fn() },
      brand: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => unknown)(prisma);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };

    const module = await Test.createTestingModule({
      providers: [TaxonomyService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(TaxonomyService);
  });

  // -----------------------------------------------------------------
  // createCategory — assertBothLocales enforcement
  // -----------------------------------------------------------------
  describe('createCategory', () => {
    it('rejects a single-locale translations array (400 BOTH_LOCALES_REQUIRED)', async () => {
      const dto: UpsertCategoryDto = {
        translations: [{ locale: 'vi', name: 'Do choi', slug: 'do-choi' }],
      };
      await expect(service.createCategory(dto)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.createCategory(dto)).rejects.toMatchObject({
        message: 'BOTH_LOCALES_REQUIRED',
      });
    });

    it('rejects a duplicate-locale translations array (400 BOTH_LOCALES_REQUIRED)', async () => {
      const dto: UpsertCategoryDto = {
        translations: [
          { locale: 'vi', name: 'Do choi', slug: 'do-choi' },
          { locale: 'vi', name: 'Do choi 2', slug: 'do-choi-2' },
        ],
      };
      await expect(service.createCategory(dto)).rejects.toMatchObject({
        message: 'BOTH_LOCALES_REQUIRED',
      });
    });

    it('rejects a non-existent parentId (400 PARENT_NOT_FOUND) without touching the transaction', async () => {
      prisma.category.findUnique.mockResolvedValueOnce(null);
      const dto: UpsertCategoryDto = { parentId: 'missing-parent', translations: bothLocales() };
      await expect(service.createCategory(dto)).rejects.toMatchObject({
        message: 'PARENT_NOT_FOUND',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates a category with both locale rows when the DTO is valid', async () => {
      const createdRow = {
        id: 'cat-1',
        parentId: null,
        sortOrder: 0,
        isActive: true,
        translations: [
          { locale: 'VI', name: 'Do choi giao duc', slug: 'do-choi-giao-duc' },
          { locale: 'EN', name: 'Educational Toys', slug: 'educational-toys' },
        ],
      };
      prisma.category = {
        ...prisma.category,
        create: jest.fn().mockResolvedValue({ id: 'cat-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(createdRow),
      } as unknown as typeof prisma.category;

      const result = await service.createCategory({ translations: bothLocales() });
      expect(result.id).toBe('cat-1');
      expect(result.translations.vi.name).toBe('Do choi giao duc');
      expect(result.translations.en.name).toBe('Educational Toys');
      expect(prisma.categoryTranslation.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ locale: 'VI', slug: 'do-choi-giao-duc' }),
          expect.objectContaining({ locale: 'EN', slug: 'educational-toys' }),
        ],
      });
    });

    it('maps a P2002 during the transaction to ConflictException(SLUG_TAKEN)', async () => {
      prisma.$transaction.mockImplementationOnce(async () => {
        throw makeP2002('CategoryTranslation');
      });
      await expect(service.createCategory({ translations: bothLocales() })).rejects.toBeInstanceOf(
        ConflictException,
      );
      prisma.$transaction.mockImplementationOnce(async () => {
        throw makeP2002('CategoryTranslation');
      });
      await expect(service.createCategory({ translations: bothLocales() })).rejects.toMatchObject({
        message: 'SLUG_TAKEN',
      });
    });
  });

  // -----------------------------------------------------------------
  // updateCategory — self-parent rejection + partial-locale updates
  // -----------------------------------------------------------------
  describe('updateCategory', () => {
    beforeEach(() => {
      prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', parentId: null });
    });

    it('throws NotFoundException for an unknown category id', async () => {
      prisma.category.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.updateCategory('missing', {} as UpdateCategoryDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects parentId === id (400 CATEGORY_CANNOT_PARENT_ITSELF)', async () => {
      await expect(
        service.updateCategory('cat-1', { parentId: 'cat-1' } as UpdateCategoryDto),
      ).rejects.toMatchObject({ message: 'CATEGORY_CANNOT_PARENT_ITSELF' });
    });

    it('rejects a non-existent parentId (400 PARENT_NOT_FOUND)', async () => {
      prisma.category.findUnique.mockResolvedValueOnce({ id: 'cat-1', parentId: null }); // existing lookup
      prisma.category.findUnique.mockResolvedValueOnce(null); // parent lookup
      await expect(
        service.updateCategory('cat-1', { parentId: 'missing' } as UpdateCategoryDto),
      ).rejects.toMatchObject({ message: 'PARENT_NOT_FOUND' });
    });

    it('allows a single-locale partial translation update', async () => {
      const updatedRow = {
        id: 'cat-1',
        parentId: null,
        sortOrder: 0,
        isActive: true,
        translations: [
          { locale: 'VI', name: 'Ten moi', slug: 'do-choi-giao-duc' },
          { locale: 'EN', name: 'Educational Toys', slug: 'educational-toys' },
        ],
      };
      prisma.category = {
        ...prisma.category,
        update: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updatedRow),
      } as unknown as typeof prisma.category;

      const result = await service.updateCategory('cat-1', {
        translations: [{ locale: 'vi', name: 'Ten moi', slug: 'do-choi-giao-duc' }],
      } as UpdateCategoryDto);
      expect(result.translations.vi.name).toBe('Ten moi');
      expect(prisma.categoryTranslation.upsert).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------
  // Brands
  // -----------------------------------------------------------------
  describe('createBrand', () => {
    it('creates a brand', async () => {
      prisma.brand.create.mockResolvedValue({ id: 'brand-1', name: 'LEGO', originCountry: 'DK' });
      const dto: UpsertBrandDto = { name: 'LEGO', originCountry: 'DK' };
      const result = await service.createBrand(dto);
      expect(result).toEqual({ id: 'brand-1', name: 'LEGO', originCountry: 'DK' });
    });

    it('maps a P2002 on Brand.name to ConflictException(BRAND_NAME_TAKEN)', async () => {
      prisma.brand.create.mockRejectedValue(makeP2002('Brand'));
      await expect(service.createBrand({ name: 'LEGO' })).rejects.toMatchObject({
        message: 'BRAND_NAME_TAKEN',
      });
    });
  });

  describe('updateBrand', () => {
    it('throws NotFoundException for an unknown brand id', async () => {
      prisma.brand.findUnique.mockResolvedValueOnce(null);
      await expect(service.updateBrand('missing', { name: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('maps a P2002 on update to ConflictException(BRAND_NAME_TAKEN)', async () => {
      prisma.brand.findUnique.mockResolvedValueOnce({ id: 'brand-1' });
      prisma.brand.update.mockRejectedValue(makeP2002('Brand'));
      await expect(service.updateBrand('brand-1', { name: 'Taken' })).rejects.toMatchObject({
        message: 'BRAND_NAME_TAKEN',
      });
    });
  });

  // -----------------------------------------------------------------
  // Defensive P2003 mapping (race-condition safety net behind the
  // upfront existence check)
  // -----------------------------------------------------------------
  it('maps a P2003 raised inside the transaction to BadRequestException(PARENT_NOT_FOUND)', async () => {
    prisma.category.findUnique.mockResolvedValueOnce({ id: 'parent-1' });
    prisma.$transaction.mockImplementationOnce(async () => {
      throw makeP2003();
    });
    await expect(
      service.createCategory({ parentId: 'parent-1', translations: bothLocales() }),
    ).rejects.toMatchObject({ message: 'PARENT_NOT_FOUND' });
  });
});

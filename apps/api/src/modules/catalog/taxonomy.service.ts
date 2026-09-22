import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { BrandDto, CategoryDto } from '@kid-toy/shared-types';
import { Prisma } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { toBrandDto, toCategoryDto } from './catalog.mapper';
import { assertBothLocales } from './dto/upsert-translation.dto';
import type { UpdateBrandDto, UpsertBrandDto } from './dto/upsert-brand.dto';
import type { UpdateCategoryDto, UpsertCategoryDto } from './dto/upsert-category.dto';

/**
 * Category and brand management — CATALOG-09's write-path enforcement
 * point. Every category CREATE runs assertBothLocales first: both a `vi`
 * and an `en` translation row are written in the SAME transaction as the
 * category row, so a category can never exist with only one locale of
 * content (Pitfall 9 in PITFALLS.md).
 */
@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------------------------------------------
  // Categories
  // -----------------------------------------------------------------

  async createCategory(dto: UpsertCategoryDto): Promise<CategoryDto> {
    assertBothLocales(dto.translations);

    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: dto.parentId } });
      if (!parent) {
        throw new BadRequestException('PARENT_NOT_FOUND');
      }
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const category = await tx.category.create({
          data: {
            parentId: dto.parentId ?? null,
            sortOrder: dto.sortOrder ?? 0,
            isActive: dto.isActive ?? true,
          },
        });
        await tx.categoryTranslation.createMany({
          // CategoryTranslation has no `description` column (only
          // ProductTranslation does) — any description sent for a
          // category translation is accepted by the DTO but simply not
          // persisted here.
          data: dto.translations.map((t) => ({
            categoryId: category.id,
            locale: t.locale === 'vi' ? ('VI' as const) : ('EN' as const),
            name: t.name,
            slug: t.slug,
          })),
        });
        return tx.category.findUniqueOrThrow({
          where: { id: category.id },
          include: { translations: true },
        });
      });
      return toCategoryDto(created);
    } catch (err) {
      throw this.mapCategoryError(err);
    }
  }

  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<CategoryDto> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('CATEGORY_NOT_FOUND');
    }

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new BadRequestException('CATEGORY_CANNOT_PARENT_ITSELF');
      }
      const parent = await this.prisma.category.findUnique({ where: { id: dto.parentId } });
      if (!parent) {
        throw new BadRequestException('PARENT_NOT_FOUND');
      }
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.category.update({
          where: { id },
          data: {
            ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
            ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });

        for (const t of dto.translations ?? []) {
          const locale = t.locale === 'vi' ? ('VI' as const) : ('EN' as const);
          await tx.categoryTranslation.upsert({
            where: { categoryId_locale: { categoryId: id, locale } },
            update: { name: t.name, slug: t.slug },
            create: { categoryId: id, locale, name: t.name, slug: t.slug },
          });
        }

        return tx.category.findUniqueOrThrow({
          where: { id },
          include: { translations: true },
        });
      });
      return toCategoryDto(updated);
    } catch (err) {
      throw this.mapCategoryError(err);
    }
  }

  async listCategories(): Promise<CategoryDto[]> {
    const rows = await this.prisma.category.findMany({
      include: { translations: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toCategoryDto);
  }

  /**
   * The only unique constraint reachable inside createCategory/
   * updateCategory's transaction is CategoryTranslation's [locale, slug] —
   * Category itself has no user-supplied unique column — so any P2002 here
   * unambiguously means a per-locale slug collision.
   */
  private mapCategoryError(err: unknown): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return new ConflictException('SLUG_TAKEN');
      }
      if (err.code === 'P2003' || err.code === 'P2025') {
        return new BadRequestException('PARENT_NOT_FOUND');
      }
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  // -----------------------------------------------------------------
  // Brands
  // -----------------------------------------------------------------

  async createBrand(dto: UpsertBrandDto): Promise<BrandDto> {
    try {
      const brand = await this.prisma.brand.create({
        data: { name: dto.name, originCountry: dto.originCountry ?? null },
      });
      return toBrandDto(brand);
    } catch (err) {
      throw this.mapBrandError(err);
    }
  }

  async updateBrand(id: string, dto: UpdateBrandDto): Promise<BrandDto> {
    const existing = await this.prisma.brand.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('BRAND_NOT_FOUND');
    }
    try {
      const brand = await this.prisma.brand.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.originCountry !== undefined ? { originCountry: dto.originCountry } : {}),
        },
      });
      return toBrandDto(brand);
    } catch (err) {
      throw this.mapBrandError(err);
    }
  }

  async listBrands(): Promise<BrandDto[]> {
    const rows = await this.prisma.brand.findMany({ orderBy: { name: 'asc' } });
    return rows.map(toBrandDto);
  }

  private mapBrandError(err: unknown): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('BRAND_NAME_TAKEN');
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

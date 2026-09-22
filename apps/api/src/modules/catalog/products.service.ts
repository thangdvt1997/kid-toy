import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminProductDto, AdminVariantDto, CertificationDto } from '@kid-toy/shared-types';
import { Prisma } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { toAdminProductDto, toAdminVariantDto, toCertificationDto } from './catalog.mapper';
import { assertBothLocales } from './dto/upsert-translation.dto';
import type { ListProductsQuery, UpdateProductDto, UpsertProductDto } from './dto/upsert-product.dto';
import type { UpdateVariantDto, UpsertVariantDto } from './dto/upsert-variant.dto';
import type { UpsertCertificationDto } from './dto/upsert-certification.dto';

const PRODUCT_INCLUDE = {
  translations: true,
  variants: { include: { certifications: true } },
  media: true,
} as const;

/**
 * Product/variant/certification management (CATALOG-01, 03, 04, 05, and the
 * product half of CATALOG-09). All writes are structured-column, never
 * free-text — SKU/barcode/carton spec live on ProductVariant, safety certs
 * on their own table, facets as real Product columns Plan 06 filters on.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // -----------------------------------------------------------------
  // Products
  // -----------------------------------------------------------------

  async create(dto: UpsertProductDto): Promise<AdminProductDto> {
    assertBothLocales(dto.translations);
    if (dto.ageRangeMin > dto.ageRangeMax) {
      throw new BadRequestException('AGE_RANGE_INVALID');
    }

    const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
    if (!category) {
      throw new BadRequestException('CATEGORY_NOT_FOUND');
    }
    if (dto.brandId) {
      const brand = await this.prisma.brand.findUnique({ where: { id: dto.brandId } });
      if (!brand) {
        throw new BadRequestException('BRAND_NOT_FOUND');
      }
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            categoryId: dto.categoryId,
            brandId: dto.brandId ?? null,
            ageRangeMin: dto.ageRangeMin,
            ageRangeMax: dto.ageRangeMax,
            gender: dto.gender,
            origin: dto.origin,
            channelScope: dto.channelScope,
            isActive: dto.isActive ?? true,
          },
        });
        await tx.productTranslation.createMany({
          data: dto.translations.map((t) => ({
            productId: product.id,
            locale: t.locale === 'vi' ? ('VI' as const) : ('EN' as const),
            name: t.name,
            slug: t.slug,
            description: t.description ?? null,
          })),
        });
        return tx.product.findUniqueOrThrow({ where: { id: product.id }, include: PRODUCT_INCLUDE });
      });
      return toAdminProductDto(created, await this.buildMediaUrlMap(created.media));
    } catch (err) {
      throw this.mapProductError(err);
    }
  }

  async update(id: string, dto: UpdateProductDto): Promise<AdminProductDto> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('PRODUCT_NOT_FOUND');
    }

    const ageRangeMin = dto.ageRangeMin ?? existing.ageRangeMin;
    const ageRangeMax = dto.ageRangeMax ?? existing.ageRangeMax;
    if (ageRangeMin > ageRangeMax) {
      throw new BadRequestException('AGE_RANGE_INVALID');
    }

    if (dto.categoryId !== undefined) {
      const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!category) {
        throw new BadRequestException('CATEGORY_NOT_FOUND');
      }
    }
    if (dto.brandId !== undefined && dto.brandId !== null) {
      const brand = await this.prisma.brand.findUnique({ where: { id: dto.brandId } });
      if (!brand) {
        throw new BadRequestException('BRAND_NOT_FOUND');
      }
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data: {
            ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
            ...(dto.brandId !== undefined ? { brandId: dto.brandId } : {}),
            ...(dto.ageRangeMin !== undefined ? { ageRangeMin: dto.ageRangeMin } : {}),
            ...(dto.ageRangeMax !== undefined ? { ageRangeMax: dto.ageRangeMax } : {}),
            ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
            ...(dto.origin !== undefined ? { origin: dto.origin } : {}),
            ...(dto.channelScope !== undefined ? { channelScope: dto.channelScope } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });

        for (const t of dto.translations ?? []) {
          const locale = t.locale === 'vi' ? ('VI' as const) : ('EN' as const);
          await tx.productTranslation.upsert({
            where: { productId_locale: { productId: id, locale } },
            update: { name: t.name, slug: t.slug, description: t.description },
            create: {
              productId: id,
              locale,
              name: t.name,
              slug: t.slug,
              description: t.description,
            },
          });
        }

        return tx.product.findUniqueOrThrow({ where: { id }, include: PRODUCT_INCLUDE });
      });
      return toAdminProductDto(updated, await this.buildMediaUrlMap(updated.media));
    } catch (err) {
      throw this.mapProductError(err);
    }
  }

  async findOne(id: string): Promise<AdminProductDto> {
    const row = await this.prisma.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
    if (!row) {
      throw new NotFoundException('PRODUCT_NOT_FOUND');
    }
    return toAdminProductDto(row, await this.buildMediaUrlMap(row.media));
  }

  async list(query: ListProductsQuery): Promise<{ items: AdminProductDto[]; total: number }> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const where: Prisma.ProductWhereInput = query.search
      ? {
          translations: {
            some: { name: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
          },
        }
      : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    const items = await Promise.all(
      rows.map(async (row) => toAdminProductDto(row, await this.buildMediaUrlMap(row.media))),
    );
    return { items, total };
  }

  /** Soft delete only — Phase 3 order lines and Phase 5 shipment lines will reference products/variants. */
  async softDelete(id: string): Promise<void> {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('PRODUCT_NOT_FOUND');
    }
    await this.prisma.product.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * The only unique constraint reachable inside create/update's transaction
   * is ProductTranslation's [locale, slug] — categoryId/brandId are
   * validated explicitly before the transaction opens — so any P2002 here
   * unambiguously means a per-locale slug collision.
   */
  private mapProductError(err: unknown): Error {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException('SLUG_TAKEN');
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return new BadRequestException('CATEGORY_NOT_FOUND');
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  // -----------------------------------------------------------------
  // Variants
  // -----------------------------------------------------------------

  async createVariant(productId: string, dto: UpsertVariantDto): Promise<AdminVariantDto> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('PRODUCT_NOT_FOUND');
    }
    this.assertCartonMultiple(dto.unitsPerInnerBox, dto.unitsPerMasterCarton);

    try {
      const variant = await this.prisma.productVariant.create({
        data: {
          productId,
          sku: dto.sku,
          barcode: dto.barcode ?? null,
          variantLabel: dto.variantLabel ?? null,
          unitsPerInnerBox: dto.unitsPerInnerBox ?? null,
          unitsPerMasterCarton: dto.unitsPerMasterCarton ?? null,
          cartonLengthCm: dto.cartonLengthCm ?? null,
          cartonWidthCm: dto.cartonWidthCm ?? null,
          cartonHeightCm: dto.cartonHeightCm ?? null,
          cartonWeightKg: dto.cartonWeightKg ?? null,
          isActive: dto.isActive ?? true,
        },
        include: { certifications: true },
      });
      return toAdminVariantDto(variant);
    } catch (err) {
      throw await this.mapVariantError(err, dto.sku, dto.barcode);
    }
  }

  async updateVariant(variantId: string, dto: UpdateVariantDto): Promise<AdminVariantDto> {
    const existing = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!existing) {
      throw new NotFoundException('VARIANT_NOT_FOUND');
    }
    const innerBox = dto.unitsPerInnerBox ?? existing.unitsPerInnerBox ?? undefined;
    const masterCarton = dto.unitsPerMasterCarton ?? existing.unitsPerMasterCarton ?? undefined;
    this.assertCartonMultiple(innerBox, masterCarton);

    try {
      const variant = await this.prisma.productVariant.update({
        where: { id: variantId },
        data: {
          ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
          ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
          ...(dto.variantLabel !== undefined ? { variantLabel: dto.variantLabel } : {}),
          ...(dto.unitsPerInnerBox !== undefined ? { unitsPerInnerBox: dto.unitsPerInnerBox } : {}),
          ...(dto.unitsPerMasterCarton !== undefined
            ? { unitsPerMasterCarton: dto.unitsPerMasterCarton }
            : {}),
          ...(dto.cartonLengthCm !== undefined ? { cartonLengthCm: dto.cartonLengthCm } : {}),
          ...(dto.cartonWidthCm !== undefined ? { cartonWidthCm: dto.cartonWidthCm } : {}),
          ...(dto.cartonHeightCm !== undefined ? { cartonHeightCm: dto.cartonHeightCm } : {}),
          ...(dto.cartonWeightKg !== undefined ? { cartonWeightKg: dto.cartonWeightKg } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        include: { certifications: true },
      });
      return toAdminVariantDto(variant);
    } catch (err) {
      throw await this.mapVariantError(err, dto.sku, dto.barcode);
    }
  }

  private assertCartonMultiple(innerBox: number | undefined, masterCarton: number | undefined): void {
    if (innerBox !== undefined && masterCarton !== undefined && masterCarton < innerBox) {
      throw new BadRequestException('CARTON_MULTIPLE_INVALID');
    }
  }

  /**
   * sku and barcode are BOTH unique columns on ProductVariant, so Prisma
   * 7's P2002 meta.modelName ('ProductVariant' either way) cannot
   * disambiguate which one collided the way business-accounts.service.ts
   * disambiguates Account vs BusinessAccount (two DIFFERENT models). A
   * follow-up read against the exact values just submitted is a reliable,
   * DB-verified way to tell them apart without depending on undocumented
   * driver-adapter error-shape internals.
   */
  private async mapVariantError(err: unknown, sku?: string, barcode?: string): Promise<Error> {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      if (sku) {
        const skuTaken = await this.prisma.productVariant.findUnique({ where: { sku } });
        if (skuTaken) {
          return new ConflictException('SKU_TAKEN');
        }
      }
      if (barcode) {
        const barcodeTaken = await this.prisma.productVariant.findUnique({ where: { barcode } });
        if (barcodeTaken) {
          return new ConflictException('BARCODE_TAKEN');
        }
      }
      return new ConflictException('SKU_OR_BARCODE_TAKEN');
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  // -----------------------------------------------------------------
  // Certifications
  // -----------------------------------------------------------------

  async createCertification(
    variantId: string,
    dto: UpsertCertificationDto,
  ): Promise<CertificationDto> {
    const variant = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) {
      throw new NotFoundException('VARIANT_NOT_FOUND');
    }
    const validFrom = new Date(dto.validFrom);
    const validTo = new Date(dto.validTo);
    if (validTo.getTime() <= validFrom.getTime()) {
      throw new BadRequestException('CERT_VALIDITY_INVALID');
    }

    const cert = await this.prisma.safetyCertification.create({
      data: {
        variantId,
        certNumber: dto.certNumber,
        issuingBody: dto.issuingBody,
        validFrom,
        validTo,
        batchLabel: dto.batchLabel ?? null,
      },
    });
    return toCertificationDto(cert);
  }

  async deleteCertification(certId: string): Promise<void> {
    const existing = await this.prisma.safetyCertification.findUnique({ where: { id: certId } });
    if (!existing) {
      throw new NotFoundException('CERTIFICATION_NOT_FOUND');
    }
    await this.prisma.safetyCertification.delete({ where: { id: certId } });
  }

  // -----------------------------------------------------------------
  // Media URL resolution (forward-compatible with Task 3 — MediaService
  // populates product_media rows, this method just resolves whatever
  // exists at query time; kept here so Task 3 never has to touch this
  // file to make product reads return real presigned URLs)
  // -----------------------------------------------------------------

  private async buildMediaUrlMap(
    mediaRows: { id: string; objectKey: string }[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    await Promise.all(
      mediaRows.map(async (m) => {
        map.set(m.id, await this.storage.getPresignedUrl(this.storage.bucketMedia, m.objectKey, 900));
      }),
    );
    return map;
  }
}

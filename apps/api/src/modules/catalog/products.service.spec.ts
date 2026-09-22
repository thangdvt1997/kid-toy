import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ProductsService } from './products.service';
import type { UpsertProductDto } from './dto/upsert-product.dto';
import type { UpsertVariantDto } from './dto/upsert-variant.dto';
import type { UpsertCertificationDto } from './dto/upsert-certification.dto';

function makeP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
    meta: { modelName: 'ProductTranslation' },
  });
}

function makeVariantP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.10.0',
    meta: { modelName: 'ProductVariant' },
  });
}

const bothLocales = (): UpsertProductDto['translations'] => [
  { locale: 'vi', name: 'San pham', slug: 'san-pham' },
  { locale: 'en', name: 'Product', slug: 'product' },
];

const baseProductDto = (): UpsertProductDto => ({
  categoryId: 'cat-1',
  ageRangeMin: 3,
  ageRangeMax: 6,
  gender: 'UNISEX',
  origin: 'VN',
  channelScope: 'BOTH',
  translations: bothLocales(),
});

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: {
    category: { findUnique: jest.Mock };
    brand: { findUnique: jest.Mock };
    product: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    productTranslation: { createMany: jest.Mock; upsert: jest.Mock };
    productVariant: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    safetyCertification: { findUnique: jest.Mock; create: jest.Mock; delete: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: { bucketMedia: string; getPresignedUrl: jest.Mock };

  beforeEach(async () => {
    prisma = {
      category: { findUnique: jest.fn().mockResolvedValue({ id: 'cat-1' }) },
      brand: { findUnique: jest.fn().mockResolvedValue({ id: 'brand-1' }) },
      product: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
      },
      productTranslation: { createMany: jest.fn(), upsert: jest.fn() },
      productVariant: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      safetyCertification: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => unknown)(prisma);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };
    storage = {
      bucketMedia: 'kidtoy-media',
      getPresignedUrl: jest.fn().mockResolvedValue('https://minio.local/x?X-Amz-Signature=abc'),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get(ProductsService);
  });

  // -----------------------------------------------------------------
  // create()
  // -----------------------------------------------------------------
  describe('create', () => {
    it('rejects ageRangeMin > ageRangeMax (400 AGE_RANGE_INVALID)', async () => {
      const dto = { ...baseProductDto(), ageRangeMin: 10, ageRangeMax: 5 };
      await expect(service.create(dto)).rejects.toMatchObject({ message: 'AGE_RANGE_INVALID' });
      expect(prisma.category.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a non-existent categoryId (400 CATEGORY_NOT_FOUND)', async () => {
      prisma.category.findUnique.mockResolvedValueOnce(null);
      await expect(service.create(baseProductDto())).rejects.toMatchObject({
        message: 'CATEGORY_NOT_FOUND',
      });
    });

    it('rejects a non-existent brandId (400 BRAND_NOT_FOUND)', async () => {
      prisma.brand.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.create({ ...baseProductDto(), brandId: 'missing-brand' }),
      ).rejects.toMatchObject({ message: 'BRAND_NOT_FOUND' });
    });

    it('rejects a single-locale translations array (400 BOTH_LOCALES_REQUIRED)', async () => {
      const dto = {
        ...baseProductDto(),
        translations: [{ locale: 'vi' as const, name: 'X', slug: 'x' }],
      };
      await expect(service.create(dto)).rejects.toMatchObject({
        message: 'BOTH_LOCALES_REQUIRED',
      });
    });

    it('creates a product with both translation rows', async () => {
      const createdRow = {
        id: 'prod-1',
        categoryId: 'cat-1',
        brandId: null,
        ageRangeMin: 3,
        ageRangeMax: 6,
        gender: 'UNISEX',
        origin: 'VN',
        channelScope: 'BOTH',
        isActive: true,
        translations: [
          { locale: 'VI', name: 'San pham', slug: 'san-pham', description: null },
          { locale: 'EN', name: 'Product', slug: 'product', description: null },
        ],
        variants: [],
        media: [],
      };
      prisma.product = {
        ...prisma.product,
        create: jest.fn().mockResolvedValue({ id: 'prod-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(createdRow),
      } as unknown as typeof prisma.product;

      const result = await service.create(baseProductDto());
      expect(result.id).toBe('prod-1');
      expect(result.translations.vi.name).toBe('San pham');
      expect(result.translations.en.name).toBe('Product');
    });

    it('maps a P2002 during the transaction to ConflictException(SLUG_TAKEN)', async () => {
      prisma.$transaction.mockImplementationOnce(async () => {
        throw makeP2002();
      });
      await expect(service.create(baseProductDto())).rejects.toBeInstanceOf(ConflictException);
      prisma.$transaction.mockImplementationOnce(async () => {
        throw makeP2002();
      });
      await expect(service.create(baseProductDto())).rejects.toMatchObject({
        message: 'SLUG_TAKEN',
      });
    });
  });

  // -----------------------------------------------------------------
  // update()
  // -----------------------------------------------------------------
  describe('update', () => {
    it('throws NotFoundException for an unknown product id', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(null);
      await expect(service.update('missing', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an update that would make ageRangeMin > ageRangeMax', async () => {
      prisma.product.findUnique.mockResolvedValueOnce({
        id: 'prod-1',
        ageRangeMin: 3,
        ageRangeMax: 6,
      });
      await expect(service.update('prod-1', { ageRangeMin: 10 })).rejects.toMatchObject({
        message: 'AGE_RANGE_INVALID',
      });
    });
  });

  // -----------------------------------------------------------------
  // softDelete()
  // -----------------------------------------------------------------
  describe('softDelete', () => {
    it('throws NotFoundException for an unknown product id', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(null);
      await expect(service.softDelete('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sets isActive = false (never a hard delete)', async () => {
      prisma.product.findUnique.mockResolvedValueOnce({ id: 'prod-1' });
      await service.softDelete('prod-1');
      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { isActive: false },
      });
    });
  });

  // -----------------------------------------------------------------
  // createVariant() / updateVariant()
  // -----------------------------------------------------------------
  describe('createVariant', () => {
    const variantDto = (overrides: Partial<UpsertVariantDto> = {}): UpsertVariantDto => ({
      sku: 'KT-TEST-001',
      ...overrides,
    });

    it('throws NotFoundException for a non-existent product', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(null);
      await expect(service.createVariant('missing', variantDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects unitsPerMasterCarton < unitsPerInnerBox (400 CARTON_MULTIPLE_INVALID)', async () => {
      prisma.product.findUnique.mockResolvedValueOnce({ id: 'prod-1' });
      await expect(
        service.createVariant(
          'prod-1',
          variantDto({ unitsPerInnerBox: 12, unitsPerMasterCarton: 6 }),
        ),
      ).rejects.toMatchObject({ message: 'CARTON_MULTIPLE_INVALID' });
    });

    it('creates a variant and round-trips every carton field', async () => {
      prisma.product.findUnique.mockResolvedValueOnce({ id: 'prod-1' });
      const dto = variantDto({
        barcode: '8938500000099',
        unitsPerInnerBox: 6,
        unitsPerMasterCarton: 24,
        cartonLengthCm: 40,
        cartonWidthCm: 30,
        cartonHeightCm: 20,
        cartonWeightKg: 5.5,
      });
      prisma.productVariant.create.mockResolvedValue({
        id: 'var-1',
        sku: dto.sku,
        barcode: dto.barcode,
        variantLabel: null,
        unitsPerInnerBox: dto.unitsPerInnerBox,
        unitsPerMasterCarton: dto.unitsPerMasterCarton,
        cartonLengthCm: dto.cartonLengthCm,
        cartonWidthCm: dto.cartonWidthCm,
        cartonHeightCm: dto.cartonHeightCm,
        cartonWeightKg: dto.cartonWeightKg,
        isActive: true,
        certifications: [],
      });

      const result = await service.createVariant('prod-1', dto);
      expect(result.unitsPerInnerBox).toBe(6);
      expect(result.unitsPerMasterCarton).toBe(24);
      expect(result.cartonLengthCm).toBe(40);
      expect(result.cartonWidthCm).toBe(30);
      expect(result.cartonHeightCm).toBe(20);
      expect(result.cartonWeightKg).toBe(5.5);
    });

    it('maps a P2002 to SKU_TAKEN when a matching sku already exists', async () => {
      prisma.product.findUnique.mockResolvedValueOnce({ id: 'prod-1' });
      prisma.productVariant.create.mockRejectedValue(makeVariantP2002());
      prisma.productVariant.findUnique.mockImplementation(
        async ({ where }: { where: { sku?: string; barcode?: string } }) =>
          where.sku === 'KT-TEST-001' ? { id: 'existing' } : null,
      );
      await expect(
        service.createVariant('prod-1', variantDto({ sku: 'KT-TEST-001' })),
      ).rejects.toMatchObject({ message: 'SKU_TAKEN' });
    });

    it('maps a P2002 to BARCODE_TAKEN when the sku is free but the barcode collides', async () => {
      prisma.product.findUnique.mockResolvedValueOnce({ id: 'prod-1' });
      prisma.productVariant.create.mockRejectedValue(makeVariantP2002());
      prisma.productVariant.findUnique.mockImplementation(
        async ({ where }: { where: { sku?: string; barcode?: string } }) =>
          where.barcode === '8938500000099' ? { id: 'existing' } : null,
      );
      await expect(
        service.createVariant('prod-1', variantDto({ barcode: '8938500000099' })),
      ).rejects.toMatchObject({ message: 'BARCODE_TAKEN' });
    });
  });

  // -----------------------------------------------------------------
  // createCertification()
  // -----------------------------------------------------------------
  describe('createCertification', () => {
    const certDto = (overrides: Partial<UpsertCertificationDto> = {}): UpsertCertificationDto => ({
      certNumber: 'QCVN3:2019/BKHCN-0001',
      issuingBody: 'QUATEST 3',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2028-01-01T00:00:00.000Z',
      ...overrides,
    });

    it('throws NotFoundException for a non-existent variant', async () => {
      prisma.productVariant.findUnique.mockResolvedValueOnce(null);
      await expect(service.createCertification('missing', certDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects validTo <= validFrom (400 CERT_VALIDITY_INVALID)', async () => {
      prisma.productVariant.findUnique.mockResolvedValueOnce({ id: 'var-1' });
      await expect(
        service.createCertification(
          'var-1',
          certDto({ validFrom: '2028-01-01T00:00:00.000Z', validTo: '2026-01-01T00:00:00.000Z' }),
        ),
      ).rejects.toMatchObject({ message: 'CERT_VALIDITY_INVALID' });
    });

    it('creates a certification', async () => {
      prisma.productVariant.findUnique.mockResolvedValueOnce({ id: 'var-1' });
      prisma.safetyCertification.create.mockResolvedValue({
        id: 'cert-1',
        certNumber: 'QCVN3:2019/BKHCN-0001',
        issuingBody: 'QUATEST 3',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validTo: new Date('2028-01-01T00:00:00.000Z'),
        batchLabel: null,
      });
      const result = await service.createCertification('var-1', certDto());
      expect(result.certNumber).toBe('QCVN3:2019/BKHCN-0001');
    });
  });

  describe('deleteCertification', () => {
    it('throws NotFoundException for an unknown certification id', async () => {
      prisma.safetyCertification.findUnique.mockResolvedValueOnce(null);
      await expect(service.deleteCertification('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

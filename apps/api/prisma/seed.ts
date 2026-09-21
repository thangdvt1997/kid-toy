/**
 * Idempotent seed — every write is an upsert keyed on a natural unique
 * field (email, code, sku, taxId, name, or a schema-enforced compound
 * unique) or, where the model has no natural business key (Category,
 * Product, SafetyCertification), a deterministic hardcoded `id` upserted
 * by id. Re-running this script must not duplicate rows and must not
 * error — see Task 3 acceptance criteria in 01-02-PLAN.md.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

// Mirrors prisma.config.ts / config.module.ts — this script always runs
// with apps/api as the working directory (`ts-node prisma/seed.ts`).
config({ path: resolve(process.cwd(), '../../.env') });
config();

import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const BCRYPT_COST = Number.parseInt(process.env.BCRYPT_COST ?? '12', 10);

/** Rounds to the nearest 500 VND — keeps seeded prices human-round. */
function roundVnd(n: number): bigint {
  return BigInt(Math.round(n / 500) * 500);
}

function tierPrices(retail: number) {
  return {
    retail: roundVnd(retail),
    dealerA1: roundVnd(retail * 0.75), // ~25% below retail
    dealerA12: roundVnd(retail * 0.65), // ~35% below retail (quantity break)
    dealerB1: roundVnd(retail * 0.7), // ~30% below retail
  };
}

/**
 * Reusable seed logic — used both by the CLI entrypoint below (`tsx
 * prisma/seed.ts`) and by `apps/api/test/utils/test-app.ts`'s
 * `resetAndSeed()`, which seeds the isolated `kidtoy_test` database before
 * each e2e run against a shared `PrismaService` instance.
 */
export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  // Never hardcode a password literal in this file — the seed must fail
  // loudly instead of silently creating a predictable backdoor credential.
  const SEED_DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD;
  if (!SEED_DEFAULT_PASSWORD) {
    throw new Error(
      'SEED_DEFAULT_PASSWORD is required to run the seed (set it in .env — see .env.example).',
    );
  }
  const passwordHash = await bcrypt.hash(SEED_DEFAULT_PASSWORD, BCRYPT_COST);

  // ---------------------------------------------------------------------
  // 1. Price tiers
  // ---------------------------------------------------------------------
  const [retailTier, dealerATier, dealerBTier] = await Promise.all([
    prisma.priceTier.upsert({
      where: { code: 'RETAIL' },
      update: { name: 'Giá lẻ', isDefault: true },
      create: { code: 'RETAIL', name: 'Giá lẻ', isDefault: true },
    }),
    prisma.priceTier.upsert({
      where: { code: 'DEALER_A' },
      update: { name: 'Đại lý cấp A', isDefault: false },
      create: { code: 'DEALER_A', name: 'Đại lý cấp A', isDefault: false },
    }),
    prisma.priceTier.upsert({
      where: { code: 'DEALER_B' },
      update: { name: 'Đại lý cấp B', isDefault: false },
      create: { code: 'DEALER_B', name: 'Đại lý cấp B', isDefault: false },
    }),
  ]);

  // ---------------------------------------------------------------------
  // 2. Staff accounts + profiles
  // ---------------------------------------------------------------------
  const staffSeeds = [
    { email: 'admin@kidtoy.local', role: 'SUPER_ADMIN' as const, fullName: 'Quản trị hệ thống' },
    { email: 'sales@kidtoy.local', role: 'SALES' as const, fullName: 'Nhân viên kinh doanh' },
    { email: 'warehouse@kidtoy.local', role: 'WAREHOUSE' as const, fullName: 'Nhân viên kho' },
    { email: 'content@kidtoy.local', role: 'CONTENT' as const, fullName: 'Biên tập nội dung' },
  ];
  for (const staff of staffSeeds) {
    const account = await prisma.account.upsert({
      where: { email: staff.email },
      update: { passwordHash, type: 'STAFF', isActive: true },
      create: { email: staff.email, passwordHash, type: 'STAFF', isActive: true },
    });
    await prisma.staffProfile.upsert({
      where: { accountId: account.id },
      update: { fullName: staff.fullName, role: staff.role },
      create: { accountId: account.id, fullName: staff.fullName, role: staff.role },
    });
  }

  // ---------------------------------------------------------------------
  // 3. Retail customer
  // ---------------------------------------------------------------------
  const customerAccount = await prisma.account.upsert({
    where: { email: 'customer@kidtoy.local' },
    update: { passwordHash, type: 'RETAIL_CUSTOMER', isActive: true },
    create: {
      email: 'customer@kidtoy.local',
      passwordHash,
      type: 'RETAIL_CUSTOMER',
      isActive: true,
    },
  });
  await prisma.customerProfile.upsert({
    where: { accountId: customerAccount.id },
    update: { fullName: 'Khách lẻ mẫu', phone: '0900000001' },
    create: { accountId: customerAccount.id, fullName: 'Khách lẻ mẫu', phone: '0900000001' },
  });

  // ---------------------------------------------------------------------
  // 4. Business accounts (one APPROVED, one PENDING)
  // ---------------------------------------------------------------------
  const dealerAccount = await prisma.account.upsert({
    where: { email: 'dealer@kidtoy.local' },
    update: { passwordHash, type: 'BUSINESS_ACCOUNT', isActive: true },
    create: { email: 'dealer@kidtoy.local', passwordHash, type: 'BUSINESS_ACCOUNT', isActive: true },
  });
  await prisma.businessAccount.upsert({
    where: { accountId: dealerAccount.id },
    update: {
      companyName: 'Cửa hàng Đồ Chơi Mẫu',
      taxId: '0101010101',
      businessType: 'RETAIL_STORE',
      approvalStatus: 'APPROVED',
      priceTierId: dealerATier.id,
    },
    create: {
      accountId: dealerAccount.id,
      companyName: 'Cửa hàng Đồ Chơi Mẫu',
      taxId: '0101010101',
      businessType: 'RETAIL_STORE',
      approvalStatus: 'APPROVED',
      priceTierId: dealerATier.id,
    },
  });

  const pendingDealerAccount = await prisma.account.upsert({
    where: { email: 'pending-dealer@kidtoy.local' },
    update: { passwordHash, type: 'BUSINESS_ACCOUNT', isActive: true },
    create: {
      email: 'pending-dealer@kidtoy.local',
      passwordHash,
      type: 'BUSINESS_ACCOUNT',
      isActive: true,
    },
  });
  await prisma.businessAccount.upsert({
    where: { accountId: pendingDealerAccount.id },
    update: {
      companyName: 'Trường Mầm Non Mẫu',
      taxId: '0202020202',
      businessType: 'SCHOOL',
      approvalStatus: 'PENDING',
      priceTierId: null,
    },
    create: {
      accountId: pendingDealerAccount.id,
      companyName: 'Trường Mầm Non Mẫu',
      taxId: '0202020202',
      businessType: 'SCHOOL',
      approvalStatus: 'PENDING',
      priceTierId: null,
    },
  });

  // ---------------------------------------------------------------------
  // 5. Brands
  // ---------------------------------------------------------------------
  const [lego, fisherPrice, antona] = await Promise.all([
    prisma.brand.upsert({
      where: { name: 'LEGO' },
      update: { originCountry: 'DK' },
      create: { name: 'LEGO', originCountry: 'DK' },
    }),
    prisma.brand.upsert({
      where: { name: 'Fisher-Price' },
      update: { originCountry: 'US' },
      create: { name: 'Fisher-Price', originCountry: 'US' },
    }),
    prisma.brand.upsert({
      where: { name: 'Antona' },
      update: { originCountry: 'VN' },
      create: { name: 'Antona', originCountry: 'VN' },
    }),
  ]);

  // ---------------------------------------------------------------------
  // 6. Categories (deterministic ids — no other natural key on Category)
  // ---------------------------------------------------------------------
  async function upsertCategory(
    id: string,
    vi: { name: string; slug: string },
    en: { name: string; slug: string },
  ) {
    const category = await prisma.category.upsert({
      where: { id },
      update: {},
      create: { id },
    });
    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: category.id, locale: 'VI' } },
      update: { name: vi.name, slug: vi.slug },
      create: { categoryId: category.id, locale: 'VI', name: vi.name, slug: vi.slug },
    });
    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: category.id, locale: 'EN' } },
      update: { name: en.name, slug: en.slug },
      create: { categoryId: category.id, locale: 'EN', name: en.name, slug: en.slug },
    });
    return category;
  }

  const catEducational = await upsertCategory(
    'cat-educational-toys',
    { name: 'Đồ chơi giáo dục', slug: 'do-choi-giao-duc' },
    { name: 'Educational Toys', slug: 'educational-toys' },
  );
  const catVehicles = await upsertCategory(
    'cat-model-vehicles',
    { name: 'Xe mô hình', slug: 'xe-mo-hinh' },
    { name: 'Model Vehicles', slug: 'model-vehicles' },
  );
  const catBaby = await upsertCategory(
    'cat-baby-toys',
    { name: 'Đồ chơi sơ sinh', slug: 'do-choi-so-sinh' },
    { name: 'Baby Toys', slug: 'baby-toys' },
  );

  // ---------------------------------------------------------------------
  // 7. Products (deterministic ids — no other natural key on Product)
  // ---------------------------------------------------------------------
  async function upsertProduct(
    id: string,
    data: {
      brandId: string;
      categoryId: string;
      ageRangeMin: number;
      ageRangeMax: number;
      gender: 'BOY' | 'GIRL' | 'UNISEX';
      origin: string;
      channelScope: 'RETAIL_ONLY' | 'WHOLESALE_ONLY' | 'BOTH';
    },
    vi: { name: string; slug: string; description: string },
    en: { name: string; slug: string; description: string },
  ) {
    const product = await prisma.product.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
    await prisma.productTranslation.upsert({
      where: { productId_locale: { productId: product.id, locale: 'VI' } },
      update: vi,
      create: { productId: product.id, locale: 'VI', ...vi },
    });
    await prisma.productTranslation.upsert({
      where: { productId_locale: { productId: product.id, locale: 'EN' } },
      update: en,
      create: { productId: product.id, locale: 'EN', ...en },
    });
    return product;
  }

  const p1 = await upsertProduct(
    'product-kt-edu',
    {
      brandId: lego.id,
      categoryId: catEducational.id,
      ageRangeMin: 6,
      ageRangeMax: 12,
      gender: 'UNISEX',
      origin: 'DK',
      channelScope: 'BOTH',
    },
    {
      name: 'Bộ Lego Sáng Tạo Giáo Dục',
      slug: 'bo-lego-sang-tao-giao-duc',
      description: 'Bộ xếp hình LEGO giúp trẻ phát triển tư duy sáng tạo và giáo dục sớm.',
    },
    {
      name: 'LEGO Educational Creative Set',
      slug: 'lego-educational-creative-set',
      description: 'A LEGO building set that develops creative thinking and early education skills.',
    },
  );

  const p2 = await upsertProduct(
    'product-kt-veh',
    {
      brandId: fisherPrice.id,
      categoryId: catVehicles.id,
      ageRangeMin: 3,
      ageRangeMax: 8,
      gender: 'BOY',
      origin: 'US',
      channelScope: 'BOTH',
    },
    {
      name: 'Xe Mô Hình Fisher-Price',
      slug: 'xe-mo-hinh-fisher-price',
      description: 'Xe mô hình đồ chơi Fisher-Price bền, an toàn, dành cho bé trai.',
    },
    {
      name: 'Fisher-Price Model Vehicle',
      slug: 'fisher-price-model-vehicle',
      description: 'A durable, safe Fisher-Price toy vehicle designed for boys.',
    },
  );

  const p3 = await upsertProduct(
    'product-kt-baby',
    {
      brandId: antona.id,
      categoryId: catBaby.id,
      ageRangeMin: 0,
      ageRangeMax: 3,
      gender: 'GIRL',
      origin: 'VN',
      channelScope: 'WHOLESALE_ONLY',
    },
    {
      name: 'Đồ Chơi Sơ Sinh Antona',
      slug: 'do-choi-so-sinh-antona',
      description: 'Đồ chơi sơ sinh Antona chất liệu an toàn, phù hợp bé gái từ 0-3 tuổi.',
    },
    {
      name: 'Antona Baby Toy',
      slug: 'antona-baby-toy',
      description: 'An Antona baby toy made of safe materials, suitable for girls aged 0-3.',
    },
  );

  // ---------------------------------------------------------------------
  // 8-9-10-11. Variants + certifications + prices + stock
  // ---------------------------------------------------------------------
  interface VariantSeed {
    sku: string;
    barcode: string;
    productId: string;
    variantLabel: string;
    cartonLengthCm: string;
    cartonWidthCm: string;
    cartonHeightCm: string;
    cartonWeightKg: string;
    retailPrice: number;
    stock: { quantityOnHand: number; reorderThreshold: number };
  }

  const variantSeeds: VariantSeed[] = [
    {
      sku: 'KT-EDU-001',
      barcode: '8938500000011',
      productId: p1.id,
      variantLabel: 'Hộp 100 chi tiết',
      cartonLengthCm: '40.00',
      cartonWidthCm: '30.00',
      cartonHeightCm: '20.00',
      cartonWeightKg: '5.500',
      retailPrice: 450000,
      stock: { quantityOnHand: 120, reorderThreshold: 10 }, // IN_STOCK
    },
    {
      sku: 'KT-EDU-002',
      barcode: '8938500000012',
      productId: p1.id,
      variantLabel: 'Hộp 250 chi tiết',
      cartonLengthCm: '45.00',
      cartonWidthCm: '35.00',
      cartonHeightCm: '22.00',
      cartonWeightKg: '7.200',
      retailPrice: 590000,
      stock: { quantityOnHand: 5, reorderThreshold: 10 }, // LOW_STOCK
    },
    {
      sku: 'KT-VEH-001',
      barcode: '8938500000021',
      productId: p2.id,
      variantLabel: 'Xe mô hình cỡ trung',
      cartonLengthCm: '38.00',
      cartonWidthCm: '28.00',
      cartonHeightCm: '18.00',
      cartonWeightKg: '4.800',
      retailPrice: 320000,
      stock: { quantityOnHand: 0, reorderThreshold: 10 }, // OUT_OF_STOCK
    },
    {
      sku: 'KT-BABY-001',
      barcode: '8938500000031',
      productId: p3.id,
      variantLabel: 'Set sơ sinh cơ bản',
      cartonLengthCm: '32.00',
      cartonWidthCm: '24.00',
      cartonHeightCm: '16.00',
      cartonWeightKg: '3.100',
      retailPrice: 250000,
      stock: { quantityOnHand: 60, reorderThreshold: 20 },
    },
  ];

  let certCounter = 1;
  let priceListEntryCount = 0;

  for (const v of variantSeeds) {
    const variant = await prisma.productVariant.upsert({
      where: { sku: v.sku },
      update: {
        barcode: v.barcode,
        productId: v.productId,
        variantLabel: v.variantLabel,
        unitsPerInnerBox: 6,
        unitsPerMasterCarton: 24,
        cartonLengthCm: v.cartonLengthCm,
        cartonWidthCm: v.cartonWidthCm,
        cartonHeightCm: v.cartonHeightCm,
        cartonWeightKg: v.cartonWeightKg,
        isActive: true,
      },
      create: {
        sku: v.sku,
        barcode: v.barcode,
        productId: v.productId,
        variantLabel: v.variantLabel,
        unitsPerInnerBox: 6,
        unitsPerMasterCarton: 24,
        cartonLengthCm: v.cartonLengthCm,
        cartonWidthCm: v.cartonWidthCm,
        cartonHeightCm: v.cartonHeightCm,
        cartonWeightKg: v.cartonWeightKg,
        isActive: true,
      },
    });

    // Safety certification — one per variant, deterministic id
    const certId = `cert-${v.sku}`;
    const certNumber = `QCVN3:2019/BKHCN-${String(certCounter).padStart(4, '0')}`;
    certCounter += 1;
    await prisma.safetyCertification.upsert({
      where: { id: certId },
      update: {
        variantId: variant.id,
        certNumber,
        issuingBody: 'QUATEST 3',
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validTo: new Date('2028-01-01T00:00:00Z'),
      },
      create: {
        id: certId,
        variantId: variant.id,
        certNumber,
        issuingBody: 'QUATEST 3',
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validTo: new Date('2028-01-01T00:00:00Z'),
      },
    });

    // Price list entries — RETAIL@1, DEALER_A@1, DEALER_A@12, DEALER_B@1
    const prices = tierPrices(v.retailPrice);
    const entries: { tierId: string; minQty: number; unitPriceVnd: bigint }[] = [
      { tierId: retailTier.id, minQty: 1, unitPriceVnd: prices.retail },
      { tierId: dealerATier.id, minQty: 1, unitPriceVnd: prices.dealerA1 },
      { tierId: dealerATier.id, minQty: 12, unitPriceVnd: prices.dealerA12 },
      { tierId: dealerBTier.id, minQty: 1, unitPriceVnd: prices.dealerB1 },
    ];
    for (const entry of entries) {
      await prisma.priceListEntry.upsert({
        where: {
          variantId_tierId_minQty: {
            variantId: variant.id,
            tierId: entry.tierId,
            minQty: entry.minQty,
          },
        },
        update: { unitPriceVnd: entry.unitPriceVnd },
        create: {
          variantId: variant.id,
          tierId: entry.tierId,
          minQty: entry.minQty,
          unitPriceVnd: entry.unitPriceVnd,
        },
      });
      priceListEntryCount += 1;
    }

    // Stock
    await prisma.variantStock.upsert({
      where: { variantId: variant.id },
      update: v.stock,
      create: { variantId: variant.id, ...v.stock },
    });
  }

  // ---------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------
  const [
    tierCount,
    accountCount,
    productCount,
    translationCount,
    variantCount,
    priceEntryTotal,
    stockCount,
  ] = await Promise.all([
    prisma.priceTier.count(),
    prisma.account.count(),
    prisma.product.count(),
    prisma.productTranslation.count(),
    prisma.productVariant.count(),
    prisma.priceListEntry.count(),
    prisma.variantStock.count(),
  ]);

  console.log('Seed complete:');
  console.log(`  price_tiers: ${tierCount}`);
  console.log(`  accounts: ${accountCount}`);
  console.log(`  products: ${productCount}`);
  console.log(`  product_translations: ${translationCount}`);
  console.log(`  product_variants: ${variantCount}`);
  console.log(`  price_list_entries: ${priceEntryTotal} (${priceListEntryCount} upserted this run)`);
  console.log(`  variant_stock: ${stockCount}`);
}

// CLI entrypoint — only runs when this file is executed directly
// (`tsx prisma/seed.ts` / `pnpm --filter api run db:seed`), not when
// `seedDatabase` is imported programmatically by test infra.
if (require.main === module) {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run the seed.');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL }),
  });

  seedDatabase(prisma)
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

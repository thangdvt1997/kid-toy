import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, resetAndSeed, uniqueEmail } from './utils/test-app';
import type { PrismaService } from '../src/prisma/prisma.service';

const SEED_PASSWORD = process.env.SEED_DEFAULT_PASSWORD as string;
const STRONG_PASSWORD = 'Str0ng-Passw0rd!';

function decodeJwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1];
  if (!segment) {
    throw new Error('Malformed JWT: missing payload segment');
  }
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

/** A tiny buffer whose first bytes match the PDF magic number (%PDF). */
function pdfBuffer(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF');
}

/** First bytes match the PNG magic number signature. */
function pngBuffer(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 0),
  ]);
}

/** Not a PDF/JPEG/PNG at all — DOS/PE executable magic number (MZ). */
function exeBuffer(): Buffer {
  return Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(64, 0)]);
}

describe('Business Accounts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: App;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    server = app.getHttpServer() as App;
    await resetAndSeed(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function loginAs(email: string, password = SEED_PASSWORD): Promise<string> {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  async function registerBusiness(overrides: {
    email?: string;
    taxId?: string;
    companyName?: string;
    businessType?: 'RETAIL_STORE' | 'SCHOOL' | 'DISTRIBUTOR';
    fileBuffer?: Buffer;
    fileName?: string;
    fileContentType?: string;
    skipFile?: boolean;
  }) {
    const req = request(server)
      .post('/api/business-accounts/register')
      .field('email', overrides.email ?? uniqueEmail('biz'))
      .field('password', STRONG_PASSWORD)
      .field('companyName', overrides.companyName ?? 'Cua Hang Do Choi Test')
      .field('taxId', overrides.taxId ?? `09${Date.now().toString().slice(-8)}`)
      .field('businessType', overrides.businessType ?? 'RETAIL_STORE');

    if (!overrides.skipFile) {
      req.attach(
        'licence',
        overrides.fileBuffer ?? pdfBuffer(),
        overrides.fileName ?? 'licence.pdf',
      );
    }
    return req;
  }

  // -------------------------------------------------------------------
  // AUTH-03: B2B registration
  // -------------------------------------------------------------------
  describe('POST /api/business-accounts/register', () => {
    it('1. registers with a valid PDF licence and lands PENDING', async () => {
      const email = uniqueEmail('biz-pdf');
      const res = await registerBusiness({ email }).expect(201);
      expect(res.body.approvalStatus).toBe('PENDING');
      expect(typeof res.body.accountId).toBe('string');
    });

    it('2. registers with a valid JPEG/PNG licence', async () => {
      const email = uniqueEmail('biz-png');
      await registerBusiness({
        email,
        fileBuffer: pngBuffer(),
        fileName: 'licence.png',
      }).expect(201);
    });

    it('3. rejects a duplicate email with 409', async () => {
      const email = uniqueEmail('biz-dup-email');
      await registerBusiness({ email }).expect(201);
      await registerBusiness({ email, taxId: `08${Date.now().toString().slice(-8)}` }).expect(409);
    });

    it('4. rejects a duplicate taxId with a distinct 409', async () => {
      const taxId = `07${Date.now().toString().slice(-8)}`;
      await registerBusiness({ taxId }).expect(201);
      await registerBusiness({ taxId }).expect(409);
    });

    it('5. rejects an out-of-range businessType with 400', async () => {
      await registerBusiness({ businessType: 'NOT_A_TYPE' as never }).expect(400);
    });

    it('6. rejects a missing licence file with 400', async () => {
      await registerBusiness({ skipFile: true }).expect(400);
    });

    it('7. rejects an over-sized file with 400', async () => {
      const oversized = Buffer.concat([pdfBuffer(), Buffer.alloc(11 * 1024 * 1024, 0)]);
      await registerBusiness({ fileBuffer: oversized }).expect(400);
    });

    it('8. rejects a non-allowlisted mimetype with 400', async () => {
      await registerBusiness({
        fileBuffer: exeBuffer(),
        fileName: 'malware.exe',
        fileContentType: 'application/octet-stream',
      }).expect(400);
    });

    it('9. rejects a spoofed .pdf filename whose real content is not a PDF (400)', async () => {
      const req = request(server)
        .post('/api/business-accounts/register')
        .field('email', uniqueEmail('biz-spoof'))
        .field('password', STRONG_PASSWORD)
        .field('companyName', 'Spoof Co')
        .field('taxId', `06${Date.now().toString().slice(-8)}`)
        .field('businessType', 'RETAIL_STORE')
        .attach('licence', exeBuffer(), {
          filename: 'licence.pdf',
          contentType: 'application/x-msdownload',
        });
      await req.expect(400);
    });

    it('10. a newly registered business account can log in with a PENDING/no-tier token', async () => {
      const email = uniqueEmail('biz-login');
      await registerBusiness({ email }).expect(201);
      const accessToken = await loginAs(email, STRONG_PASSWORD);
      const payload = decodeJwtPayload(accessToken);
      expect(payload.type).toBe('BUSINESS_ACCOUNT');
      expect(payload.approvalStatus).toBe('PENDING');
      expect(payload.priceTierId).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------
  // AUTH-03: authenticated, role-checked licence retrieval
  // -------------------------------------------------------------------
  describe('GET /api/business-accounts/:id/licence', () => {
    let businessAccountId: string;
    let ownerEmail: string;
    let ownerToken: string;

    beforeAll(async () => {
      ownerEmail = uniqueEmail('biz-licence-owner');
      const res = await registerBusiness({ email: ownerEmail }).expect(201);
      businessAccountId = res.body.accountId as string;
      ownerToken = await loginAs(ownerEmail, STRONG_PASSWORD);
    });

    it('11. 401 with no token', async () => {
      await request(server).get(`/api/business-accounts/${businessAccountId}/licence`).expect(401);
    });

    it('12. 200 with a presigned URL for the owning business account', async () => {
      const res = await request(server)
        .get(`/api/business-accounts/${businessAccountId}/licence`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      expect(res.body.url).toContain('X-Amz-Signature');
      expect(res.body.expiresInSeconds).toBe(300);
    });

    it('13. 200 for SUPER_ADMIN', async () => {
      const token = await loginAs('admin@kidtoy.local');
      await request(server)
        .get(`/api/business-accounts/${businessAccountId}/licence`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('14. 200 for SALES', async () => {
      const token = await loginAs('sales@kidtoy.local');
      await request(server)
        .get(`/api/business-accounts/${businessAccountId}/licence`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('15. 403 for a different business account', async () => {
      const otherEmail = uniqueEmail('biz-licence-other');
      await registerBusiness({ email: otherEmail }).expect(201);
      const otherToken = await loginAs(otherEmail, STRONG_PASSWORD);
      await request(server)
        .get(`/api/business-accounts/${businessAccountId}/licence`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('16. 403 for a retail customer', async () => {
      const token = await loginAs('customer@kidtoy.local');
      await request(server)
        .get(`/api/business-accounts/${businessAccountId}/licence`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('17. 403 for a WAREHOUSE staff member', async () => {
      const token = await loginAs('warehouse@kidtoy.local');
      await request(server)
        .get(`/api/business-accounts/${businessAccountId}/licence`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('18. the raw MinIO object path is refused without a signature', async () => {
      const minioEndpoint = process.env.MINIO_ENDPOINT as string;
      const bucket = process.env.MINIO_BUCKET_DOCUMENTS as string;
      // We don't have the raw key from the client side (by design — it never
      // leaves the server), so probe a path in the same bucket/prefix; MinIO
      // must refuse ANY unsigned GET against a private bucket regardless of
      // whether the key exists (403, not merely 404).
      const res = await fetch(`${minioEndpoint}/${bucket}/business-licences/does-not-matter.pdf`);
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // Task 2: minimal staff approval transition
  // -------------------------------------------------------------------
  describe('PATCH /api/admin/business-accounts/:id/approval', () => {
    let pendingId: string;
    let dealerATierId: string;
    let retailTierId: string;

    beforeAll(async () => {
      const email = uniqueEmail('biz-approval');
      const res = await registerBusiness({ email }).expect(201);
      pendingId = res.body.accountId as string;

      const dealerA = await prisma.priceTier.findUniqueOrThrow({ where: { code: 'DEALER_A' } });
      const retail = await prisma.priceTier.findUniqueOrThrow({ where: { code: 'RETAIL' } });
      dealerATierId = dealerA.id;
      retailTierId = retail.id;
    });

    it('19. 401 with no token', async () => {
      await request(server)
        .patch(`/api/admin/business-accounts/${pendingId}/approval`)
        .send({ approvalStatus: 'APPROVED', priceTierId: dealerATierId })
        .expect(401);
    });

    it('20. 403 for WAREHOUSE', async () => {
      const token = await loginAs('warehouse@kidtoy.local');
      await request(server)
        .patch(`/api/admin/business-accounts/${pendingId}/approval`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvalStatus: 'APPROVED', priceTierId: dealerATierId })
        .expect(403);
    });

    it('21. 403 for CONTENT', async () => {
      const token = await loginAs('content@kidtoy.local');
      await request(server)
        .patch(`/api/admin/business-accounts/${pendingId}/approval`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvalStatus: 'APPROVED', priceTierId: dealerATierId })
        .expect(403);
    });

    it('22. 403 for a business account principal', async () => {
      const email = uniqueEmail('biz-nonstaff');
      await registerBusiness({ email }).expect(201);
      const token = await loginAs(email, STRONG_PASSWORD);
      await request(server)
        .patch(`/api/admin/business-accounts/${pendingId}/approval`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvalStatus: 'APPROVED', priceTierId: dealerATierId })
        .expect(403);
    });

    it('23. 400 when approving without a priceTierId', async () => {
      const token = await loginAs('sales@kidtoy.local');
      await request(server)
        .patch(`/api/admin/business-accounts/${pendingId}/approval`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvalStatus: 'APPROVED' })
        .expect(400);
    });

    it('24. 400 when approving onto the default RETAIL tier', async () => {
      const token = await loginAs('sales@kidtoy.local');
      await request(server)
        .patch(`/api/admin/business-accounts/${pendingId}/approval`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvalStatus: 'APPROVED', priceTierId: retailTierId })
        .expect(400);
    });

    it('25. 400 when approving onto an unknown priceTierId', async () => {
      const token = await loginAs('sales@kidtoy.local');
      await request(server)
        .patch(`/api/admin/business-accounts/${pendingId}/approval`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvalStatus: 'APPROVED', priceTierId: 'does-not-exist' })
        .expect(400);
    });

    it('26. 400 when rejecting without a rejectionReason', async () => {
      const email = uniqueEmail('biz-reject-noreason');
      const res = await registerBusiness({ email }).expect(201);
      const token = await loginAs('sales@kidtoy.local');
      await request(server)
        .patch(`/api/admin/business-accounts/${res.body.accountId}/approval`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvalStatus: 'REJECTED' })
        .expect(400);
    });

    it('27. SALES can approve onto DEALER_A (200), clearing rejectionReason', async () => {
      const token = await loginAs('sales@kidtoy.local');
      const res = await request(server)
        .patch(`/api/admin/business-accounts/${pendingId}/approval`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvalStatus: 'APPROVED', priceTierId: dealerATierId })
        .expect(200);
      expect(res.body.approvalStatus).toBe('APPROVED');
      expect(res.body.priceTierId).toBe(dealerATierId);
      expect(res.body.rejectionReason).toBeNull();
    });

    it('28. after approval, a fresh login carries the new approvalStatus + priceTierId', async () => {
      const email = uniqueEmail('biz-approved-login');
      const res = await registerBusiness({ email }).expect(201);
      const staffToken = await loginAs('sales@kidtoy.local');
      await request(server)
        .patch(`/api/admin/business-accounts/${res.body.accountId}/approval`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ approvalStatus: 'APPROVED', priceTierId: dealerATierId })
        .expect(200);

      const accessToken = await loginAs(email, STRONG_PASSWORD);
      const payload = decodeJwtPayload(accessToken);
      expect(payload.approvalStatus).toBe('APPROVED');
      expect(payload.priceTierId).toBe(dealerATierId);
    });

    it('29. REJECTED with a reason returns 200', async () => {
      const email = uniqueEmail('biz-rejected');
      const res = await registerBusiness({ email }).expect(201);
      const token = await loginAs('sales@kidtoy.local');
      const rejectRes = await request(server)
        .patch(`/api/admin/business-accounts/${res.body.accountId}/approval`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvalStatus: 'REJECTED', rejectionReason: 'Giay phep khong hop le' })
        .expect(200);
      expect(rejectRes.body.approvalStatus).toBe('REJECTED');
    });

    it('30. SUPER_ADMIN can also approve (200)', async () => {
      const email = uniqueEmail('biz-superadmin-approve');
      const res = await registerBusiness({ email }).expect(201);
      const token = await loginAs('admin@kidtoy.local');
      await request(server)
        .patch(`/api/admin/business-accounts/${res.body.accountId}/approval`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvalStatus: 'APPROVED', priceTierId: dealerATierId })
        .expect(200);
    });
  });

  describe('GET /api/admin/business-accounts', () => {
    it('31. SALES sees only PENDING rows, each with hasLicence and no businessLicenseKey', async () => {
      const email = uniqueEmail('biz-list-pending');
      await registerBusiness({ email }).expect(201);
      const token = await loginAs('sales@kidtoy.local');
      const res = await request(server)
        .get('/api/admin/business-accounts?status=PENDING')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/businessLicenseKey/i);
      for (const row of res.body as Array<Record<string, unknown>>) {
        expect(row.approvalStatus).toBe('PENDING');
        expect(typeof row.hasLicence).toBe('boolean');
      }
    });

    it('32. 401 with no token', async () => {
      await request(server).get('/api/admin/business-accounts').expect(401);
    });
  });
});

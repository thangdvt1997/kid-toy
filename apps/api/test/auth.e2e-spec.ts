import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, resetAndSeed, uniqueEmail } from './utils/test-app';
import type { PrismaService } from '../src/prisma/prisma.service';

const SEED_PASSWORD = process.env.SEED_DEFAULT_PASSWORD as string;
const STRONG_PASSWORD = 'Str0ng-Passw0rd!';

/** Decodes a JWT payload without verifying the signature — test-only. */
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

describe('Auth (e2e)', () => {
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

  async function loginAs(email: string): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await request(server)
      .post('/api/auth/login')
      .send({ email, password: SEED_PASSWORD })
      .expect(200);
    return res.body as { accessToken: string; refreshToken: string };
  }

  // -------------------------------------------------------------------
  // AUTH-02: retail customer register/login
  // -------------------------------------------------------------------
  describe('POST /api/auth/register', () => {
    it('1. registers a new retail customer with tokens and no passwordHash leak', async () => {
      const email = uniqueEmail('register');
      const res = await request(server)
        .post('/api/auth/register')
        .send({ email, password: STRONG_PASSWORD, fullName: 'Test Customer' })
        .expect(201);

      expect(typeof res.body.accessToken).toBe('string');
      expect((res.body.accessToken as string).length).toBeGreaterThan(0);
      expect(typeof res.body.refreshToken).toBe('string');
      expect((res.body.refreshToken as string).length).toBeGreaterThan(0);
      expect(res.body.account.type).toBe('RETAIL_CUSTOMER');
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
    });

    it('2. rejects a duplicate email with 409', async () => {
      const email = uniqueEmail('dup');
      await request(server)
        .post('/api/auth/register')
        .send({ email, password: STRONG_PASSWORD })
        .expect(201);
      await request(server)
        .post('/api/auth/register')
        .send({ email, password: STRONG_PASSWORD })
        .expect(409);
    });

    it('3. rejects a password shorter than 10 characters with 400', async () => {
      await request(server)
        .post('/api/auth/register')
        .send({ email: uniqueEmail('weak'), password: 'short1' })
        .expect(400);
    });
  });

  describe('POST /api/auth/login (retail customer)', () => {
    it('4. logs in the just-registered customer', async () => {
      const email = uniqueEmail('login');
      await request(server)
        .post('/api/auth/register')
        .send({ email, password: STRONG_PASSWORD })
        .expect(201);

      const res = await request(server)
        .post('/api/auth/login')
        .send({ email, password: STRONG_PASSWORD })
        .expect(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
    });
  });

  // -------------------------------------------------------------------
  // AUTH-01: staff login, session survives refresh
  // -------------------------------------------------------------------
  describe('Staff session lifecycle', () => {
    it('5. staff login returns a STAFF/SUPER_ADMIN access token', async () => {
      const res = await request(server)
        .post('/api/auth/login')
        .send({ email: 'admin@kidtoy.local', password: SEED_PASSWORD })
        .expect(200);
      const payload = decodeJwtPayload(res.body.accessToken as string);
      expect(payload.type).toBe('STAFF');
      expect(payload.role).toBe('SUPER_ADMIN');
    });

    it('6. refresh returns a new access+refresh pair that authenticates /me', async () => {
      const login = await loginAs('admin@kidtoy.local');

      const refreshRes = await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: login.refreshToken })
        .expect(200);

      expect(refreshRes.body.accessToken).not.toBe(login.accessToken);
      expect(refreshRes.body.refreshToken).not.toBe(login.refreshToken);

      await request(server)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshRes.body.accessToken}`)
        .expect(200);
    });

    it('7. replaying the original refresh token after rotation returns 401', async () => {
      const login = await loginAs('admin@kidtoy.local');

      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: login.refreshToken })
        .expect(200);

      // The ORIGINAL token was revoked by the rotation above — replay fails.
      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: login.refreshToken })
        .expect(401);
    });

    it('8. logout revokes the most recent refresh token', async () => {
      const login = await loginAs('sales@kidtoy.local');

      await request(server)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${login.accessToken}`)
        .expect(204);

      await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: login.refreshToken })
        .expect(401);
    });
  });

  // -------------------------------------------------------------------
  // No user enumeration
  // -------------------------------------------------------------------
  describe('POST /api/auth/login (credential failures)', () => {
    it('9. wrong password and unknown email return byte-identical 401 bodies', async () => {
      const wrongPassword = await request(server)
        .post('/api/auth/login')
        .send({ email: 'admin@kidtoy.local', password: 'definitely-wrong-1' })
        .expect(401);

      const unknownEmail = await request(server)
        .post('/api/auth/login')
        .send({ email: uniqueEmail('nope'), password: 'definitely-wrong-1' })
        .expect(401);

      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });
  });

  // -------------------------------------------------------------------
  // AUTH-04: deny-by-default staff RBAC
  // -------------------------------------------------------------------
  describe('RBAC probe endpoints', () => {
    it('10. SUPER_ADMIN gets 200 from the super-admin probe', async () => {
      const { accessToken } = await loginAs('admin@kidtoy.local');
      await request(server)
        .get('/api/admin/_probe/super-admin')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('11a. WAREHOUSE gets 403 from the super-admin probe', async () => {
      const { accessToken } = await loginAs('warehouse@kidtoy.local');
      await request(server)
        .get('/api/admin/_probe/super-admin')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });

    it('11b. CONTENT gets 200 from the content probe but 403 from the super-admin probe', async () => {
      const { accessToken } = await loginAs('content@kidtoy.local');
      await request(server)
        .get('/api/admin/_probe/content')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      await request(server)
        .get('/api/admin/_probe/super-admin')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });

    it('12. deny-by-default: an unauthenticated request gets 401, not 403 or 200', async () => {
      await request(server).get('/api/admin/_probe/super-admin').expect(401);
    });

    it('13. a non-staff principal (retail customer) gets 403 from both probes despite a valid token', async () => {
      const email = uniqueEmail('nonstaff');
      const register = await request(server)
        .post('/api/auth/register')
        .send({ email, password: STRONG_PASSWORD })
        .expect(201);
      const accessToken = register.body.accessToken as string;

      await request(server)
        .get('/api/admin/_probe/super-admin')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
      await request(server)
        .get('/api/admin/_probe/content')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });
  });
});

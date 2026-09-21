import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp, resetAndSeed, uniqueEmail } from './utils/test-app';
import type { PrismaService } from '../src/prisma/prisma.service';

const SEED_PASSWORD = process.env.SEED_DEFAULT_PASSWORD as string;
const NEW_PASSWORD = 'Br4nd-New-Passw0rd!';

/**
 * Test-only shim standing in for the real mail transport. MailerService
 * (Phase 1) logs the reset URL rather than sending real email — these e2e
 * cases spy on the logger output to recover the raw token, exactly as a
 * real recipient would read it from their inbox.
 */
function extractResetUrlFromLog(logSpy: jest.SpyInstance): string {
  // findLast, not find: a test may trigger more than one forgot-password
  // call against the same spy instance (e.g. vi then en locale) — the most
  // recently logged URL is the one that matters, not the first.
  const call = logSpy.mock.calls.findLast((args) =>
    String(args[0]).includes('[mail:password-reset]'),
  );
  if (!call) {
    throw new Error('No password-reset log line captured');
  }
  const match = String(call[0]).match(/url=(\S+)/);
  if (!match) {
    throw new Error('Could not find url= in password-reset log line');
  }
  return match[1] as string;
}

function tokenFromResetUrl(resetUrl: string): string {
  const token = new URL(resetUrl).searchParams.get('token');
  if (!token) {
    throw new Error('No token query param in reset URL');
  }
  return token;
}

describe('Password Reset (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: App;
  let logSpy: jest.SpyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    server = app.getHttpServer() as App;
    await resetAndSeed(prisma);
  });

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logSpy = jest.spyOn((require('@nestjs/common') as any).Logger.prototype, 'log');
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. requesting a reset for a KNOWN email returns 202 and logs the delivery URL', async () => {
    const email = uniqueEmail('reset-known');
    await request(server)
      .post('/api/auth/register')
      .send({ email, password: SEED_PASSWORD })
      .expect(201);

    await request(server).post('/api/auth/forgot-password').send({ email }).expect(202);

    const resetUrl = extractResetUrlFromLog(logSpy);
    expect(resetUrl).toContain('/vi/reset-password?token=');
  });

  it('2. requesting a reset for an UNKNOWN email also returns 202, identical body, no enumeration', async () => {
    const known = uniqueEmail('reset-known-2');
    await request(server)
      .post('/api/auth/register')
      .send({ email: known, password: SEED_PASSWORD })
      .expect(201);

    const known202 = await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: known })
      .expect(202);
    const unknown202 = await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: uniqueEmail('reset-unknown') })
      .expect(202);

    expect(known202.body).toEqual(unknown202.body);
  });

  it('3. a second request invalidates the first — the earlier token 400s on use', async () => {
    const email = uniqueEmail('reset-supersede');
    await request(server)
      .post('/api/auth/register')
      .send({ email, password: SEED_PASSWORD })
      .expect(201);

    await request(server).post('/api/auth/forgot-password').send({ email }).expect(202);
    const firstToken = tokenFromResetUrl(extractResetUrlFromLog(logSpy));

    await request(server).post('/api/auth/forgot-password').send({ email }).expect(202);

    await request(server)
      .post('/api/auth/reset-password')
      .send({ token: firstToken, password: NEW_PASSWORD })
      .expect(400);
  });

  it('4. a valid token resets the password — old password fails, new password logs in', async () => {
    const email = uniqueEmail('reset-success');
    await request(server)
      .post('/api/auth/register')
      .send({ email, password: SEED_PASSWORD })
      .expect(201);

    await request(server).post('/api/auth/forgot-password').send({ email }).expect(202);
    const token = tokenFromResetUrl(extractResetUrlFromLog(logSpy));

    await request(server)
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD })
      .expect(204);

    await request(server)
      .post('/api/auth/login')
      .send({ email, password: SEED_PASSWORD })
      .expect(401);

    await request(server).post('/api/auth/login').send({ email, password: NEW_PASSWORD }).expect(200);
  });

  it('5. replaying the same token returns 400', async () => {
    const email = uniqueEmail('reset-replay');
    await request(server)
      .post('/api/auth/register')
      .send({ email, password: SEED_PASSWORD })
      .expect(201);

    await request(server).post('/api/auth/forgot-password').send({ email }).expect(202);
    const token = tokenFromResetUrl(extractResetUrlFromLog(logSpy));

    await request(server)
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD })
      .expect(204);

    await request(server)
      .post('/api/auth/reset-password')
      .send({ token, password: 'Another-New-Pass1!' })
      .expect(400);
  });

  it('6. an expired token returns 400', async () => {
    const email = uniqueEmail('reset-expired');
    const register = await request(server)
      .post('/api/auth/register')
      .send({ email, password: SEED_PASSWORD })
      .expect(201);
    const accountId = (register.body.account as { id: string }).id;

    await request(server).post('/api/auth/forgot-password').send({ email }).expect(202);
    const token = tokenFromResetUrl(extractResetUrlFromLog(logSpy));

    // Force the just-created token into the past directly in the DB —
    // there is no clock-mocking seam in the HTTP layer for e2e.
    await prisma.passwordResetToken.updateMany({
      where: { accountId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await request(server)
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD })
      .expect(400);
  });

  it('7. an unknown/garbage token returns 400 with the same body shape as an expired one', async () => {
    const email = uniqueEmail('reset-garbage-cmp');
    const register = await request(server)
      .post('/api/auth/register')
      .send({ email, password: SEED_PASSWORD })
      .expect(201);
    const accountId = (register.body.account as { id: string }).id;

    await request(server).post('/api/auth/forgot-password').send({ email }).expect(202);
    const expiredToken = tokenFromResetUrl(extractResetUrlFromLog(logSpy));
    await prisma.passwordResetToken.updateMany({
      where: { accountId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const garbageRes = await request(server)
      .post('/api/auth/reset-password')
      .send({ token: 'a'.repeat(64), password: NEW_PASSWORD })
      .expect(400);
    const expiredRes = await request(server)
      .post('/api/auth/reset-password')
      .send({ token: expiredToken, password: NEW_PASSWORD })
      .expect(400);

    expect(garbageRes.body).toEqual(expiredRes.body);
  });

  it('8. completing a reset revokes a refresh token issued before the reset', async () => {
    const email = uniqueEmail('reset-revokes-sessions');
    const register = await request(server)
      .post('/api/auth/register')
      .send({ email, password: SEED_PASSWORD })
      .expect(201);
    const preResetRefreshToken = (register.body as { refreshToken: string }).refreshToken;

    await request(server).post('/api/auth/forgot-password').send({ email }).expect(202);
    const token = tokenFromResetUrl(extractResetUrlFromLog(logSpy));

    await request(server)
      .post('/api/auth/reset-password')
      .send({ token, password: NEW_PASSWORD })
      .expect(204);

    await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: preResetRefreshToken })
      .expect(401);
  });

  it('9. the reset URL is ${APP_BASE_URL}/${locale}/reset-password?token=<raw>, defaulting to vi', async () => {
    const email = uniqueEmail('reset-url-shape');
    await request(server)
      .post('/api/auth/register')
      .send({ email, password: SEED_PASSWORD })
      .expect(201);

    await request(server).post('/api/auth/forgot-password').send({ email }).expect(202);
    const resetUrl = extractResetUrlFromLog(logSpy);
    const appBaseUrl = process.env.APP_BASE_URL as string;
    expect(resetUrl.startsWith(`${appBaseUrl}/vi/reset-password?token=`)).toBe(true);

    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email, locale: 'en' })
      .expect(202);
    const resetUrlEn = extractResetUrlFromLog(logSpy);
    expect(resetUrlEn.startsWith(`${appBaseUrl}/en/reset-password?token=`)).toBe(true);
  });
});

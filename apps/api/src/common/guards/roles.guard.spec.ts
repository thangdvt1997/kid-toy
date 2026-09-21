import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtPayload } from '../types/jwt-payload';
import { RolesGuard } from './roles.guard';

function makeContext(user: JwtPayload | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeGuard(required: string[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows the request when no @Roles() metadata is set', () => {
    const guard = makeGuard(undefined);
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('denies when user is undefined', () => {
    const guard = makeGuard(['SUPER_ADMIN']);
    expect(guard.canActivate(makeContext(undefined))).toBe(false);
  });

  it('denies a RETAIL_CUSTOMER even with a role-shaped token', () => {
    const guard = makeGuard(['SUPER_ADMIN']);
    const user = { sub: '1', type: 'RETAIL_CUSTOMER' } as unknown as JwtPayload;
    expect(guard.canActivate(makeContext(user))).toBe(false);
  });

  it('denies STAFF/WAREHOUSE against a SUPER_ADMIN-only route', () => {
    const guard = makeGuard(['SUPER_ADMIN']);
    const user: JwtPayload = { sub: '1', type: 'STAFF', role: 'WAREHOUSE' };
    expect(guard.canActivate(makeContext(user))).toBe(false);
  });

  it('allows STAFF/SUPER_ADMIN against a SUPER_ADMIN-only route', () => {
    const guard = makeGuard(['SUPER_ADMIN']);
    const user: JwtPayload = { sub: '1', type: 'STAFF', role: 'SUPER_ADMIN' };
    expect(guard.canActivate(makeContext(user))).toBe(true);
  });

  it('allows STAFF/CONTENT against a [SUPER_ADMIN, CONTENT] route', () => {
    const guard = makeGuard(['SUPER_ADMIN', 'CONTENT']);
    const user: JwtPayload = { sub: '1', type: 'STAFF', role: 'CONTENT' };
    expect(guard.canActivate(makeContext(user))).toBe(true);
  });
});

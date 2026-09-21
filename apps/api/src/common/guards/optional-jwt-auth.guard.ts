import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { JwtPayload } from '../types/jwt-payload';

/**
 * Anonymous-tolerant variant for public catalog routes (CATALOG-06 must
 * resolve a price for anonymous viewers too). Overrides handleRequest to
 * return undefined instead of throwing on a missing/invalid token.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = JwtPayload>(_err: unknown, user: TUser | false): TUser | undefined {
    return user ? user : undefined;
  }
}

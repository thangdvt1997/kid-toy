import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { JwtPayload } from '../types/jwt-payload';

/**
 * Deny-by-default staff RBAC. Returns true when no @Roles() metadata is
 * present (the route's own JwtAuthGuard is what enforces authentication
 * there) — but every admin route in this codebase must still declare an
 * explicit @Roles(...), so in practice this guard is never the sole line
 * of defense. See PITFALLS.md "Default-permissive RBAC".
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    return user?.type === 'STAFF' && !!user.role && required.includes(user.role);
  }
}

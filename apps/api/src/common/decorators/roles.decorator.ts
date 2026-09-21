import { SetMetadata } from '@nestjs/common';
import type { StaffRole } from '@kid-toy/shared-types';

export const ROLES_KEY = 'roles';

/** Typed against StaffRole (not string[]) so a typo fails to compile. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

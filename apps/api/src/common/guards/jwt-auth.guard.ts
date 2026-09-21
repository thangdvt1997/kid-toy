import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** 401s on a missing/invalid/expired token. See OptionalJwtAuthGuard for public routes. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

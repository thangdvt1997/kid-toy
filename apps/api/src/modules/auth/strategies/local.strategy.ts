import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';
import type { AccountWithRelations } from '../account-payload.util';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(email: string, password: string): Promise<AccountWithRelations> {
    const account = await this.authService.validateCredentials(email, password);
    if (!account) {
      // Deliberately generic — identical for "no such email" and "wrong
      // password" so the controller's response body cannot be used to
      // enumerate registered emails (threat T-01-15).
      throw new UnauthorizedException('Invalid email or password');
    }
    return account;
  }
}

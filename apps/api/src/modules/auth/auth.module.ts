import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

@Module({
  imports: [
    PassportModule,
    // Registered empty: access and refresh tokens use different secrets,
    // signed per-call in TokenService rather than via a module-wide secret.
    JwtModule.register({}),
    PrismaModule,
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, LocalStrategy, JwtStrategy, PasswordResetService],
  exports: [AuthService, TokenService],
})
export class AuthModule {}

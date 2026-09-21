import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateEnv } from './env.schema';

/**
 * Local dev secrets live in the repo-root `.env` (established in Plan 01,
 * shared with docker-compose and prisma.config.ts). `pnpm --filter api ...`
 * / turbo run each task with apps/api as the working directory, so the
 * root file is loaded explicitly in addition to the default `apps/api/.env`
 * lookup (harmless if the latter doesn't exist).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', resolve(process.cwd(), '../../.env')],
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}

import { z } from 'zod';

/**
 * Fail-fast environment schema. Every key documented in the repo-root
 * `.env.example` must be represented here. `validateEnv` is wired into
 * `ConfigModule.forRoot({ validate: validateEnv })` (see config.module.ts),
 * which means Nest aborts the boot process (throwing before any provider is
 * instantiated) when the environment is missing or malformed — see
 * PITFALLS.md / RESEARCH.md ASVS V2/V6 guidance.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_CORS_ORIGIN: z.string().min(1, 'API_CORS_ORIGIN is required'),
  APP_BASE_URL: z.string().url('APP_BASE_URL must be a valid URL'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  BCRYPT_COST: z.coerce.number().int().min(12, 'BCRYPT_COST must be at least 12').default(12),

  UPLOAD_MAX_DOCUMENT_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  UPLOAD_MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),

  MINIO_ENDPOINT: z.string().url('MINIO_ENDPOINT must be a valid URL'),
  MINIO_ROOT_USER: z.string().min(1, 'MINIO_ROOT_USER is required'),
  MINIO_ROOT_PASSWORD: z.string().min(1, 'MINIO_ROOT_PASSWORD is required'),
  MINIO_REGION: z.string().default('us-east-1'),
  MINIO_BUCKET_MEDIA: z.string().min(1, 'MINIO_BUCKET_MEDIA is required'),
  MINIO_BUCKET_DOCUMENTS: z.string().min(1, 'MINIO_BUCKET_DOCUMENTS is required'),

  // Optional at env-schema level; prisma/seed.ts throws explicitly when this
  // is unset instead of silently defaulting to a hardcoded password.
  SEED_DEFAULT_PASSWORD: z.string().min(8).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Throws a single Error listing every offending key path + reason. Used as
 * ConfigModule's `validate` hook, which runs synchronously at boot.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration - ${issues}`);
  }
  return result.data;
}

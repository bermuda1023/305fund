import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().optional(),
  CLIENT_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(16).optional(),
  STORAGE_BACKEND: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

export function validateRuntimeEnv() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    if (!env.JWT_SECRET || env.JWT_SECRET === 'dev-secret-change-me' || env.JWT_SECRET === 'change-me-to-a-random-string') {
      throw new Error('JWT_SECRET must be set to a strong random value in production');
    }
    if (env.STORAGE_BACKEND === 's3' && !env.S3_BUCKET) {
      throw new Error('S3_BUCKET is required when STORAGE_BACKEND=s3');
    }
  }
}

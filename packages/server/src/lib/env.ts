import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().optional(),
  CLIENT_URL: z.string().optional(), // comma-separated URLs allowed
  JWT_SECRET: z.string().min(16).optional(),
  PUBLIC_CORS_ORIGINS: z.string().optional(), // comma-separated list
  INVESTOR_GATE_PASSWORD_HASH: z.string().optional(), // bcrypt hash
  INVESTOR_TARGET_URL: z.string().optional(),
  NDA_SIGN_NOTIFY_EMAILS: z.string().optional(), // comma-separated list
  INVESTOR_NDA_STORAGE_KEY: z.string().optional(), // S3/R2 key for fixed investor NDA PDF
  INVESTOR_NDA_PDF_PATH: z.string().optional(), // local file fallback
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

  // Validate URL lists if configured.
  const urlLists = [
    { name: 'CLIENT_URL', raw: env.CLIENT_URL },
    { name: 'PUBLIC_CORS_ORIGINS', raw: env.PUBLIC_CORS_ORIGINS },
  ];
  for (const { name, raw } of urlLists) {
    if (!raw) continue;
    const parts = String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const u of parts) {
      try {
        // eslint-disable-next-line no-new
        new URL(u);
      } catch {
        throw new Error(`${name} contains an invalid URL: ${u}`);
      }
    }
  }
  if (env.INVESTOR_TARGET_URL) {
    try {
      // eslint-disable-next-line no-new
      new URL(env.INVESTOR_TARGET_URL);
    } catch {
      throw new Error(`INVESTOR_TARGET_URL must be a valid URL: ${env.INVESTOR_TARGET_URL}`);
    }
  }

  if (env.NODE_ENV === 'production') {
    if (!env.JWT_SECRET || env.JWT_SECRET === 'dev-secret-change-me' || env.JWT_SECRET === 'change-me-to-a-random-string') {
      throw new Error('JWT_SECRET must be set to a strong random value in production');
    }
    if (env.STORAGE_BACKEND === 's3' && !env.S3_BUCKET) {
      throw new Error('S3_BUCKET is required when STORAGE_BACKEND=s3');
    }
  }
}

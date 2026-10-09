import { z } from 'zod';

const postgresqlUrl = z
  .string()
  .url()
  .refine(
    (value) =>
      value.startsWith('postgresql://') || value.startsWith('postgres://'),
    {
      message: 'Expected a PostgreSQL connection URL.',
    },
  );

const httpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', {
    message: 'Expected an HTTPS URL.',
  });

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: postgresqlUrl,
    AUTH0_ISSUER_BASE_URL: httpsUrl,
    AUTH0_AUDIENCE: z.string().trim().min(1),
    R2_ENDPOINT: httpsUrl.optional(),
    R2_BUCKET_NAME: z.string().trim().min(1).optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    PLUGGY_CLIENT_ID: z.string().min(1).optional(),
    PLUGGY_CLIENT_SECRET: z.string().min(1).optional(),
    PLUGGY_WEBHOOK_SECRET: z.string().min(32).optional(),
    PLUGGY_WEBHOOK_URL: httpsUrl.optional(),
    PUBLIC_API_BASE_URL: httpsUrl.optional(),
    QSTASH_URL: httpsUrl.optional(),
    QSTASH_TOKEN: z.string().min(1).optional(),
    QSTASH_CURRENT_SIGNING_KEY: z.string().min(1).optional(),
    QSTASH_NEXT_SIGNING_KEY: z.string().min(1).optional(),
  })
  .superRefine((environment, context) => {
    const r2Settings = [
      environment.R2_ENDPOINT,
      environment.R2_BUCKET_NAME,
      environment.R2_ACCESS_KEY_ID,
      environment.R2_SECRET_ACCESS_KEY,
    ];
    if (r2Settings.some(Boolean) && r2Settings.some((setting) => !setting)) {
      context.addIssue({
        code: 'custom',
        path: ['R2_ENDPOINT'],
        message: 'R2 settings must be provided as a complete set.',
      });
    }

    const pluggySettings = [
      environment.PLUGGY_CLIENT_ID,
      environment.PLUGGY_CLIENT_SECRET,
      environment.PLUGGY_WEBHOOK_SECRET,
      environment.PLUGGY_WEBHOOK_URL,
    ];
    const qstashSettings = [
      environment.QSTASH_URL,
      environment.QSTASH_TOKEN,
      environment.QSTASH_CURRENT_SIGNING_KEY,
      environment.QSTASH_NEXT_SIGNING_KEY,
      environment.PUBLIC_API_BASE_URL,
    ];
    const integrationSettings = [...pluggySettings, ...qstashSettings];
    if (
      integrationSettings.some(Boolean) &&
      integrationSettings.some((setting) => !setting)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['PLUGGY_CLIENT_ID'],
        message:
          'Pluggy and QStash settings must be provided as a complete set.',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  return environmentSchema.parse(input);
}

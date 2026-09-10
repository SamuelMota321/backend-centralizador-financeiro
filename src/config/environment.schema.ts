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

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: postgresqlUrl,
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  return environmentSchema.parse(input);
}

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  CRON_SCHEDULE: z.string().default('*/5 * * * *'),
  HTTP_USER_AGENT: z.string().min(1),
  HTTP_DELAY_MS: z.coerce.number().int().nonnegative().default(200),
  HTTP_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  HTTP_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(500),
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}

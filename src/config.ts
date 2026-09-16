import { z } from 'zod';

// An empty `KEY=` line in .env means "not set".
const optionalUrl = z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3100),
  CRON_SCHEDULE: z.string().default('*/5 * * * *'),
  HTTP_USER_AGENT: z.string().min(1),
  HTTP_DELAY_MS: z.coerce.number().int().nonnegative().default(200),
  HTTP_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  HTTP_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(500),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  DISCORD_WEBHOOK_URL: optionalUrl,
  RESTOCK_ALERT_COOLDOWN_HOURS: z.coerce.number().nonnegative().default(6),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}

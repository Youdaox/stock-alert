import pino from 'pino';

import { adapterRegistry } from './adapters/index.js';
import { loadConfig } from './config.js';
import type { HttpPolicy } from './core/http.js';
import { Poller } from './core/poller.js';
import { createDb } from './db/client.js';
import { NotificationDispatcher } from './notify/dispatcher.js';
import { createWebServer } from './web/server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL });
  const { db, pool } = createDb(config.DATABASE_URL);

  const http: HttpPolicy = {
    userAgent: config.HTTP_USER_AGENT,
    delayMs: config.HTTP_DELAY_MS,
    maxRetries: config.HTTP_MAX_RETRIES,
    backoffBaseMs: config.HTTP_BACKOFF_BASE_MS,
    timeoutMs: config.HTTP_TIMEOUT_MS,
  };

  const channels = config.DISCORD_WEBHOOK_URL ? ['discord'] : [];
  if (channels.length === 0) {
    logger.warn('DISCORD_WEBHOOK_URL is not set; alerts will only show on the website');
  }

  const poller = new Poller({
    db,
    logger,
    adapters: adapterRegistry,
    http,
    channels,
    restockCooldownHours: config.RESTOCK_ALERT_COOLDOWN_HOURS,
  });

  const dispatcher = new NotificationDispatcher({
    db,
    logger,
    http,
    discordWebhookUrl: config.DISCORD_WEBHOOK_URL,
    intervalMs: 10_000,
  });

  const web = await createWebServer({ db, logger, poller });
  await web.listen({ host: config.HOST, port: config.PORT });

  poller.start(config.CRON_SCHEDULE);
  dispatcher.start();
  logger.info({ url: `http://${config.HOST}:${config.PORT}` }, 'stock-alert running');

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    dispatcher.stop();
    await web.close();
    await poller.stop();
    await pool.end();
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

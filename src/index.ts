import pino from 'pino';

import { adapterRegistry } from './adapters/index.js';
import { loadConfig } from './config.js';
import { Poller } from './core/poller.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.LOG_LEVEL });

  const poller = new Poller({
    logger,
    adapters: adapterRegistry,
    sources: async () => {
      // TODO: Load sources from database via Drizzle.
      return [];
    },
    writeSnapshots: async () => {
      // TODO: Persist snapshots and enqueue notifications.
    },
  });

  poller.start(config.CRON_SCHEDULE);
  logger.info('stock-alert worker started');

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await poller.stop();
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

void main();

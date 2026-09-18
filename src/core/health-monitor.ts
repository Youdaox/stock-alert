import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Db } from '../db/client.js';
import { notifications, sources } from '../db/schema.js';
import { findStaleSources, formatStaleMessage } from './health.js';

export interface HealthMonitorDeps {
  db: Db;
  logger: Logger;
  channels: readonly string[];
  staleAfterMinutes: number;
  intervalMs: number;
}

/** Watches the tracker's own sources and queues a warning when one stops succeeding. */
export class HealthMonitor {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  public constructor(private readonly deps: HealthMonitorDeps) {}

  public start(): void {
    if (this.deps.staleAfterMinutes <= 0) {
      this.deps.logger.info('source health warnings are disabled');
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.deps.intervalMs);
    void this.tick();
  }

  public stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  public async tick(): Promise<void> {
    if (this.busy || this.deps.channels.length === 0) {
      return;
    }
    this.busy = true;

    const { db, logger, staleAfterMinutes } = this.deps;
    const now = new Date();

    try {
      const rows = await db
        .select({
          key: sources.key,
          name: sources.name,
          lastSuccessAt: sources.lastSuccessAt,
          createdAt: sources.createdAt,
          consecutiveFailures: sources.consecutiveFailures,
          lastError: sources.lastError,
        })
        .from(sources)
        .where(eq(sources.enabled, true));

      const stale = findStaleSources(rows, now, staleAfterMinutes);
      if (stale.length === 0) {
        return;
      }

      // Don't repeat a warning while the same outage is still going.
      const since = new Date(now.getTime() - staleAfterMinutes * 60_000);
      const titles = stale.map((report) => formatStaleMessage(report).title);
      const recent = await db
        .select({ title: notifications.title })
        .from(notifications)
        .where(and(inArray(notifications.title, titles), gte(notifications.createdAt, since)));
      const alreadyWarned = new Set(recent.map((row) => row.title));

      const values = stale
        .map((report) => ({ report, message: formatStaleMessage(report) }))
        .filter(({ message }) => !alreadyWarned.has(message.title))
        .flatMap(({ message }) =>
          this.deps.channels.map((channel) => ({ channel, title: message.title, body: message.body })),
        );

      if (values.length > 0) {
        await db.insert(notifications).values(values);
        logger.warn({ sources: stale.map((report) => report.key) }, 'queued source health warnings');
      }
    } catch (error) {
      logger.error({ err: error }, 'health check failed');
    } finally {
      this.busy = false;
    }
  }
}

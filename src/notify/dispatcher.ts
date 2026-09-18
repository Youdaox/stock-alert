import { and, asc, eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Db } from '../db/client.js';
import { locations, notifications, products, sources, stockEvents } from '../db/schema.js';
import type { HttpPolicy } from '../core/http.js';
import { sendDiscordWebhook } from './discord.js';

export interface DispatcherDeps {
  db: Db;
  logger: Logger;
  http: HttpPolicy;
  discordWebhookUrl: string | undefined;
  intervalMs: number;
}

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
// Discord allows roughly 5 webhook messages per 2 seconds.
const SEND_SPACING_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends queued notifications from the database outbox, so alerts survive restarts. */
export class NotificationDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  public constructor(private readonly deps: DispatcherDeps) {}

  public start(): void {
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
    if (this.busy) {
      return;
    }
    this.busy = true;

    const { db, logger } = this.deps;

    try {
      const pending = await db
        .select({
          id: notifications.id,
          channel: notifications.channel,
          attempts: notifications.attempts,
          kind: stockEvents.kind,
          prev: stockEvents.prev,
          next: stockEvents.next,
          occurredAt: stockEvents.occurredAt,
          productId: products.id,
          title: products.title,
          url: products.url,
          imageUrl: products.imageUrl,
          storeName: sources.name,
          locationName: locations.name,
        })
        .from(notifications)
        .innerJoin(stockEvents, eq(stockEvents.id, notifications.eventId))
        .innerJoin(products, eq(products.id, stockEvents.productId))
        .innerJoin(sources, eq(sources.id, products.sourceId))
        .leftJoin(locations, eq(locations.id, stockEvents.locationId))
        .where(eq(notifications.status, 'pending'))
        .orderBy(asc(notifications.id))
        .limit(BATCH_SIZE);

      for (const row of pending) {
        const attempts = row.attempts + 1;

        // One notification stands for every store that changed in the same check, so gather them.
        const siblings = await db
          .select({ name: locations.name, kind: locations.kind })
          .from(stockEvents)
          .innerJoin(locations, eq(locations.id, stockEvents.locationId))
          .where(
            and(
              eq(stockEvents.productId, row.productId),
              eq(stockEvents.kind, row.kind),
              eq(stockEvents.occurredAt, row.occurredAt),
            ),
          );
        const locationNames = siblings
          .filter((location) => location.kind === 'physical')
          .map((location) => location.name)
          .sort((a, b) => a.localeCompare(b));

        try {
          if (row.channel !== 'discord' || !this.deps.discordWebhookUrl) {
            throw new Error(`channel "${row.channel}" is not configured`);
          }

          await sendDiscordWebhook(
            this.deps.discordWebhookUrl,
            {
              kind: row.kind,
              title: row.title,
              url: row.url,
              imageUrl: row.imageUrl,
              storeName: row.storeName,
              locationNames,
              status: row.next.status,
              priceCents: row.next.priceCents,
              prevPriceCents: row.prev?.priceCents ?? null,
              occurredAt: row.occurredAt,
            },
            this.deps.http,
          );

          await db
            .update(notifications)
            .set({ status: 'sent', attempts, sentAt: new Date(), lastError: null })
            .where(eq(notifications.id, row.id));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn({ notificationId: row.id, attempts, err: error }, 'notification send failed');
          await db
            .update(notifications)
            .set({ attempts, lastError: message, status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' })
            .where(eq(notifications.id, row.id));
        }

        await sleep(SEND_SPACING_MS);
      }
    } catch (error) {
      logger.error({ err: error }, 'notification dispatch failed');
    } finally {
      this.busy = false;
    }
  }
}

import { and, asc, eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Db } from '../db/client.js';
import { locations, notifications, products, sources, stockEvents } from '../db/schema.js';
import type { HttpPolicy } from '../core/http.js';
import { sendDiscordMessage, sendDiscordWebhook, type AlertDetails } from './discord.js';
import { sendNtfy, sendNtfyMessage } from './ntfy.js';

export interface DispatcherDeps {
  db: Db;
  logger: Logger;
  http: HttpPolicy;
  discordWebhookUrl: string | undefined;
  ntfyTopicUrl: string | undefined;
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
          messageTitle: notifications.title,
          messageBody: notifications.body,
          kind: stockEvents.kind,
          prev: stockEvents.prev,
          next: stockEvents.next,
          occurredAt: stockEvents.occurredAt,
          productId: products.id,
          title: products.title,
          url: products.url,
          imageUrl: products.imageUrl,
          storeName: sources.name,
        })
        .from(notifications)
        // Left joins: a health warning has no stock event behind it.
        .leftJoin(stockEvents, eq(stockEvents.id, notifications.eventId))
        .leftJoin(products, eq(products.id, stockEvents.productId))
        .leftJoin(sources, eq(sources.id, products.sourceId))
        .where(eq(notifications.status, 'pending'))
        .orderBy(asc(notifications.id))
        .limit(BATCH_SIZE);

      for (const row of pending) {
        const attempts = row.attempts + 1;

        try {
          if (row.kind && row.next && row.title && row.url && row.storeName && row.occurredAt && row.productId) {
            const alert: AlertDetails = {
              kind: row.kind,
              title: row.title,
              url: row.url,
              imageUrl: row.imageUrl,
              storeName: row.storeName,
              locationNames: await this.storesFor(row.productId, row.kind, row.occurredAt),
              status: row.next.status,
              priceCents: row.next.priceCents,
              prevPriceCents: row.prev?.priceCents ?? null,
              occurredAt: row.occurredAt,
            };
            await this.sendAlert(row.channel, alert);
          } else {
            await this.sendMessage(row.channel, {
              title: row.messageTitle ?? 'stock-alert',
              body: row.messageBody ?? '',
            });
          }

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

  /** One notification stands for every store that changed in the same check, so gather them. */
  private async storesFor(productId: number, kind: string, occurredAt: Date): Promise<string[]> {
    const siblings = await this.deps.db
      .select({ name: locations.name, kind: locations.kind })
      .from(stockEvents)
      .innerJoin(locations, eq(locations.id, stockEvents.locationId))
      .where(
        and(
          eq(stockEvents.productId, productId),
          eq(stockEvents.kind, kind as never),
          eq(stockEvents.occurredAt, occurredAt),
        ),
      );

    return siblings
      .filter((location) => location.kind === 'physical')
      .map((location) => location.name)
      .sort((a, b) => a.localeCompare(b));
  }

  private async sendAlert(channel: string, alert: AlertDetails): Promise<void> {
    if (channel === 'discord' && this.deps.discordWebhookUrl) {
      await sendDiscordWebhook(this.deps.discordWebhookUrl, alert, this.deps.http);
      return;
    }
    if (channel === 'ntfy' && this.deps.ntfyTopicUrl) {
      await sendNtfy(this.deps.ntfyTopicUrl, alert, this.deps.http);
      return;
    }

    throw new Error(`channel "${channel}" is not configured`);
  }

  private async sendMessage(channel: string, message: { title: string; body: string }): Promise<void> {
    if (channel === 'discord' && this.deps.discordWebhookUrl) {
      await sendDiscordMessage(this.deps.discordWebhookUrl, message, this.deps.http);
      return;
    }
    if (channel === 'ntfy' && this.deps.ntfyTopicUrl) {
      await sendNtfyMessage(this.deps.ntfyTopicUrl, message, this.deps.http);
      return;
    }

    throw new Error(`channel "${channel}" is not configured`);
  }
}

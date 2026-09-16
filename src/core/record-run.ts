import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import type { AdapterResult } from '../adapters/types.js';
import type { Db, Source } from '../db/client.js';
import { locations, notifications, products, sources, stockEvents, stockState } from '../db/schema.js';
import { categorize, detectLanguage } from './catalog.js';
import { differ, stockKey, type DiffObservation, type EventKind, type StockSnapshot } from './differ.js';

export const ALERT_KINDS: ReadonlySet<EventKind> = new Set(['NEW_PRODUCT', 'RESTOCK', 'PRICE_DROP']);

export interface AlertCandidate {
  id: number;
  kind: EventKind;
  productId: number;
  locationId: number | null;
}

const alertKey = (event: Pick<AlertCandidate, 'productId' | 'locationId'>): string =>
  `${event.productId}:${event.locationId ?? 'none'}`;

/**
 * Picks the events worth alerting on: skips restocks inside the cooldown, and folds a price drop
 * into the restock alert for the same product rather than sending two messages.
 */
export function selectAlertableEvents(
  events: readonly AlertCandidate[],
  recentlyRestockedProductIds: ReadonlySet<number>,
): AlertCandidate[] {
  const kept = events.filter(
    (event) => ALERT_KINDS.has(event.kind) && !(event.kind === 'RESTOCK' && recentlyRestockedProductIds.has(event.productId)),
  );
  const restocked = new Set(kept.filter((event) => event.kind === 'RESTOCK').map(alertKey));

  return kept.filter((event) => !(event.kind === 'PRICE_DROP' && restocked.has(alertKey(event))));
}

export interface RecordRunOptions {
  channels: readonly string[];
  restockCooldownHours: number;
  now?: Date;
}

export interface RecordRunSummary {
  baseline: boolean;
  products: number;
  events: number;
  notifications: number;
}

const CHUNK_SIZE = 500;

function chunk<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    chunks.push(items.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

/** Saves one successful check of a source and queues alerts, all in one transaction. */
export async function recordRun(
  db: Db,
  source: Source,
  result: AdapterResult,
  options: RecordRunOptions,
): Promise<RecordRunSummary> {
  const now = options.now ?? new Date();
  const baseline = source.lastSuccessAt === null;

  return db.transaction(async (tx) => {
    const locationIds = new Map<string, number>();
    if (result.locations.length > 0) {
      const rows = await tx
        .insert(locations)
        .values(
          result.locations.map((location) => ({
            sourceId: source.id,
            externalId: location.externalId,
            name: location.name,
            kind: location.kind,
            region: location.region ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [locations.sourceId, locations.externalId],
          set: { name: sql`excluded.name`, region: sql`excluded.region` },
        })
        .returning({ id: locations.id, externalId: locations.externalId });
      rows.forEach((row) => locationIds.set(row.externalId, row.id));
    }

    const existingRows = await tx
      .select({ externalId: products.externalId })
      .from(products)
      .where(eq(products.sourceId, source.id));
    const existingIds = new Set(existingRows.map((row) => row.externalId));

    const productIds = new Map<string, number>();
    for (const batch of chunk(result.products)) {
      const rows = await tx
        .insert(products)
        .values(
          batch.map((product) => ({
            sourceId: source.id,
            externalId: product.externalId,
            groupExternalId: product.groupExternalId ?? null,
            title: product.title,
            url: product.url,
            imageUrl: product.imageUrl ?? null,
            productType: product.productType ?? null,
            category: categorize(product.title, product.productType),
            language: detectLanguage(product.title, product.tags),
            firstSeenAt: now,
            lastSeenAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [products.sourceId, products.externalId],
          set: {
            groupExternalId: sql`excluded.group_external_id`,
            title: sql`excluded.title`,
            url: sql`excluded.url`,
            imageUrl: sql`excluded.image_url`,
            productType: sql`excluded.product_type`,
            category: sql`excluded.category`,
            language: sql`excluded.language`,
            lastSeenAt: sql`excluded.last_seen_at`,
          },
        })
        .returning({ id: products.id, externalId: products.externalId });
      rows.forEach((row) => productIds.set(row.externalId, row.id));
    }

    const prevRows = await tx
      .select({
        productExternalId: products.externalId,
        locationExternalId: locations.externalId,
        status: stockState.status,
        priceCents: stockState.priceCents,
        quantity: stockState.quantity,
        changedAt: stockState.changedAt,
      })
      .from(stockState)
      .innerJoin(products, eq(products.id, stockState.productId))
      .innerJoin(locations, eq(locations.id, stockState.locationId))
      .where(eq(products.sourceId, source.id));

    const prevSnapshots = new Map<string, StockSnapshot>();
    const prevChangedAt = new Map<string, Date>();
    for (const row of prevRows) {
      const key = stockKey(row.productExternalId, row.locationExternalId);
      prevSnapshots.set(key, {
        status: row.status,
        priceCents: row.priceCents,
        ...(row.quantity !== null ? { quantity: row.quantity } : {}),
      });
      prevChangedAt.set(key, row.changedAt);
    }

    const priceByProduct = new Map(result.products.map((product) => [product.externalId, product.priceCents]));
    const diffObservations: DiffObservation[] = result.observations.map((observation) => ({
      productExternalId: observation.productExternalId,
      locationExternalId: observation.locationExternalId,
      next: {
        status: observation.status,
        priceCents: priceByProduct.get(observation.productExternalId) ?? null,
        ...(observation.quantity !== undefined ? { quantity: observation.quantity } : {}),
      },
    }));

    const newProductIds = new Set([...productIds.keys()].filter((externalId) => !existingIds.has(externalId)));
    const events = differ(prevSnapshots, diffObservations, { baseline, newProductIds });

    for (const batch of chunk(diffObservations)) {
      const values = batch.flatMap((observation) => {
        const productId = productIds.get(observation.productExternalId);
        const locationId = locationIds.get(observation.locationExternalId);
        if (productId === undefined || locationId === undefined) {
          return [];
        }

        const key = stockKey(observation.productExternalId, observation.locationExternalId);
        const unchanged = prevSnapshots.get(key)?.status === observation.next.status;

        return [
          {
            productId,
            locationId,
            status: observation.next.status,
            priceCents: observation.next.priceCents,
            quantity: observation.next.quantity ?? null,
            lastObservedAt: now,
            changedAt: unchanged ? (prevChangedAt.get(key) ?? now) : now,
          },
        ];
      });

      if (values.length > 0) {
        await tx
          .insert(stockState)
          .values(values)
          .onConflictDoUpdate({
            target: [stockState.productId, stockState.locationId],
            set: {
              status: sql`excluded.status`,
              priceCents: sql`excluded.price_cents`,
              quantity: sql`excluded.quantity`,
              lastObservedAt: sql`excluded.last_observed_at`,
              changedAt: sql`excluded.changed_at`,
            },
          });
      }
    }

    const eventValues = events.flatMap((event) => {
      const productId = productIds.get(event.productExternalId);
      if (productId === undefined) {
        return [];
      }
      return [
        {
          productId,
          locationId: locationIds.get(event.locationExternalId) ?? null,
          kind: event.kind,
          prev: event.prev ?? null,
          next: event.next,
          occurredAt: now,
        },
      ];
    });

    // A product that flickers in and out of stock should not alert on every flip.
    const restockedProductIds = eventValues.filter((event) => event.kind === 'RESTOCK').map((event) => event.productId);
    const recentlyRestocked = new Set<number>();
    if (restockedProductIds.length > 0) {
      const since = new Date(now.getTime() - options.restockCooldownHours * 3_600_000);
      const rows = await tx
        .selectDistinct({ productId: stockEvents.productId })
        .from(stockEvents)
        .where(
          and(
            eq(stockEvents.kind, 'RESTOCK'),
            inArray(stockEvents.productId, restockedProductIds),
            gte(stockEvents.occurredAt, since),
          ),
        );
      rows.forEach((row) => recentlyRestocked.add(row.productId));
    }

    let notificationCount = 0;
    for (const batch of chunk(eventValues)) {
      const inserted = await tx
        .insert(stockEvents)
        .values(batch)
        .returning({
          id: stockEvents.id,
          kind: stockEvents.kind,
          productId: stockEvents.productId,
          locationId: stockEvents.locationId,
        });

      const alertable = selectAlertableEvents(inserted, recentlyRestocked);
      const notificationValues = alertable.flatMap((event) =>
        options.channels.map((channel) => ({ eventId: event.id, channel })),
      );

      if (notificationValues.length > 0) {
        await tx.insert(notifications).values(notificationValues).onConflictDoNothing();
        notificationCount += notificationValues.length;
      }
    }

    await tx
      .update(sources)
      .set({
        lastRunAt: now,
        lastSuccessAt: now,
        lastError: null,
        consecutiveFailures: 0,
        lastProductCount: result.products.length,
        updatedAt: now,
      })
      .where(eq(sources.id, source.id));

    return { baseline, products: result.products.length, events: events.length, notifications: notificationCount };
  });
}

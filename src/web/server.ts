import path from 'node:path';

import fastifyStatic from '@fastify/static';
import { asc, desc, eq, sql } from 'drizzle-orm';
import Fastify from 'fastify';
import type { Logger } from 'pino';
import { z } from 'zod';

import type { Poller } from '../core/poller.js';
import type { Db } from '../db/client.js';
import { locations, products, sources, stockEvents, stockState } from '../db/schema.js';

export interface WebDeps {
  db: Db;
  logger: Logger;
  poller: Poller;
}

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const sourceParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function createWebServer({ db, logger, poller }: WebDeps) {
  // The page polls the API every minute, so keep per-request logs out of the main log.
  const app = Fastify({ loggerInstance: logger.child({ component: 'web' }, { level: 'warn' }) });

  await app.register(fastifyStatic, { root: path.resolve('public') });

  app.get('/api/products', async () => {
    const rows = await db
      .select({
        id: products.id,
        title: products.title,
        url: products.url,
        imageUrl: products.imageUrl,
        category: products.category,
        language: products.language,
        firstSeenAt: products.firstSeenAt,
        sourceId: sources.id,
        storeName: sources.name,
        inStock: sql<boolean>`coalesce(bool_or(${stockState.status} = 'IN_STOCK'), false)`,
        priceCents: sql<number | null>`min(${stockState.priceCents})`,
        changedAt: sql<string | null>`max(${stockState.changedAt})`,
        // A product the store no longer lists keeps its last known state.
        listed: sql<boolean>`${products.lastSeenAt} >= coalesce(${sources.lastSuccessAt}, ${products.lastSeenAt})`,
      })
      .from(products)
      .innerJoin(sources, eq(sources.id, products.sourceId))
      .leftJoin(stockState, eq(stockState.productId, products.id))
      .where(eq(sources.enabled, true))
      .groupBy(products.id, sources.id);

    return { products: rows };
  });

  app.get('/api/events', async (request) => {
    const { limit } = eventsQuerySchema.parse(request.query);

    const rows = await db
      .select({
        id: stockEvents.id,
        kind: stockEvents.kind,
        occurredAt: stockEvents.occurredAt,
        prev: stockEvents.prev,
        next: stockEvents.next,
        productId: products.id,
        title: products.title,
        url: products.url,
        imageUrl: products.imageUrl,
        storeName: sources.name,
        locationName: locations.name,
      })
      .from(stockEvents)
      .innerJoin(products, eq(products.id, stockEvents.productId))
      .innerJoin(sources, eq(sources.id, products.sourceId))
      .leftJoin(locations, eq(locations.id, stockEvents.locationId))
      .orderBy(desc(stockEvents.occurredAt), desc(stockEvents.id))
      .limit(limit);

    return { events: rows };
  });

  app.get('/api/sources', async () => {
    const rows = await db
      .select({
        id: sources.id,
        key: sources.key,
        name: sources.name,
        url: sql<string | null>`${sources.config} ->> 'baseUrl'`,
        enabled: sources.enabled,
        lastRunAt: sources.lastRunAt,
        lastSuccessAt: sources.lastSuccessAt,
        lastError: sources.lastError,
        consecutiveFailures: sources.consecutiveFailures,
        lastProductCount: sources.lastProductCount,
      })
      .from(sources)
      .orderBy(asc(sources.name));

    return { sources: rows.map((row) => ({ ...row, checking: poller.isChecking(row.id) })) };
  });

  app.post('/api/sources/:id/check', async (request, reply) => {
    const { id } = sourceParamsSchema.parse(request.params);
    const [source] = await db.select().from(sources).where(eq(sources.id, id));

    if (!source) {
      return reply.code(404).send({ error: 'source not found' });
    }

    // Pressing the button should check now, even for sources with a minimum interval.
    void poller.pollSource(source, { force: true });
    return reply.code(202).send({ queued: true });
  });

  return app;
}

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AdapterResult, StockStatus } from '../src/adapters/types.js';
import { recordRun } from '../src/core/record-run.js';
import { createDb, type Db, type Source } from '../src/db/client.js';
import { locations, notifications, products, sources, stockEvents } from '../src/db/schema.js';

/**
 * These exercise the one piece that unit tests cannot reach: the transaction that saves a check
 * and queues alerts. They need Postgres, and skip themselves when it is not reachable.
 */
const TEST_DB = 'stock_alert_test';
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const TEST_URL = process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB}`;

async function ensureDatabase(): Promise<boolean> {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    const existing = await client.query('select 1 from pg_database where datname = $1', [TEST_DB]);
    if (existing.rowCount === 0) {
      await client.query(`create database ${TEST_DB}`);
    }
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const databaseReady = await ensureDatabase();

const ONLINE = { externalId: 'online', name: 'Online', kind: 'online' as const };
const STORES = [1, 2, 3].map((id) => ({
  externalId: `store-${id}`,
  name: `Store ${id}`,
  kind: 'physical' as const,
}));

interface ResultOptions {
  online?: StockStatus;
  stores?: StockStatus;
  priceCents?: number | null;
  publishedAt?: Date;
  externalId?: string;
}

function adapterResult(options: ResultOptions = {}): AdapterResult {
  const externalId = options.externalId ?? 'sku-1';
  const observations = [
    { productExternalId: externalId, locationExternalId: ONLINE.externalId, status: options.online ?? 'OUT' },
    ...(options.stores
      ? STORES.map((store) => ({
          productExternalId: externalId,
          locationExternalId: store.externalId,
          status: options.stores as StockStatus,
        }))
      : []),
  ];

  return {
    products: [
      {
        externalId,
        title: 'Prismatic Evolutions Elite Trainer Box',
        url: 'https://shop.test/products/prismatic',
        tags: [],
        priceCents: options.priceCents === undefined ? 8999 : options.priceCents,
        ...(options.publishedAt ? { publishedAt: options.publishedAt } : {}),
      },
    ],
    locations: [ONLINE, ...(options.stores ? STORES : [])],
    observations,
  };
}

describe.skipIf(!databaseReady)('recordRun', () => {
  let db: Db;
  let pool: pg.Pool;

  const options = { channels: ['discord'], restockCooldownHours: 6 };

  const currentSource = async (): Promise<Source> => {
    const [row] = await db.select().from(sources).limit(1);
    if (!row) throw new Error('source missing');
    return row;
  };

  const counts = async () => {
    const events = await db.select().from(stockEvents);
    const queued = await db.select().from(notifications);
    return { events, queued };
  };

  beforeAll(async () => {
    ({ db, pool } = createDb(TEST_URL));
    await migrate(db, { migrationsFolder: 'drizzle' });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('truncate notifications, stock_events, stock_state, products, locations, sources restart identity cascade');
    await db.insert(sources).values({ key: 'test', name: 'Test Store', adapterKey: 'shopify', config: {} });
  });

  it('records the first check as a silent baseline', async () => {
    const summary = await recordRun(db, await currentSource(), adapterResult({ online: 'IN_STOCK' }), options);
    const { events, queued } = await counts();

    expect(summary.baseline).toBe(true);
    expect(await db.select().from(products)).toHaveLength(1);
    expect(events).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it('alerts once when stock comes back online', async () => {
    await recordRun(db, await currentSource(), adapterResult({ online: 'OUT' }), options);
    await recordRun(db, await currentSource(), adapterResult({ online: 'IN_STOCK' }), options);

    const { events, queued } = await counts();
    expect(events.map((event) => event.kind)).toEqual(['RESTOCK']);
    expect(queued).toHaveLength(1);
  });

  it('sends one alert when a delivery lands in many stores', async () => {
    await recordRun(db, await currentSource(), adapterResult({ stores: 'OUT' }), options);
    await recordRun(db, await currentSource(), adapterResult({ stores: 'IN_STOCK' }), options);

    const { events, queued } = await counts();
    // One event per store keeps the history, but the shopper gets a single message.
    expect(events.filter((event) => event.kind === 'RESTOCK')).toHaveLength(3);
    expect(queued).toHaveLength(1);
    expect(await db.select().from(locations)).toHaveLength(4);
  });

  it('stays quiet when nothing changed', async () => {
    await recordRun(db, await currentSource(), adapterResult({ online: 'IN_STOCK' }), options);
    await recordRun(db, await currentSource(), adapterResult({ online: 'IN_STOCK' }), options);

    expect((await counts()).events).toHaveLength(0);
  });

  it('does not treat a product missing from a check as sold out', async () => {
    await recordRun(db, await currentSource(), adapterResult({ online: 'IN_STOCK' }), options);
    await recordRun(db, await currentSource(), adapterResult({ externalId: 'sku-2', online: 'IN_STOCK' }), options);

    const { events } = await counts();
    expect(events.filter((event) => event.kind === 'SOLD_OUT')).toHaveLength(0);
  });

  it('holds back a second restock inside the cooldown', async () => {
    await recordRun(db, await currentSource(), adapterResult({ online: 'OUT' }), options);
    await recordRun(db, await currentSource(), adapterResult({ online: 'IN_STOCK' }), options);
    await recordRun(db, await currentSource(), adapterResult({ online: 'OUT' }), options);
    await recordRun(db, await currentSource(), adapterResult({ online: 'IN_STOCK' }), options);

    const { events, queued } = await counts();
    expect(events.filter((event) => event.kind === 'RESTOCK')).toHaveLength(2);
    expect(queued).toHaveLength(1);
  });

  it('does not announce an old listing that is merely new to the tracker', async () => {
    const longAgo = new Date(Date.now() - 400 * 86_400_000);
    await recordRun(db, await currentSource(), adapterResult({ online: 'IN_STOCK' }), options);
    await recordRun(
      db,
      await currentSource(),
      adapterResult({ externalId: 'sku-old', online: 'IN_STOCK', publishedAt: longAgo }),
      options,
    );

    const { events } = await counts();
    expect(events.filter((event) => event.kind === 'NEW_PRODUCT')).toHaveLength(0);
  });

  it('announces a product the retailer listed recently', async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    await recordRun(db, await currentSource(), adapterResult({ online: 'IN_STOCK' }), options);
    await recordRun(
      db,
      await currentSource(),
      adapterResult({ externalId: 'sku-new', online: 'IN_STOCK', publishedAt: yesterday }),
      options,
    );

    const { events, queued } = await counts();
    expect(events.filter((event) => event.kind === 'NEW_PRODUCT')).toHaveLength(1);
    expect(queued).toHaveLength(1);
  });
});

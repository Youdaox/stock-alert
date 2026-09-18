import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import type { StockStatus } from '../adapters/types.js';
import type { Category, Language } from '../core/catalog.js';
import type { EventKind, StockSnapshot } from '../core/differ.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const sources = pgTable('sources', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  adapterKey: text('adapter_key').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamptz('last_run_at'),
  lastSuccessAt: timestamptz('last_success_at'),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastProductCount: integer('last_product_count'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const locations = pgTable(
  'locations',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').$type<'online' | 'physical'>().notNull(),
    region: text('region'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('locations_source_external_idx').on(table.sourceId, table.externalId)],
);

export const products = pgTable(
  'products',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    groupExternalId: text('group_external_id'),
    title: text('title').notNull(),
    url: text('url').notNull(),
    imageUrl: text('image_url'),
    productType: text('product_type'),
    category: text('category').$type<Category>().notNull(),
    language: text('language').$type<Language>().notNull(),
    /** The retailer's own listing date, where they publish one. */
    publishedAt: timestamptz('published_at'),
    firstSeenAt: timestamptz('first_seen_at').notNull().defaultNow(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('products_source_external_idx').on(table.sourceId, table.externalId)],
);

export const stockState = pgTable(
  'stock_state',
  {
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    locationId: integer('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    status: text('status').$type<StockStatus>().notNull(),
    quantity: integer('quantity'),
    priceCents: integer('price_cents'),
    lastObservedAt: timestamptz('last_observed_at').notNull().defaultNow(),
    changedAt: timestamptz('changed_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.locationId] })],
);

export const stockEvents = pgTable(
  'stock_events',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    locationId: integer('location_id').references(() => locations.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<EventKind>().notNull(),
    prev: jsonb('prev').$type<StockSnapshot>(),
    next: jsonb('next').$type<StockSnapshot>().notNull(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
  },
  (table) => [
    index('stock_events_occurred_idx').on(table.occurredAt),
    index('stock_events_product_kind_idx').on(table.productId, table.kind, table.occurredAt),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    /** Null for notifications that are not about a stock change, such as health warnings. */
    eventId: integer('event_id').references(() => stockEvents.id, { onDelete: 'cascade' }),
    title: text('title'),
    body: text('body'),
    channel: text('channel').notNull(),
    status: text('status').$type<'pending' | 'sent' | 'failed'>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    sentAt: timestamptz('sent_at'),
  },
  (table) => [
    uniqueIndex('notifications_event_channel_idx').on(table.eventId, table.channel),
    index('notifications_status_idx').on(table.status),
  ],
);

import { boolean, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const sources = pgTable('sources', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  adapterKey: text('adapter_key').notNull(),
  configJson: text('config_json').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stores = pgTable('stores', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  sourceId: integer('source_id').notNull().references(() => sources.id),
  externalId: text('external_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable('products', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  sourceId: integer('source_id').notNull().references(() => sources.id),
  externalId: text('external_id').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stockState = pgTable(
  'stock_state',
  {
    productId: integer('product_id').notNull().references(() => products.id),
    storeId: integer('store_id').notNull().references(() => stores.id),
    available: boolean('available').notNull(),
    quantity: integer('quantity'),
    priceCents: integer('price_cents').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.storeId] })],
);

export const alerts = pgTable('alerts', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id),
  storeId: integer('store_id').references(() => stores.id),
  eventKind: text('event_kind').notNull(),
  payloadJson: text('payload_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const watches = pgTable('watches', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  sourceId: integer('source_id').notNull().references(() => sources.id),
  productExternalId: text('product_external_id').notNull(),
  storeExternalId: text('store_external_id'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

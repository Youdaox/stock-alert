import { sql } from 'drizzle-orm';

import { paperPlusConfigSchema } from '../adapters/paperplus.js';
import { shopifyConfigSchema } from '../adapters/shopify.js';
import { loadConfig } from '../config.js';
import { createDb } from './client.js';
import { sources } from './schema.js';

const SHOPIFY_SOURCES = [
  {
    key: 'thegametree',
    name: 'The Game Tree',
    config: {
      baseUrl: 'https://thegametree.co.nz',
      collections: ['pokemon-tcg-sealed-products'],
      requireKeyword: false,
    },
  },
  {
    key: 'cardmasters',
    name: 'Card Masters',
    config: {
      baseUrl: 'https://cardmasters.co.nz',
      collections: ['pokemon'],
      requireKeyword: false,
    },
  },
  {
    key: 'boostergames',
    name: 'Booster Games',
    config: {
      baseUrl: 'https://www.boostergames.co.nz',
      collections: ['pokemon-tcg'],
      requireKeyword: false,
    },
  },
  {
    key: 'toyworld',
    name: 'Toyworld',
    config: {
      baseUrl: 'https://www.toyworld.co.nz',
      // Mixed-brand collection (Lorcana, Topps, sleeves), so keep the Pokemon keyword filter on.
      collections: ['trading-cards'],
      requireKeyword: true,
    },
  },
];

const OTHER_SOURCES = [
  {
    key: 'paperplus',
    name: 'Paper Plus',
    adapterKey: 'paperplus',
    schema: paperPlusConfigSchema,
    config: {
      baseUrl: 'https://www.paperplus.co.nz',
      // Mixed-brand category (Lorcana, Topps, sleeves), so keep the Pokemon keyword filter on.
      categoryPaths: ['/shop/toys-games-puzzles/collectables-trading-cards/trading-cards'],
      requireKeyword: true,
    },
  },
];

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);

try {
  const rows = [
    ...SHOPIFY_SOURCES.map((source) => {
      shopifyConfigSchema.parse(source.config);
      return { ...source, adapterKey: 'shopify' };
    }),
    ...OTHER_SOURCES.map(({ schema, ...source }) => {
      schema.parse(source.config);
      return source;
    }),
  ];

  await db
    .insert(sources)
    .values(rows)
    .onConflictDoUpdate({
      target: sources.key,
      set: {
        name: sql`excluded.name`,
        adapterKey: sql`excluded.adapter_key`,
        config: sql`excluded.config`,
        updatedAt: sql`now()`,
      },
    });

  // eslint-disable-next-line no-console
  console.log(`seeded ${rows.length} sources`);
} finally {
  await pool.end();
}

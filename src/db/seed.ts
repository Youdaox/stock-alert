import { sql } from 'drizzle-orm';

import { farmersConfigSchema } from '../adapters/farmers.js';
import { paperPlusConfigSchema } from '../adapters/paperplus.js';
import { shopifyConfigSchema } from '../adapters/shopify.js';
import { warehouseConfigSchema } from '../adapters/warehouse.js';
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
      // Hobby stores list new sets first, so check them every minute.
      minIntervalSeconds: 60,
    },
  },
  {
    key: 'cardmasters',
    name: 'Card Masters',
    config: {
      baseUrl: 'https://cardmasters.co.nz',
      collections: ['pokemon'],
      requireKeyword: false,
      minIntervalSeconds: 60,
    },
  },
  {
    key: 'boostergames',
    name: 'Booster Games',
    config: {
      baseUrl: 'https://www.boostergames.co.nz',
      collections: ['pokemon-tcg'],
      requireKeyword: false,
      minIntervalSeconds: 60,
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
      // Six pages per check, so keep it slower than the hobby stores.
      minIntervalSeconds: 600,
    },
  },
  {
    key: 'warehouse',
    name: 'The Warehouse',
    adapterKey: 'warehouse',
    schema: warehouseConfigSchema,
    config: {
      baseUrl: 'https://www.thewarehouse.co.nz',
      // Pokemon-only category, so no keyword filter needed. Product pages are Cloudflare-protected;
      // the category page carries price and the "Find in-store" (not orderable online) badge.
      categoryPaths: ['/c/official-merchandise/pok%C3%A9mon/pokemon-trading-cards'],
      requireKeyword: false,
      // Per-store stock for the user's region; roughly one request per product, so check less often.
      storeRegions: ['NZ-AUK'],
      minIntervalSeconds: 900,
    },
  },
  {
    key: 'farmers',
    name: 'Farmers',
    adapterKey: 'farmers',
    schema: farmersConfigSchema,
    config: {
      baseUrl: 'https://www.farmers.co.nz',
      // Search and listing pages are WAF-denied, so stock is checked on known product pages.
      productPaths: [
        '/toys/games-cards-puzzles/trading-cards/pokemon-trading-card-mega-greninja-ex-prem-coll-7054158',
        '/toys/games-cards-puzzles/pokemon-trading-card-2024-collectors-chest-6910577',
        '/toys/games-cards-puzzles/pokemon-trading-card-combined-powers-premium-collection-6884614',
        '/toys/games-cards-puzzles/pokemon-trading-card-terapagoes-ex-ultra-premium-collection-6930892',
        '/toys/games-cards-puzzles/pokemon-trading-card-paldea-legends-tin-assorted-6812945',
        '/toys/games-cards-puzzles/pokemon-trading-card-paldea-partners-tin-assorted-6843905',
        '/toys/games-cards-puzzles/pokemon-trading-card-scarlet-violet-4-paradox-rift-3-pack-assorted-6853145',
        '/toys/games-cards-puzzles/pokemon-trading-card-tcg-scarlet-violet-blister-assorted-6801517',
      ],
      // Each check opens a visible Chrome window, so keep it well apart from the 5-minute cron.
      minIntervalMinutes: 30,
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

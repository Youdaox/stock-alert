import { parse } from 'node-html-parser';
import { z } from 'zod';

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { isPokemonSealed } from '../core/catalog.js';
import { curlText } from '../core/curl.js';
import { parseStoreAvailability, type StoreAvailability } from './warehouse-stores.js';
import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  LocationRecord,
  ProductRecord,
  StockObservation,
} from './types.js';

export const warehouseConfigSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, '')),
  /** Category paths to read, e.g. /c/official-merchandise/pok%C3%A9mon/pokemon-trading-cards */
  categoryPaths: z.array(z.string().min(1)).min(1),
  /** Salesforce Commerce Cloud page size; one request covers the whole category. */
  pageSize: z.number().int().positive().default(96),
  requestDelayMs: z.number().int().nonnegative().default(1500),
  requireKeyword: z.boolean().default(false),
  /** Regions to check in-store stock for, e.g. NZ-AUK. Empty means online stock only. */
  storeRegions: z.array(z.string().min(1)).default([]),
  storeRequestDelayMs: z.number().int().nonnegative().default(2000),
  /** The store endpoint only answers to a warmed-up session, so cookies are kept here. */
  cookieJar: z.string().default('.cache/warehouse-cookies.txt'),
  userAgent: z
    .string()
    .default(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    ),
});

export type WarehouseConfig = z.infer<typeof warehouseConfigSchema>;

export const ONLINE_LOCATION: LocationRecord = { externalId: 'online', name: 'Online', kind: 'online' };

function priceCentsFrom(text: string): number | null {
  // Sale tiles read "NOW $39.98"; take the first money value either way.
  const match = text.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
  if (!match?.[1]) {
    return null;
  }

  const cents = Math.round(Number(match[1]) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

export function parseWarehouseListing(
  config: Pick<WarehouseConfig, 'baseUrl' | 'requireKeyword'>,
  html: string,
): { products: ProductRecord[]; observations: StockObservation[]; tileCount: number } {
  const root = parse(html);
  const products: ProductRecord[] = [];
  const observations: StockObservation[] = [];
  const tiles = root.querySelectorAll('div.product-tile');

  for (const tile of tiles) {
    const link =
      tile.querySelector('a.link.text-emphasized') ??
      tile.querySelectorAll('a[href*="/p/"]').find((anchor) => anchor.text.trim().length > 0);
    const href = link?.getAttribute('href');
    if (!link || !href) {
      continue;
    }

    const title = link.text.replace(/\s+/g, ' ').trim();
    const externalId = tile.getAttribute('data-pid') ?? href.match(/\/(R\d+)\.html/)?.[1];
    if (!title || !externalId) {
      continue;
    }
    if (!isPokemonSealed({ title, tags: [] }, { requireKeyword: config.requireKeyword })) {
      continue;
    }

    // Badge icons are also <img>, so prefer the catalogue image.
    const imageUrl = tile
      .querySelectorAll('img')
      .map((image) => image.getAttribute('src') ?? '')
      .find((src) => src.includes('/dw/image/'));

    products.push({
      externalId,
      title,
      url: href.startsWith('http') ? href : `${config.baseUrl}${href}`,
      tags: [],
      priceCents: priceCentsFrom(tile.querySelector('.price')?.text ?? tile.text),
      ...(imageUrl ? { imageUrl } : {}),
    });

    observations.push({
      productExternalId: externalId,
      locationExternalId: ONLINE_LOCATION.externalId,
      // "Find in-store" replaces the buy button when an item cannot be ordered online.
      status: /find in-?store/i.test(tile.text) ? 'OUT' : 'IN_STOCK',
    });
  }

  return { products, observations, tileCount: tiles.length };
}

const storeResponseSchema = z.object({ stores: z.string(), serviceUnavailable: z.boolean().optional() });

/** Turns one store panel list into a location and an observation per store. */
export function toStoreRecords(
  productExternalId: string,
  stores: readonly StoreAvailability[],
  region: string,
): { locations: LocationRecord[]; observations: StockObservation[] } {
  const locations: LocationRecord[] = [];
  const observations: StockObservation[] = [];

  for (const store of stores) {
    locations.push({ externalId: `store-${store.storeId}`, name: store.name, kind: 'physical', region });
    observations.push({
      productExternalId,
      locationExternalId: `store-${store.storeId}`,
      status: store.inStock ? 'IN_STOCK' : 'OUT',
    });
  }

  return { locations, observations };
}

export class WarehouseAdapter implements Adapter {
  public readonly key = 'warehouse';

  public async fetch(rawConfig: unknown, ctx: AdapterContext): Promise<AdapterResult> {
    const config = warehouseConfigSchema.parse(rawConfig);
    const headers = {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-NZ,en;q=0.9',
      'upgrade-insecure-requests': '1',
    };

    const products = new Map<string, ProductRecord>();
    const observations = new Map<string, StockObservation>();
    const locations = new Map<string, LocationRecord>([[ONLINE_LOCATION.externalId, ONLINE_LOCATION]]);

    const cookieJar = path.resolve(config.cookieJar);
    await mkdir(path.dirname(cookieJar), { recursive: true });

    for (const categoryPath of config.categoryPaths) {
      const url = `${config.baseUrl}${categoryPath}?sz=${config.pageSize}`;
      await new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));

      // Cloudflare rejects undici here by its TLS fingerprint, so this source goes through curl.
      // This also warms up the session the store-availability endpoint needs.
      const response = await curlText(url, {
        userAgent: config.userAgent,
        headers,
        timeoutMs: ctx.http.timeoutMs,
        cookieJar,
      });

      if (response.status !== 200) {
        throw new Error(`The Warehouse request failed: HTTP ${response.status} for ${url}`);
      }

      const parsed = parseWarehouseListing(config, response.body);
      if (parsed.tileCount === 0) {
        ctx.logger.warn({ url }, 'warehouse category returned no product tiles; markup may have changed');
      }

      for (const product of parsed.products) {
        products.set(product.externalId, product);
      }
      for (const observation of parsed.observations) {
        observations.set(`${observation.productExternalId}::online`, observation);
      }
    }

    for (const region of config.storeRegions) {
      for (const product of products.values()) {
        await new Promise((resolve) => setTimeout(resolve, config.storeRequestDelayMs));

        const url = `${config.baseUrl}/products/stores/region?productId=${encodeURIComponent(product.externalId)}&region=${encodeURIComponent(region)}`;
        const response = await curlText(url, {
          userAgent: config.userAgent,
          headers: { accept: 'application/json, text/javascript', 'x-requested-with': 'XMLHttpRequest' },
          timeoutMs: ctx.http.timeoutMs,
          cookieJar,
          followRedirects: true,
        });

        if (response.status !== 200) {
          ctx.logger.warn(
            { productId: product.externalId, region, status: response.status },
            'warehouse: store availability request failed',
          );
          continue;
        }

        const payload = storeResponseSchema.safeParse(JSON.parse(response.body));
        if (!payload.success || payload.data.serviceUnavailable) {
          ctx.logger.warn({ productId: product.externalId, region }, 'warehouse: store availability unavailable');
          continue;
        }

        const stores = parseStoreAvailability(payload.data.stores);
        const records = toStoreRecords(product.externalId, stores, region);
        for (const location of records.locations) {
          locations.set(location.externalId, location);
        }
        for (const observation of records.observations) {
          observations.set(`${observation.productExternalId}::${observation.locationExternalId}`, observation);
        }
      }
    }

    return {
      products: [...products.values()],
      locations: [...locations.values()],
      observations: [...observations.values()],
    };
  }
}

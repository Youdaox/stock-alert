import { parse } from 'node-html-parser';
import { z } from 'zod';

import { isPokemonSealed } from '../core/catalog.js';
import { requestWithPolicy } from '../core/http.js';
import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  LocationRecord,
  ProductRecord,
  StockObservation,
} from './types.js';

export const paperPlusConfigSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, '')),
  /** Category paths to page through, e.g. /shop/toys-games-puzzles/collectables-trading-cards/trading-cards */
  categoryPaths: z.array(z.string().min(1)).min(1),
  maxPages: z.number().int().positive().default(10),
  requestDelayMs: z.number().int().nonnegative().default(1500),
  requireKeyword: z.boolean().default(true),
});

export type PaperPlusConfig = z.infer<typeof paperPlusConfigSchema>;

export const ONLINE_LOCATION: LocationRecord = { externalId: 'online', name: 'Online', kind: 'online' };

function priceCentsFrom(text: string): number | null {
  const match = text.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
  if (!match?.[1]) {
    return null;
  }

  const cents = Math.round(Number(match[1]) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

/** Paper Plus image URLs carry the product code: /product/2000079546841-1.jpg */
const skuFromImage = (src: string): string | undefined => src.match(/\/product\/(\d{6,})-/)?.[1];

const slugOf = (href: string): string => href.split('?')[0]?.replace(/\/+$/, '').split('/').pop() ?? href;

export function parsePaperPlusListing(
  config: Pick<PaperPlusConfig, 'baseUrl' | 'requireKeyword'>,
  html: string,
): { products: ProductRecord[]; observations: StockObservation[]; tileCount: number } {
  const root = parse(html);
  const products: ProductRecord[] = [];
  const observations: StockObservation[] = [];
  const tiles = root.querySelectorAll('div.item');

  for (const tile of tiles) {
    const link = tile.querySelector('.item-title a') ?? tile.querySelector('a.js-productlink');
    const href = link?.getAttribute('href');
    if (!link || !href) {
      continue;
    }

    const title = (link.getAttribute('title') ?? link.text).replace(/\s+/g, ' ').trim();
    if (!title || !isPokemonSealed({ title, tags: [] }, { requireKeyword: config.requireKeyword })) {
      continue;
    }

    const image = tile.querySelector('img')?.getAttribute('src') ?? undefined;
    const externalId = (image ? skuFromImage(image) : undefined) ?? slugOf(href);
    const priceText = tile.querySelector('.item-price')?.text ?? tile.text;
    const tileText = tile.text.replace(/\s+/g, ' ').toLowerCase();

    products.push({
      externalId,
      title,
      url: href.startsWith('http') ? href : `${config.baseUrl}${href}`,
      tags: [],
      priceCents: priceCentsFrom(priceText),
      ...(image ? { imageUrl: image } : {}),
    });

    observations.push({
      productExternalId: externalId,
      locationExternalId: ONLINE_LOCATION.externalId,
      // Sold-out tiles drop the add-to-cart button.
      status: tileText.includes('add to cart') ? 'IN_STOCK' : 'OUT',
    });
  }

  return { products, observations, tileCount: tiles.length };
}

export class PaperPlusAdapter implements Adapter {
  public readonly key = 'paperplus';

  public async fetch(rawConfig: unknown, ctx: AdapterContext): Promise<AdapterResult> {
    const config = paperPlusConfigSchema.parse(rawConfig);
    const http = { ...ctx.http, delayMs: config.requestDelayMs };

    const products = new Map<string, ProductRecord>();
    const observations = new Map<string, StockObservation>();

    for (const categoryPath of config.categoryPaths) {
      for (let page = 1; page <= config.maxPages; page += 1) {
        const url = `${config.baseUrl}${categoryPath}?page=${page}`;
        const response = await requestWithPolicy(url, { headers: { accept: 'text/html' } }, http);

        if (!response.ok) {
          throw new Error(`Paper Plus request failed: HTTP ${response.status} for ${url}`);
        }

        const parsed = parsePaperPlusListing(config, await response.text());
        for (const product of parsed.products) {
          products.set(product.externalId, product);
        }
        for (const observation of parsed.observations) {
          observations.set(observation.productExternalId, observation);
        }

        // The last page repeats nothing new, so stop as soon as a page has no tiles.
        if (parsed.tileCount === 0) {
          break;
        }
        if (page === config.maxPages) {
          ctx.logger.warn({ url }, 'paperplus maxPages reached; listing may be truncated');
        }
      }
    }

    return {
      products: [...products.values()],
      locations: [ONLINE_LOCATION],
      observations: [...observations.values()],
    };
  }
}

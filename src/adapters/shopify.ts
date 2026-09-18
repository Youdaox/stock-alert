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

export const shopifyConfigSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, '')),
  /** Collection handles to read. Empty reads the whole catalogue via /products.json. */
  collections: z.array(z.string().min(1)).default([]),
  maxPages: z.number().int().positive().default(20),
  requestDelayMs: z.number().int().nonnegative().default(1000),
  requireKeyword: z.boolean().default(true),
});

export type ShopifyConfig = z.infer<typeof shopifyConfigSchema>;

const shopifyProductSchema = z.object({
  id: z.number(),
  title: z.string(),
  handle: z.string(),
  vendor: z.string().nullish(),
  product_type: z.string().nullish(),
  published_at: z.string().nullish(),
  created_at: z.string().nullish(),
  tags: z
    .union([z.array(z.string()), z.string()])
    .transform((tags) =>
      Array.isArray(tags)
        ? tags
        : tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
    )
    .default([]),
  variants: z.array(
    z.object({
      id: z.number(),
      title: z.string().nullish(),
      price: z.union([z.string(), z.number()]),
      available: z.boolean(),
    }),
  ),
  images: z.array(z.object({ src: z.string() })).default([]),
});

export type ShopifyProduct = z.infer<typeof shopifyProductSchema>;

const shopifyPageSchema = z.object({ products: z.array(shopifyProductSchema) });

export const parseShopifyPage = (payload: unknown): ShopifyProduct[] => shopifyPageSchema.parse(payload).products;

const PAGE_SIZE = 250;

// Some stores price unavailable variants at $9,999 or $99,999 as a placeholder.
const PLACEHOLDER_PRICE_CENTS = 999_900;

export const ONLINE_LOCATION: LocationRecord = { externalId: 'online', name: 'Online', kind: 'online' };

function toCents(price: string | number): number | null {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const cents = Math.round(amount * 100);
  return cents >= PLACEHOLDER_PRICE_CENTS ? null : cents;
}

const absoluteUrl = (src: string): string => (src.startsWith('//') ? `https:${src}` : src);

export function mapShopifyProducts(
  config: Pick<ShopifyConfig, 'baseUrl' | 'requireKeyword'>,
  items: readonly ShopifyProduct[],
): AdapterResult {
  const products: ProductRecord[] = [];
  const observations: StockObservation[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const catalogInput = {
      title: item.title,
      tags: item.tags,
      ...(item.vendor ? { vendor: item.vendor } : {}),
      ...(item.product_type ? { productType: item.product_type } : {}),
    };
    if (!isPokemonSealed(catalogInput, { requireKeyword: config.requireKeyword })) {
      continue;
    }

    const image = item.images[0];
    const hasVariants = item.variants.length > 1;
    const listedAt = item.published_at ?? item.created_at;
    const publishedAt = listedAt ? new Date(listedAt) : undefined;

    for (const variant of item.variants) {
      const externalId = String(variant.id);
      if (seen.has(externalId)) {
        continue;
      }
      seen.add(externalId);

      const variantSuffix =
        hasVariants && variant.title && variant.title !== 'Default Title' ? ` — ${variant.title}` : '';

      products.push({
        externalId,
        groupExternalId: String(item.id),
        title: `${item.title}${variantSuffix}`,
        url: `${config.baseUrl}/products/${item.handle}${hasVariants ? `?variant=${externalId}` : ''}`,
        tags: item.tags,
        priceCents: toCents(variant.price),
        ...(image ? { imageUrl: absoluteUrl(image.src) } : {}),
        ...(item.product_type ? { productType: item.product_type } : {}),
        ...(publishedAt && !Number.isNaN(publishedAt.getTime()) ? { publishedAt } : {}),
      });

      observations.push({
        productExternalId: externalId,
        locationExternalId: ONLINE_LOCATION.externalId,
        status: variant.available ? 'IN_STOCK' : 'OUT',
      });
    }
  }

  return { products, locations: [ONLINE_LOCATION], observations };
}

export class ShopifyAdapter implements Adapter {
  public readonly key = 'shopify';

  public async fetch(rawConfig: unknown, ctx: AdapterContext): Promise<AdapterResult> {
    const config = shopifyConfigSchema.parse(rawConfig);
    const http = { ...ctx.http, delayMs: config.requestDelayMs };
    const paths =
      config.collections.length > 0
        ? config.collections.map((handle) => `/collections/${encodeURIComponent(handle)}/products.json`)
        : ['/products.json'];

    const items = new Map<number, ShopifyProduct>();

    for (const path of paths) {
      for (let page = 1; page <= config.maxPages; page += 1) {
        const url = `${config.baseUrl}${path}?limit=${PAGE_SIZE}&page=${page}`;
        const response = await requestWithPolicy(url, { headers: { accept: 'application/json' } }, http);

        if (!response.ok) {
          throw new Error(`Shopify request failed: HTTP ${response.status} for ${url}`);
        }

        const pageItems = parseShopifyPage(await response.json());
        for (const item of pageItems) {
          items.set(item.id, item);
        }

        if (pageItems.length < PAGE_SIZE) {
          break;
        }
        if (page === config.maxPages) {
          ctx.logger.warn({ url }, 'shopify maxPages reached; catalogue may be truncated');
        }
      }
    }

    return mapShopifyProducts(config, [...items.values()]);
  }
}

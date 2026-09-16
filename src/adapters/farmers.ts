import { chromium } from 'playwright';
import { z } from 'zod';

import { isPokemonSealed } from '../core/catalog.js';
import type {
  Adapter,
  AdapterContext,
  AdapterResult,
  LocationRecord,
  ProductRecord,
  StockObservation,
} from './types.js';

/**
 * Farmers sits behind an Akamai WAF: plain HTTP, search and listing pages are all denied, but
 * product pages render in a real browser and carry JSON-LD with sku, price and availability.
 * So this adapter drives Chrome over a fixed list of product URLs rather than discovering them.
 */
export const farmersConfigSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, '')),
  productPaths: z.array(z.string().min(1)).min(1),
  /** Skip the whole check if it ran this recently; the poller reads this too. */
  minIntervalMinutes: z.number().int().nonnegative().default(30),
  requestDelayMs: z.number().int().nonnegative().default(3000),
  pageTimeoutMs: z.number().int().positive().default(60_000),
  /** The user wants the window visible; a headless Chrome is also more likely to be blocked. */
  headless: z.boolean().default(false),
  requireKeyword: z.boolean().default(false),
});

export type FarmersConfig = z.infer<typeof farmersConfigSchema>;

export const ONLINE_LOCATION: LocationRecord = { externalId: 'online', name: 'Online', kind: 'online' };

const jsonLdProductSchema = z.object({
  '@type': z.literal('Product'),
  name: z.string(),
  sku: z.union([z.string(), z.number()]).transform(String),
  image: z.union([z.string(), z.array(z.string())]).optional(),
  offers: z
    .object({
      price: z.union([z.string(), z.number()]).optional(),
      availability: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
});

export interface FarmersProduct {
  product: ProductRecord;
  observation: StockObservation;
}

/** Reads the product out of a page's JSON-LD blocks. Returns null when there is no product block. */
export function parseFarmersJsonLd(blocks: readonly string[], pageUrl: string): FarmersProduct | null {
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }

    const result = jsonLdProductSchema.safeParse(parsed);
    if (!result.success) {
      continue;
    }

    const { name, sku, image, offers } = result.data;
    const priceCents = offers?.price === undefined ? null : Math.round(Number(offers.price) * 100);
    const imageUrl = Array.isArray(image) ? image[0] : image;

    return {
      product: {
        externalId: sku,
        title: name,
        url: offers?.url ?? pageUrl,
        tags: [],
        priceCents: priceCents !== null && Number.isFinite(priceCents) && priceCents > 0 ? priceCents : null,
        ...(imageUrl ? { imageUrl } : {}),
      },
      observation: {
        productExternalId: sku,
        locationExternalId: ONLINE_LOCATION.externalId,
        status: /InStock/i.test(offers?.availability ?? '') ? 'IN_STOCK' : 'OUT',
      },
    };
  }

  return null;
}

export class FarmersAdapter implements Adapter {
  public readonly key = 'farmers';

  public async fetch(rawConfig: unknown, ctx: AdapterContext): Promise<AdapterResult> {
    const config = farmersConfigSchema.parse(rawConfig);
    const products: ProductRecord[] = [];
    const observations: StockObservation[] = [];

    const browser = await chromium.launch({
      channel: 'chrome',
      headless: config.headless,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    });

    try {
      const context = await browser.newContext({
        locale: 'en-NZ',
        timezoneId: 'Pacific/Auckland',
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();

      for (const productPath of config.productPaths) {
        const url = `${config.baseUrl}${productPath}`;
        await new Promise((resolve) => setTimeout(resolve, config.requestDelayMs));

        try {
          const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.pageTimeoutMs });
          const status = response?.status() ?? 0;
          if (status !== 200) {
            ctx.logger.warn({ url, status }, 'farmers: product page not served');
            continue;
          }

          const blocks = await page.evaluate(() =>
            [...document.querySelectorAll('script[type="application/ld+json"]')].map((node) => node.textContent ?? ''),
          );

          const parsed = parseFarmersJsonLd(blocks, url);
          if (!parsed) {
            ctx.logger.warn({ url }, 'farmers: no product JSON-LD on the page');
            continue;
          }
          if (!isPokemonSealed({ title: parsed.product.title, tags: [] }, { requireKeyword: config.requireKeyword })) {
            continue;
          }

          products.push(parsed.product);
          observations.push(parsed.observation);
        } catch (error) {
          // One bad URL should not lose the whole check.
          ctx.logger.warn({ url, err: error }, 'farmers: product page failed');
        }
      }
    } finally {
      await browser.close();
    }

    if (products.length === 0) {
      throw new Error('Farmers check returned no products; every product page failed');
    }

    return { products, locations: [ONLINE_LOCATION], observations };
  }
}

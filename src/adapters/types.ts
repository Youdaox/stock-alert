import type { Logger } from 'pino';

import type { HttpPolicy } from '../core/http.js';

export type StockStatus = 'IN_STOCK' | 'OUT';

export interface ProductRecord {
  /** Stock is tracked at this level (a Shopify variant, a Kmart keycode). */
  externalId: string;
  /** Parent listing, e.g. the Shopify product that owns the variant. */
  groupExternalId?: string;
  title: string;
  url: string;
  imageUrl?: string;
  productType?: string;
  tags: string[];
  priceCents: number | null;
}

export interface LocationRecord {
  externalId: string;
  name: string;
  kind: 'online' | 'physical';
  region?: string;
}

export interface StockObservation {
  productExternalId: string;
  locationExternalId: string;
  status: StockStatus;
  quantity?: number;
}

export interface AdapterResult {
  products: ProductRecord[];
  locations: LocationRecord[];
  observations: StockObservation[];
}

export interface AdapterContext {
  http: HttpPolicy;
  logger: Logger;
}

export interface Adapter {
  key: string;
  fetch(config: unknown, ctx: AdapterContext): Promise<AdapterResult>;
}

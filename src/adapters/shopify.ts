import type { Adapter, Snapshot } from './types.js';
import type { HttpPolicy } from '../core/http.js';
import { requestWithPolicy } from '../core/http.js';

export interface ShopifyAdapterConfig {
  collectionsUrl: string;
  http: HttpPolicy;
}

export class ShopifyAdapter implements Adapter<ShopifyAdapterConfig> {
  public readonly key = 'shopify';

  public async fetch(cfg: ShopifyAdapterConfig): Promise<Snapshot[]> {
    const response = await requestWithPolicy(cfg.collectionsUrl, {}, cfg.http);

    if (!response.ok) {
      throw new Error(`Shopify adapter request failed: ${response.status}`);
    }

    // TODO: Parse Shopify catalog payload and map records into Snapshot[].
    return [];
  }
}

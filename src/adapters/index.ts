import { ShopifyAdapter } from './shopify.js';
import type { Adapter } from './types.js';

const adapters: Adapter[] = [new ShopifyAdapter()];

export const adapterRegistry = new Map<string, Adapter>(adapters.map((adapter) => [adapter.key, adapter]));

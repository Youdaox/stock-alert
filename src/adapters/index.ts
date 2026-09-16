import { FarmersAdapter } from './farmers.js';
import { PaperPlusAdapter } from './paperplus.js';
import { ShopifyAdapter } from './shopify.js';
import type { Adapter } from './types.js';
import { WarehouseAdapter } from './warehouse.js';

const adapters: Adapter[] = [
  new ShopifyAdapter(),
  new PaperPlusAdapter(),
  new WarehouseAdapter(),
  new FarmersAdapter(),
];

export const adapterRegistry = new Map<string, Adapter>(adapters.map((adapter) => [adapter.key, adapter]));

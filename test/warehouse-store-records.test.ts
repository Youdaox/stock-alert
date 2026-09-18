import { describe, expect, it } from 'vitest';

import { toStoreRecords } from '../src/adapters/warehouse.js';
import type { StoreAvailability } from '../src/adapters/warehouse-stores.js';

const stores: StoreAvailability[] = [
  { storeId: '119', name: 'Albany', status: 'IN_STOCK', inStock: true },
  { storeId: '186', name: 'Sylvia Park', status: 'OUT_OF_STOCK', inStock: false },
  { storeId: '193', name: 'Takanini', status: 'LOW_STOCK', inStock: false },
];

describe('toStoreRecords', () => {
  const { locations, observations } = toStoreRecords('R3083239', stores, 'NZ-AUK');

  it('makes one physical location per store, tagged with the region', () => {
    expect(locations).toEqual([
      { externalId: 'store-119', name: 'Albany', kind: 'physical', region: 'NZ-AUK' },
      { externalId: 'store-186', name: 'Sylvia Park', kind: 'physical', region: 'NZ-AUK' },
      { externalId: 'store-193', name: 'Takanini', kind: 'physical', region: 'NZ-AUK' },
    ]);
  });

  it('records the product as in stock only where the store says so', () => {
    expect(observations).toEqual([
      { productExternalId: 'R3083239', locationExternalId: 'store-119', status: 'IN_STOCK' },
      { productExternalId: 'R3083239', locationExternalId: 'store-186', status: 'OUT' },
      { productExternalId: 'R3083239', locationExternalId: 'store-193', status: 'OUT' },
    ]);
  });

  it('handles a region with no stores', () => {
    expect(toStoreRecords('R3083239', [], 'NZ-AUK')).toEqual({ locations: [], observations: [] });
  });
});

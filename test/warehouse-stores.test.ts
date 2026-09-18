import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseStoreAvailability } from '../src/adapters/warehouse-stores.js';

const html = readFileSync(
  path.join(process.cwd(), 'test/fixtures/warehouse/store-availability.R3083239.html'),
  'utf8',
);

describe('parseStoreAvailability', () => {
  const stores = parseStoreAvailability(html);

  it('reads every store panel', () => {
    expect(stores.map((store) => store.name)).toEqual(['Albany', 'Botany Downs', 'Sylvia Park', 'Takanini']);
  });

  it('reads the store id, status, address and phone', () => {
    expect(stores[0]).toEqual({
      storeId: '119',
      name: 'Albany',
      status: 'IN_STOCK',
      inStock: true,
      address: 'The Warehouse Albany Mega Centre, 140 Don McKinnon Drive, Albany, Auckland 0632',
      phone: '09 415 2225',
    });
  });

  it('treats only IN_STOCK as in stock, keeping the raw status', () => {
    expect(stores.map((store) => [store.status, store.inStock])).toEqual([
      ['IN_STOCK', true],
      ['IN_STOCK', true],
      ['OUT_OF_STOCK', false],
      ['LOW_STOCK', false],
    ]);
  });

  it('returns nothing for markup with no store panels', () => {
    expect(parseStoreAvailability('<div class="empty"></div>')).toEqual([]);
  });
});

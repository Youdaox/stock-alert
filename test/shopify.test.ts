import { describe, expect, it } from 'vitest';

import { mapShopifyProducts, parseShopifyPage } from '../src/adapters/shopify.js';

const config = { baseUrl: 'https://shop.example.nz', requireKeyword: false };

// Shapes mirror real /products.json responses from NZ Shopify stores.
const page = {
  products: [
    {
      id: 1001,
      title: 'Black Bolt Elite Trainer Box',
      handle: 'black-bolt-elite-trainer-box',
      vendor: 'Pokemon',
      product_type: 'Elite Trainer Box',
      tags: ['Black Bolt', 'Elite Trainer Box'],
      variants: [{ id: 5001, title: 'Default Title', price: '139.95', available: true }],
      images: [{ src: '//cdn.shopify.com/black-bolt.png' }],
    },
    {
      id: 1002,
      title: 'Potion - Perfect Order - 083/088 - Common',
      handle: 'potion',
      vendor: 'The Game Tree',
      product_type: '',
      tags: ['Perfect Order', 'Pokemon', 'Single'],
      variants: [{ id: 5002, title: 'Default Title', price: '0.90', available: true }],
      images: [],
    },
    {
      id: 1003,
      title: 'Mega Evolution Booster Bundle',
      handle: 'mega-evolution-booster-bundle',
      vendor: 'Pokemon',
      product_type: 'Booster Bundle',
      tags: 'Booster Bundle, Mega Evolution',
      variants: [
        { id: 5003, title: 'English', price: '69.95', available: false },
        { id: 5004, title: 'Japanese', price: '99999.00', available: false },
      ],
    },
  ],
};

describe('mapShopifyProducts', () => {
  const result = mapShopifyProducts(config, parseShopifyPage(page));

  it('keeps sealed products and drops singles', () => {
    expect(result.products.map((product) => product.externalId)).toEqual(['5001', '5003', '5004']);
  });

  it('maps a single-variant product', () => {
    expect(result.products[0]).toEqual({
      externalId: '5001',
      groupExternalId: '1001',
      title: 'Black Bolt Elite Trainer Box',
      url: 'https://shop.example.nz/products/black-bolt-elite-trainer-box',
      imageUrl: 'https://cdn.shopify.com/black-bolt.png',
      productType: 'Elite Trainer Box',
      tags: ['Black Bolt', 'Elite Trainer Box'],
      priceCents: 13995,
    });
  });

  it('names and links variants, parses comma-separated tags, and ignores placeholder prices', () => {
    const [english, japanese] = result.products.slice(1);

    expect(english?.title).toBe('Mega Evolution Booster Bundle — English');
    expect(english?.url).toBe('https://shop.example.nz/products/mega-evolution-booster-bundle?variant=5003');
    expect(english?.tags).toEqual(['Booster Bundle', 'Mega Evolution']);
    expect(english?.priceCents).toBe(6995);
    expect(japanese?.priceCents).toBeNull();
  });

  it('reports online stock for every kept variant', () => {
    expect(result.locations).toEqual([{ externalId: 'online', name: 'Online', kind: 'online' }]);
    expect(result.observations).toEqual([
      { productExternalId: '5001', locationExternalId: 'online', status: 'IN_STOCK' },
      { productExternalId: '5003', locationExternalId: 'online', status: 'OUT' },
      { productExternalId: '5004', locationExternalId: 'online', status: 'OUT' },
    ]);
  });
});

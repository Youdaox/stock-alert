import { describe, expect, it } from 'vitest';

import { parseFarmersJsonLd } from '../src/adapters/farmers.js';

const pageUrl = 'https://www.farmers.co.nz/toys/games-cards-puzzles/trading-cards/pokemon-mega-greninja-7054158';

// Copied from a real farmers.co.nz product page.
const productBlock = JSON.stringify({
  '@context': 'https://schema.org/',
  '@type': 'Product',
  name: 'Pokemon Trading Card Mega Greninja Ex Prem Coll',
  image: ['https://www.farmers.co.nz/INTERSHOP/static/product/70/54/158/7054158_00_W1200_H1565.jpg'],
  description: 'Mega Greninja ex Flips the Battle Upside Down!',
  sku: '7054158',
  gtin14: '196214155923',
  brand: { '@type': 'Brand', name: 'Pokemon Trading Card' },
  offers: {
    '@type': 'Offer',
    url: pageUrl,
    priceCurrency: 'NZD',
    price: '99.99',
    availability: 'https://schema.org/InStock',
  },
});

const websiteBlock = JSON.stringify({ '@context': 'http://schema.org', '@type': 'WebSite', url: 'https://www.farmers.co.nz/' });

describe('parseFarmersJsonLd', () => {
  it('reads the product, price and image, skipping non-product blocks', () => {
    const parsed = parseFarmersJsonLd([websiteBlock, productBlock], pageUrl);

    expect(parsed?.product).toEqual({
      externalId: '7054158',
      title: 'Pokemon Trading Card Mega Greninja Ex Prem Coll',
      url: pageUrl,
      tags: [],
      priceCents: 9999,
      imageUrl: 'https://www.farmers.co.nz/INTERSHOP/static/product/70/54/158/7054158_00_W1200_H1565.jpg',
    });
  });

  it('maps schema.org availability to stock status', () => {
    expect(parseFarmersJsonLd([productBlock], pageUrl)?.observation).toEqual({
      productExternalId: '7054158',
      locationExternalId: 'online',
      status: 'IN_STOCK',
    });

    const soldOut = productBlock.replace('schema.org/InStock', 'schema.org/OutOfStock');
    expect(parseFarmersJsonLd([soldOut], pageUrl)?.observation.status).toBe('OUT');
  });

  it('returns null when the page has no product block or invalid JSON', () => {
    expect(parseFarmersJsonLd([websiteBlock], pageUrl)).toBeNull();
    expect(parseFarmersJsonLd(['{not json'], pageUrl)).toBeNull();
    expect(parseFarmersJsonLd([], pageUrl)).toBeNull();
  });
});

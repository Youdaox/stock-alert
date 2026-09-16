import { describe, expect, it } from 'vitest';

import { parseWarehouseListing } from '../src/adapters/warehouse.js';

const config = { baseUrl: 'https://www.thewarehouse.co.nz', requireKeyword: true };

// Markup mirrors a real thewarehouse.co.nz category page tile.
const tile = (options: {
  pid: string;
  title: string;
  href: string;
  price: string;
  findInStore: boolean;
}): string => `
<div class="product-tile" data-pid="${options.pid}" data-test-id="product-tile">
  <section class="product-tile-image">
    <div class="image-container product-badge">
      <a href="${options.href}">
        <img src="https://www.thewarehouse.co.nz/dw/image/v2/BDMG_PRD/on/demandware.static/catalog/${options.pid}.jpg" alt="">
      </a>
    </div>
    ${options.findInStore ? '<img src="/on/demandware.static/-/Library-Sites-twl-shared-library/default/core/product-badges/spec.svg" alt=""><div class="badge-text">Find in-store</div>' : ''}
  </section>
  <section class="product-tile-details">
    <div class="price-lockup plp"><div class="price">${options.price}</div></div>
    <a class="link text-emphasized" href="${options.href}">${options.title}</a>
  </section>
</div>`;

const html = `<html><body><div class="product-grid">
${tile({
  pid: 'R3083239',
  title: 'Pokemon ME 5 Pitch Black Blisters LIMIT 10 PER CUSTOMER',
  href: '/p/pokemon-me-5-pitch-black-blisters-limit-10-per-customer/R3083239.html',
  price: '$9.99',
  findInStore: false,
})}
${tile({
  pid: 'R2973100',
  title: 'Pokemon Scarlet & Violet Prismatic Evolutions Elite Trainer Box',
  href: '/p/pokemon-scarlet-violet-prismatic-evolutions-elite-trainer-box/R2973100.html',
  price: 'NOW $39.98',
  findInStore: true,
})}
${tile({
  pid: 'R9999999',
  title: 'Disney Lorcana Shimmering Skies Booster Pack',
  href: '/p/disney-lorcana-shimmering-skies-booster-pack/R9999999.html',
  price: '$10.99',
  findInStore: false,
})}
</div></body></html>`;

describe('parseWarehouseListing', () => {
  const result = parseWarehouseListing(config, html);

  it('counts every tile on the page', () => {
    expect(result.tileCount).toBe(3);
  });

  it('keeps Pokemon products and drops other brands', () => {
    expect(result.products.map((product) => product.externalId)).toEqual(['R3083239', 'R2973100']);
  });

  it('reads the product id, title, url, price and catalogue image', () => {
    expect(result.products[0]).toEqual({
      externalId: 'R3083239',
      title: 'Pokemon ME 5 Pitch Black Blisters LIMIT 10 PER CUSTOMER',
      url: 'https://www.thewarehouse.co.nz/p/pokemon-me-5-pitch-black-blisters-limit-10-per-customer/R3083239.html',
      tags: [],
      priceCents: 999,
      imageUrl: 'https://www.thewarehouse.co.nz/dw/image/v2/BDMG_PRD/on/demandware.static/catalog/R3083239.jpg',
    });
  });

  it('reads a sale price written as "NOW $39.98"', () => {
    expect(result.products[1]?.priceCents).toBe(3998);
  });

  it('treats "Find in-store" as not available online', () => {
    expect(result.observations).toEqual([
      { productExternalId: 'R3083239', locationExternalId: 'online', status: 'IN_STOCK' },
      { productExternalId: 'R2973100', locationExternalId: 'online', status: 'OUT' },
    ]);
  });
});

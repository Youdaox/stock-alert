import { describe, expect, it } from 'vitest';

import { parsePaperPlusListing } from '../src/adapters/paperplus.js';

const config = { baseUrl: 'https://www.paperplus.co.nz', requireKeyword: true };

// Markup mirrors a real paperplus.co.nz trading-cards listing page.
const tile = (options: {
  title: string;
  href: string;
  sku: string;
  price: string;
  addToCart: boolean;
}): string => `
<div class="item">
  <div class="imageContainer">
    <a href="${options.href}" class="js-productlink" title="${options.title} ">
      <img src="https://static-ppimages.freetls.fastly.net/product/${options.sku}-1.jpg?width=300" alt="${options.title}">
    </a>
  </div>
  <div class="item-info">
    <div class="item-info-wrapper">
      <div class="item-title">
        <a href="${options.href}" title="${options.title} " class="js-productlink">${options.title}
        </a>
      </div>
      <div class="item-price">$<span class="dollar">${options.price.split('.')[0]}</span><span class="cent">.${options.price.split('.')[1]}</span></div>
    </div>
    <div class="promo-eta-wrapper">
      <div class="delivery-info"><div class="delivery-info-delivery">Delivered in 3 - 5 days</div></div>
    </div>
  </div>
  <div class="item-btn">${options.addToCart ? '<button class="btn">add to cart</button>' : '<span>out of stock</span>'}</div>
</div>`;

const html = `<html><body><div class="products">
${tile({
  title: 'Pokemon TCG Mega Evolutions 5 Pitch Black Booster',
  href: '/shop/toys-games-puzzles/collectables-trading-cards/trading-cards/pokemon-tcg-mega-evolutions-5-pitch-black-booster',
  sku: '2000079546841',
  price: '10.99',
  addToCart: true,
})}
${tile({
  title: 'Pokemon TCG Mega Evolution Elite Trainer Box',
  href: '/shop/toys-games-puzzles/collectables-trading-cards/trading-cards/pokemon-tcg-mega-evolution-etb',
  sku: '2000079546999',
  price: '139.99',
  addToCart: false,
})}
${tile({
  title: 'Disney Lorcana Trading Cards: Shimmering Skies Booster Pack',
  href: '/shop/toys-games-puzzles/collectables-trading-cards/trading-cards/disney-lorcana-shimmering-skies',
  sku: '2000079547000',
  price: '10.99',
  addToCart: true,
})}
${tile({
  title: 'Ultra Pro 9 Pocket Pages, 10 Pack BB90',
  href: '/shop/toys-games-puzzles/collectables-trading-cards/trading-cards/ultra-pro-9-pocket-pages',
  sku: '2000079547001',
  price: '7.99',
  addToCart: true,
})}
</div></body></html>`;

describe('parsePaperPlusListing', () => {
  const result = parsePaperPlusListing(config, html);

  it('counts every tile on the page', () => {
    expect(result.tileCount).toBe(4);
  });

  it('keeps sealed Pokemon products and drops other brands and accessories', () => {
    expect(result.products.map((product) => product.title)).toEqual([
      'Pokemon TCG Mega Evolutions 5 Pitch Black Booster',
      'Pokemon TCG Mega Evolution Elite Trainer Box',
    ]);
  });

  it('reads the product code, price, url and image', () => {
    expect(result.products[0]).toEqual({
      externalId: '2000079546841',
      title: 'Pokemon TCG Mega Evolutions 5 Pitch Black Booster',
      url: 'https://www.paperplus.co.nz/shop/toys-games-puzzles/collectables-trading-cards/trading-cards/pokemon-tcg-mega-evolutions-5-pitch-black-booster',
      tags: [],
      priceCents: 1099,
      imageUrl:
        'https://static-ppimages.freetls.fastly.net/product/2000079546841-1.jpg?width=300',
    });
  });

  it('treats a missing add-to-cart button as out of stock', () => {
    expect(result.observations).toEqual([
      { productExternalId: '2000079546841', locationExternalId: 'online', status: 'IN_STOCK' },
      { productExternalId: '2000079546999', locationExternalId: 'online', status: 'OUT' },
    ]);
  });
});

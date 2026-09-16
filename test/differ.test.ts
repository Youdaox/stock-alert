import { describe, expect, it } from 'vitest';

import { differ, stockKey, type DiffObservation, type StockSnapshot } from '../src/core/differ.js';

const observe = (next: Partial<StockSnapshot> = {}, productExternalId = 'sku-1'): DiffObservation => ({
  productExternalId,
  locationExternalId: 'online',
  next: { status: 'IN_STOCK', priceCents: 1000, ...next },
});

const prevState = (snapshot: Partial<StockSnapshot> = {}, productExternalId = 'sku-1') =>
  new Map<string, StockSnapshot>([
    [stockKey(productExternalId, 'online'), { status: 'IN_STOCK', priceCents: 1000, ...snapshot }],
  ]);

const noNewProducts = { baseline: false, newProductIds: new Set<string>() };

describe('differ', () => {
  it('emits nothing on a baseline check, even for new products', () => {
    const events = differ(new Map(), [observe()], { baseline: true, newProductIds: new Set(['sku-1']) });

    expect(events).toEqual([]);
  });

  it('emits NEW_PRODUCT once per product, including listings that are not yet in stock', () => {
    const events = differ(
      new Map(),
      [observe({ status: 'OUT' }), { ...observe({ status: 'OUT' }), locationExternalId: 'store-2' }],
      { baseline: false, newProductIds: new Set(['sku-1']) },
    );

    expect(events.map((event) => event.kind)).toEqual(['NEW_PRODUCT']);
  });

  it('emits RESTOCK when stock goes from out to in', () => {
    const events = differ(prevState({ status: 'OUT' }), [observe({ status: 'IN_STOCK' })], noNewProducts);

    expect(events.map((event) => event.kind)).toEqual(['RESTOCK']);
    expect(events[0]?.prev?.status).toBe('OUT');
  });

  it('emits SOLD_OUT when stock goes from in to out', () => {
    const events = differ(prevState(), [observe({ status: 'OUT' })], noNewProducts);

    expect(events.map((event) => event.kind)).toEqual(['SOLD_OUT']);
  });

  it('emits PRICE_DROP when the price decreases', () => {
    const events = differ(prevState({ priceCents: 1200 }), [observe({ priceCents: 1000 })], noNewProducts);

    expect(events.map((event) => event.kind)).toEqual(['PRICE_DROP']);
  });

  it('ignores price changes when either price is unknown', () => {
    const events = differ(prevState({ priceCents: null }), [observe({ priceCents: 1000 })], noNewProducts);

    expect(events).toEqual([]);
  });

  it('does not treat a product missing from the check as sold out', () => {
    const events = differ(prevState({}, 'sku-1'), [observe({}, 'sku-2')], noNewProducts);

    expect(events).toEqual([]);
  });

  it('emits no events when nothing changed', () => {
    const events = differ(prevState(), [observe()], noNewProducts);

    expect(events).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import type { Snapshot } from '../src/adapters/types.js';
import { differ } from '../src/core/differ.js';

const makeSnapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  externalId: 'sku-1',
  title: 'Product',
  url: 'https://example.test/product',
  priceCents: 1000,
  available: true,
  ...overrides,
});

describe('differ', () => {
  it('emits NEW_PRODUCT when product has no previous state', () => {
    const events = differ(new Map(), [makeSnapshot()]);

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('NEW_PRODUCT');
  });

  it('emits RESTOCK when availability changes from false to true', () => {
    const prev = new Map([
      ['sku-1::default', { available: false, priceCents: 1000, quantity: 0 }],
    ]);

    const events = differ(prev, [makeSnapshot({ available: true })]);

    expect(events.map((event) => event.kind)).toContain('RESTOCK');
  });

  it('emits PRICE_DROP when price decreases', () => {
    const prev = new Map([
      ['sku-1::default', { available: true, priceCents: 1200, quantity: 5 }],
    ]);

    const events = differ(prev, [makeSnapshot({ priceCents: 1000 })]);

    expect(events.map((event) => event.kind)).toContain('PRICE_DROP');
  });

  it('emits no events when nothing changed', () => {
    const prev = new Map([
      ['sku-1::default', { available: true, priceCents: 1000, quantity: 5 }],
    ]);

    const events = differ(prev, [makeSnapshot({ priceCents: 1000, available: true, quantity: 5 })]);

    expect(events).toEqual([]);
  });
});

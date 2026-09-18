import { describe, expect, it } from 'vitest';

import { selectAlertableEvents, type AlertCandidate } from '../src/core/record-run.js';
import { formatEmbed } from '../src/notify/discord.js';

const candidate = (overrides: Partial<AlertCandidate> & Pick<AlertCandidate, 'id' | 'kind'>): AlertCandidate => ({
  productId: 1,
  locationId: 10,
  ...overrides,
});

const none = new Set<number>();

describe('selectAlertableEvents', () => {
  it('folds a price drop into the restock alert for the same product and location', () => {
    const events = [
      candidate({ id: 1, kind: 'RESTOCK' }),
      candidate({ id: 2, kind: 'PRICE_DROP' }),
    ];

    expect(selectAlertableEvents(events, none).map((event) => event.id)).toEqual([1]);
  });

  it('keeps a price drop that has no restock beside it', () => {
    const events = [
      candidate({ id: 1, kind: 'RESTOCK', productId: 1 }),
      candidate({ id: 2, kind: 'PRICE_DROP', productId: 2 }),
    ];

    expect(selectAlertableEvents(events, none).map((event) => event.id)).toEqual([1, 2]);
  });

  it('keeps a price drop when the restock is suppressed by the cooldown', () => {
    const events = [
      candidate({ id: 1, kind: 'RESTOCK' }),
      candidate({ id: 2, kind: 'PRICE_DROP' }),
    ];

    expect(selectAlertableEvents(events, new Set([1])).map((event) => event.id)).toEqual([2]);
  });

  it('sends one alert when a product restocks across many stores', () => {
    const shipment = [10, 11, 12, 13].map((locationId, index) =>
      candidate({ id: index + 1, kind: 'RESTOCK', locationId }),
    );

    expect(selectAlertableEvents(shipment, none).map((event) => event.id)).toEqual([1]);
  });

  it('still alerts separately for different products', () => {
    const events = [
      candidate({ id: 1, kind: 'RESTOCK', productId: 1 }),
      candidate({ id: 2, kind: 'RESTOCK', productId: 2 }),
    ];

    expect(selectAlertableEvents(events, none).map((event) => event.id)).toEqual([1, 2]);
  });

  it('keeps a price drop at another location when the restock is elsewhere', () => {
    const events = [
      candidate({ id: 1, kind: 'RESTOCK', locationId: 10 }),
      candidate({ id: 2, kind: 'PRICE_DROP', locationId: 11 }),
    ];

    expect(selectAlertableEvents(events, none).map((event) => event.id)).toEqual([1, 2]);
  });

  it('never alerts on sold out', () => {
    expect(selectAlertableEvents([candidate({ id: 1, kind: 'SOLD_OUT' })], none)).toEqual([]);
  });
});

describe('formatEmbed', () => {
  const alert = {
    kind: 'RESTOCK' as const,
    title: 'Prismatic Evolutions Booster Bundle',
    url: 'https://shop.example.nz/products/prismatic',
    imageUrl: null,
    storeName: 'The Game Tree',
    locationNames: [] as string[],
    status: 'IN_STOCK' as const,
    priceCents: 6995,
    prevPriceCents: 8995,
    occurredAt: new Date('2026-09-16T01:05:03.000Z'),
  };

  it('shows the old price struck through when it dropped, whatever the event kind', () => {
    const [, price] = formatEmbed(alert).fields;

    expect(price?.value).toBe('~~$89.95~~ → **$69.95**');
  });

  it('shows just the price when it did not drop', () => {
    const [, price] = formatEmbed({ ...alert, prevPriceCents: 6995 }).fields;

    expect(price?.value).toBe('$69.95');
  });

  it('names the store, and the branch when a single one is involved', () => {
    expect(formatEmbed(alert).fields[0]?.value).toBe('The Game Tree');
    expect(formatEmbed({ ...alert, locationNames: ['Sylvia Park'] }).fields[0]?.value).toBe(
      'The Game Tree — Sylvia Park',
    );
  });

  it('summarises a multi-store restock and lists the stores', () => {
    const shipment = formatEmbed({
      ...alert,
      storeName: 'The Warehouse',
      locationNames: ['Albany', 'Botany Downs', 'Manukau', 'Sylvia Park'],
    });

    expect(shipment.fields[0]?.value).toBe('The Warehouse — 4 stores');
    expect(shipment.fields[3]?.value).toBe('Albany, Botany Downs, Manukau, Sylvia Park');
  });

  it('trims a very long store list', () => {
    const many = Array.from({ length: 12 }, (_, index) => `Store ${index + 1}`);

    expect(formatEmbed({ ...alert, locationNames: many }).fields[3]?.value).toMatch(/and 4 more$/);
  });
});

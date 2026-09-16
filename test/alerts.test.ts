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

  it('treats different locations of one product separately', () => {
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
    locationName: 'Online',
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

  it('names the store, and the location when it is a physical one', () => {
    expect(formatEmbed(alert).fields[0]?.value).toBe('The Game Tree');
    expect(formatEmbed({ ...alert, locationName: 'Sylvia Park' }).fields[0]?.value).toBe(
      'The Game Tree — Sylvia Park',
    );
  });
});

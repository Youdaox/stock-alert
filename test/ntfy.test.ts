import { describe, expect, it } from 'vitest';

import type { AlertDetails } from '../src/notify/discord.js';
import { formatNtfy } from '../src/notify/ntfy.js';

const alert: AlertDetails = {
  kind: 'RESTOCK',
  title: 'Pokemon ME 5 Pitch Black Elite Trainer Box',
  url: 'https://www.thewarehouse.co.nz/p/pitch-black-etb/R3083224.html',
  imageUrl: null,
  storeName: 'The Warehouse',
  locationNames: [],
  status: 'IN_STOCK',
  priceCents: 11999,
  prevPriceCents: null,
  occurredAt: new Date('2026-09-18T06:00:00Z'),
};

describe('formatNtfy', () => {
  it('sends a restock at the highest priority with the product link', () => {
    const message = formatNtfy(alert);

    expect(message.title).toBe('Back in stock: Pokemon ME 5 Pitch Black Elite Trainer Box');
    expect(message.priority).toBe('5');
    expect(message.click).toBe(alert.url);
    expect(message.body).toBe('$119.99 · The Warehouse');
  });

  it('summarises a multi-store restock and lists the stores', () => {
    const message = formatNtfy({ ...alert, locationNames: ['Albany', 'Botany Downs', 'Manukau'] });

    expect(message.body).toBe('$119.99 · The Warehouse — 3 stores\nAlbany, Botany Downs, Manukau');
  });

  it('shows both prices on a drop, at a calmer priority', () => {
    const message = formatNtfy({ ...alert, kind: 'PRICE_DROP', prevPriceCents: 14999 });

    expect(message.body).toContain('$149.99 → $119.99');
    expect(message.priority).toBe('3');
  });

  it('keeps long titles within the notification limit', () => {
    const message = formatNtfy({ ...alert, title: 'A'.repeat(200) });

    expect(message.title.length).toBeLessThanOrEqual(120);
  });
});

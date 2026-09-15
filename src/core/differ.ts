import type { Snapshot } from '../adapters/types.js';

export interface StockStateRow {
  available: boolean;
  quantity?: number;
  priceCents: number;
}

export interface Event {
  kind: 'NEW_PRODUCT' | 'RESTOCK' | 'PRICE_DROP';
  product: Snapshot;
  store?: string;
  prev?: StockStateRow;
  next: StockStateRow;
}

const keyOf = (snapshot: Pick<Snapshot, 'externalId' | 'storeId'>): string =>
  `${snapshot.externalId}::${snapshot.storeId ?? 'default'}`;

export function differ(
  prev: ReadonlyMap<string, StockStateRow>,
  next: readonly Snapshot[],
): Event[] {
  const events: Event[] = [];

  for (const product of next) {
    const key = keyOf(product);
    const previous = prev.get(key);
    const nextState: StockStateRow = {
      available: product.available,
      priceCents: product.priceCents,
      ...(product.quantity !== undefined ? { quantity: product.quantity } : {}),
    };

    if (!previous) {
      events.push({
        kind: 'NEW_PRODUCT',
        product,
        ...(product.storeId ? { store: product.storeId } : {}),
        next: nextState,
      });
      continue;
    }

    if (!previous.available && product.available) {
      events.push({
        kind: 'RESTOCK',
        product,
        ...(product.storeId ? { store: product.storeId } : {}),
        prev: previous,
        next: nextState,
      });
    }

    if (product.priceCents < previous.priceCents) {
      events.push({
        kind: 'PRICE_DROP',
        product,
        ...(product.storeId ? { store: product.storeId } : {}),
        prev: previous,
        next: nextState,
      });
    }
  }

  return events;
}

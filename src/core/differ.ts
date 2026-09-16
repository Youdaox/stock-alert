import type { StockStatus } from '../adapters/types.js';

export type EventKind = 'NEW_PRODUCT' | 'RESTOCK' | 'SOLD_OUT' | 'PRICE_DROP';

export interface StockSnapshot {
  status: StockStatus;
  priceCents: number | null;
  quantity?: number;
}

export interface DiffObservation {
  productExternalId: string;
  locationExternalId: string;
  next: StockSnapshot;
}

export interface StockEvent {
  kind: EventKind;
  productExternalId: string;
  locationExternalId: string;
  prev?: StockSnapshot;
  next: StockSnapshot;
}

export interface DiffOptions {
  /** First successful check of a source: record state without emitting events. */
  baseline: boolean;
  /** Products that did not exist before this check. */
  newProductIds: ReadonlySet<string>;
}

export const stockKey = (productExternalId: string, locationExternalId: string): string =>
  `${productExternalId}::${locationExternalId}`;

/**
 * Compares the previous stock state with this check's observations.
 * Products missing from `observations` are left alone: missing is not the same as sold out.
 */
export function differ(
  prev: ReadonlyMap<string, StockSnapshot>,
  observations: readonly DiffObservation[],
  options: DiffOptions,
): StockEvent[] {
  if (options.baseline) {
    return [];
  }

  const events: StockEvent[] = [];
  const announced = new Set<string>();

  for (const { productExternalId, locationExternalId, next } of observations) {
    if (options.newProductIds.has(productExternalId)) {
      if (!announced.has(productExternalId)) {
        announced.add(productExternalId);
        events.push({ kind: 'NEW_PRODUCT', productExternalId, locationExternalId, next });
      }
      continue;
    }

    const previous = prev.get(stockKey(productExternalId, locationExternalId));
    if (!previous) {
      continue;
    }

    const change = { productExternalId, locationExternalId, prev: previous, next };

    if (previous.status !== 'IN_STOCK' && next.status === 'IN_STOCK') {
      events.push({ kind: 'RESTOCK', ...change });
    } else if (previous.status === 'IN_STOCK' && next.status !== 'IN_STOCK') {
      events.push({ kind: 'SOLD_OUT', ...change });
    }

    if (previous.priceCents !== null && next.priceCents !== null && next.priceCents < previous.priceCents) {
      events.push({ kind: 'PRICE_DROP', ...change });
    }
  }

  return events;
}

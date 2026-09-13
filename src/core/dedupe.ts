import type { Event } from './differ.js';

export interface DedupeState {
  seen: Set<string>;
}

const dedupeKey = (event: Event): string =>
  `${event.kind}:${event.product.externalId}:${event.store ?? 'default'}:${event.next.priceCents}:${event.next.available}`;

export function dedupeEvents(events: readonly Event[], state: DedupeState): Event[] {
  return events.filter((event) => {
    const key = dedupeKey(event);
    if (state.seen.has(key)) {
      return false;
    }

    state.seen.add(key);
    return true;
  });
}

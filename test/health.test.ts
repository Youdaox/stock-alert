import { describe, expect, it } from 'vitest';

import { findStaleSources, formatStaleMessage, type SourceHealth } from '../src/core/health.js';

const now = new Date('2026-09-18T12:00:00Z');
const minutesAgo = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);

const source = (overrides: Partial<SourceHealth> & Pick<SourceHealth, 'key'>): SourceHealth => ({
  name: overrides.key,
  lastSuccessAt: minutesAgo(5),
  createdAt: minutesAgo(10_000),
  consecutiveFailures: 0,
  lastError: null,
  ...overrides,
});

describe('findStaleSources', () => {
  it('ignores sources that checked recently', () => {
    expect(findStaleSources([source({ key: 'thegametree' })], now, 60)).toEqual([]);
  });

  it('reports a source that has not succeeded within the window', () => {
    const stale = source({ key: 'warehouse', name: 'The Warehouse', lastSuccessAt: minutesAgo(180) });

    expect(findStaleSources([stale], now, 60)).toEqual([
      { key: 'warehouse', name: 'The Warehouse', minutesSinceSuccess: 180, consecutiveFailures: 0, lastError: null },
    ]);
  });

  it('reports a source that has never succeeded, measuring from when it was added', () => {
    const neverRan = source({ key: 'farmers', lastSuccessAt: null, createdAt: minutesAgo(90) });

    expect(findStaleSources([neverRan], now, 60)[0]?.minutesSinceSuccess).toBeNull();
  });

  it('gives a new source time before complaining', () => {
    const justAdded = source({ key: 'new', lastSuccessAt: null, createdAt: minutesAgo(5) });

    expect(findStaleSources([justAdded], now, 60)).toEqual([]);
  });
});

describe('formatStaleMessage', () => {
  it('says how long it has been and why', () => {
    const message = formatStaleMessage({
      key: 'warehouse',
      name: 'The Warehouse',
      minutesSinceSuccess: 180,
      consecutiveFailures: 4,
      lastError: 'HTTP 403 for https://www.thewarehouse.co.nz/c/...',
    });

    expect(message.title).toBe('Stock check stalled: The Warehouse');
    expect(message.body).toContain('last succeeded 3h ago');
    expect(message.body).toContain('4 failed checks in a row');
    expect(message.body).toContain('HTTP 403');
  });

  it('handles a source that never ran', () => {
    const message = formatStaleMessage({
      key: 'farmers',
      name: 'Farmers',
      minutesSinceSuccess: null,
      consecutiveFailures: 0,
      lastError: null,
    });

    expect(message.body).toBe('Farmers has never completed a check.');
  });
});

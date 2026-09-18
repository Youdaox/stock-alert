import { describe, expect, it } from 'vitest';

import { isDueForCheck, minIntervalSecondsOf } from '../src/core/poller.js';

const now = new Date('2026-09-18T10:00:00Z');
const minutesAgo = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);

describe('minIntervalSecondsOf', () => {
  it('reads seconds, falls back to minutes, and ignores nonsense', () => {
    expect(minIntervalSecondsOf({ minIntervalSeconds: 60 })).toBe(60);
    expect(minIntervalSecondsOf({ minIntervalMinutes: 15 })).toBe(900);
    expect(minIntervalSecondsOf({ minIntervalSeconds: 60, minIntervalMinutes: 15 })).toBe(60);
    expect(minIntervalSecondsOf({ minIntervalSeconds: 'soon' })).toBe(0);
    expect(minIntervalSecondsOf(undefined)).toBe(0);
  });
});

describe('isDueForCheck', () => {
  it('honours an interval given in seconds', () => {
    const hot = { config: { minIntervalSeconds: 60 }, consecutiveFailures: 0 };

    expect(isDueForCheck({ ...hot, lastRunAt: new Date(now.getTime() - 45_000) }, now)).toBe(false);
    expect(isDueForCheck({ ...hot, lastRunAt: new Date(now.getTime() - 61_000) }, now)).toBe(true);
  });

  it('checks a source that has never run', () => {
    expect(isDueForCheck({ config: {}, lastRunAt: null, consecutiveFailures: 0 }, now)).toBe(true);
  });

  it('checks a healthy source with no interval every cycle', () => {
    expect(isDueForCheck({ config: {}, lastRunAt: minutesAgo(1), consecutiveFailures: 0 }, now)).toBe(true);
  });

  it('honours a minimum interval', () => {
    const source = { config: { minIntervalMinutes: 30 }, consecutiveFailures: 0 };

    expect(isDueForCheck({ ...source, lastRunAt: minutesAgo(29) }, now)).toBe(false);
    expect(isDueForCheck({ ...source, lastRunAt: minutesAgo(31) }, now)).toBe(true);
  });

  it('counts the interval from the last attempt, not the last success', () => {
    // A failing browser source used to retry every cycle, reopening a window each time.
    const failing = { config: { minIntervalMinutes: 30 }, lastRunAt: minutesAgo(5), consecutiveFailures: 3 };

    expect(isDueForCheck(failing, now)).toBe(false);
  });

  it('waits longer after each consecutive failure', () => {
    const source = { config: {}, lastRunAt: minutesAgo(6) };

    expect(isDueForCheck({ ...source, consecutiveFailures: 1 }, now)).toBe(true); // 5 minutes
    expect(isDueForCheck({ ...source, consecutiveFailures: 2 }, now)).toBe(false); // 10 minutes
    expect(isDueForCheck({ ...source, lastRunAt: minutesAgo(11), consecutiveFailures: 2 }, now)).toBe(true);
  });

  it('caps the backoff so a source is not parked forever', () => {
    const veryStale = { config: {}, lastRunAt: minutesAgo(60 * 24), consecutiveFailures: 99 };

    expect(isDueForCheck(veryStale, now)).toBe(true);
  });
});

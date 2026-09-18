import { describe, expect, it } from 'vitest';

import { isNewRelease } from '../src/core/record-run.js';

const now = new Date('2026-09-18T10:00:00Z');
const daysAgo = (days: number): Date => new Date(now.getTime() - days * 86_400_000);

describe('isNewRelease', () => {
  it('treats a recently listed product as a new release', () => {
    expect(isNewRelease(daysAgo(3), now)).toBe(true);
  });

  it('does not announce an old listing that is merely new to the tracker', () => {
    // Widening a filter or adding a category surfaces products listed years ago.
    expect(isNewRelease(daysAgo(400), now)).toBe(false);
    expect(isNewRelease(daysAgo(22), now)).toBe(false);
  });

  it('announces products from retailers that publish no listing date', () => {
    expect(isNewRelease(undefined, now)).toBe(true);
  });

  it('accepts a custom window', () => {
    expect(isNewRelease(daysAgo(30), now, 60)).toBe(true);
    expect(isNewRelease(daysAgo(30), now, 7)).toBe(false);
  });
});

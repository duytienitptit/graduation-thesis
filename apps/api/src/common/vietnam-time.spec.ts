import { describe, expect, it } from '@jest/globals';
import {
  isWorkingHours,
  nextVietnamMidnight,
  startOfVietnamDay,
  vietnamDayKey,
} from './vietnam-time.js';

describe('Vietnam days', () => {
  it('starts the day at 00:00 Vietnam time, which is 17:00 UTC', () => {
    expect(startOfVietnamDay(new Date('2026-11-06T16:59:59Z')).toISOString()).toBe(
      '2026-11-05T17:00:00.000Z',
    );
    expect(startOfVietnamDay(new Date('2026-11-06T17:00:00Z')).toISOString()).toBe(
      '2026-11-06T17:00:00.000Z',
    );
  });

  it('gives the next midnight', () => {
    expect(nextVietnamMidnight(new Date('2026-11-06T08:00:00Z')).toISOString()).toBe(
      '2026-11-06T17:00:00.000Z',
    );
  });
});

describe('working hours', () => {
  it.each([
    ['2026-11-06T01:59:59Z', false], // 08:59:59
    ['2026-11-06T02:00:00Z', true], // 09:00
    ['2026-11-06T09:59:59Z', true], // 16:59:59
    ['2026-11-06T10:00:00Z', false], // 17:00
    ['2026-11-08T03:00:00Z', true], // Sunday 10:00
  ])('%s is %s', (time, expected) => {
    expect(isWorkingHours(new Date(time))).toBe(expected);
  });

  it('dates the day in Vietnam, not UTC', () => {
    expect(vietnamDayKey(new Date('2026-11-06T16:59:00Z'))).toBe('2026-11-06');
    expect(vietnamDayKey(new Date('2026-11-06T17:00:00Z'))).toBe('2026-11-07');
  });
});

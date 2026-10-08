import { describe, expect, it } from 'vitest';
import { instant, instantFromIso, pretendClock, systemClock, type Instant } from '../src/clock';

describe('systemClock', () => {
  it('gives a whole number of milliseconds, after the code was written', () => {
    const now = systemClock.now();
    expect(Number.isSafeInteger(now)).toBe(true);
    expect(now).toBeGreaterThan(instantFromIso('2026-10-01T00:00:00Z'));
  });
});

describe('pretendClock', () => {
  const start = instantFromIso('2026-09-28T10:15:00Z');

  it('stays at the time it was given', () => {
    const clock = pretendClock(start);
    expect(clock.now()).toBe(start);
    expect(clock.now()).toBe(start);
  });

  it('moves forward when told', () => {
    const clock = pretendClock(start);
    clock.advance(60_000);
    expect(clock.now()).toBe(instantFromIso('2026-09-28T10:16:00Z'));
  });

  it('can be set to any time', () => {
    const clock = pretendClock(start);
    clock.set(instantFromIso('2026-09-30T12:00:00Z'));
    expect(clock.now()).toBe(instantFromIso('2026-09-30T12:00:00Z'));
  });

  it('refuses to move by part of a millisecond', () => {
    const clock = pretendClock(start);
    expect(() => {
      clock.advance(0.5);
    }).toThrow(RangeError);
    expect(clock.now()).toBe(start);
  });
});

describe('instantFromIso', () => {
  it('reads a UTC time', () => {
    expect(instantFromIso('2026-09-28T10:15:00Z')).toBe(Date.UTC(2026, 8, 28, 10, 15));
  });

  it('reads a time with an offset', () => {
    // 11:15 UK summer time is 10:15 UTC.
    expect(instantFromIso('2026-09-28T11:15:00+01:00')).toBe(instantFromIso('2026-09-28T10:15:00Z'));
    expect(instantFromIso('2026-09-28T05:15:00-05:00')).toBe(instantFromIso('2026-09-28T10:15:00Z'));
  });

  it('reads minutes without seconds, and milliseconds', () => {
    expect(instantFromIso('2026-09-28T10:15Z')).toBe(Date.UTC(2026, 8, 28, 10, 15));
    expect(instantFromIso('2026-09-28T10:15:00.5Z')).toBe(Date.UTC(2026, 8, 28, 10, 15, 0, 500));
    expect(instantFromIso('2026-09-28T10:15:00.123Z')).toBe(Date.UTC(2026, 8, 28, 10, 15, 0, 123));
  });

  it('knows 29 February only in a leap year', () => {
    expect(instantFromIso('2028-02-29T00:00:00Z')).toBe(Date.UTC(2028, 1, 29));
    expect(() => instantFromIso('2027-02-29T00:00:00Z')).toThrow(RangeError);
  });

  it.each([
    ['no zone', '2026-09-28T11:15:00'],
    ['a date only', '2026-09-28'],
    ['words', 'Monday at 11:15'],
    ['30 February', '2026-02-30T00:00:00Z'],
    ['month 13', '2026-13-01T00:00:00Z'],
    ['hour 24', '2026-09-28T24:00:00Z'],
    ['minute 60', '2026-09-28T10:60:00Z'],
    ['a space in place of T', '2026-09-28 10:15:00Z'],
  ])('refuses %s', (_, text) => {
    expect(() => instantFromIso(text)).toThrow(RangeError);
  });
});

describe('instant', () => {
  it('marks a whole number of milliseconds as an Instant', () => {
    expect(instant(1_790_000_000_000)).toBe(1_790_000_000_000);
  });

  it.each([0.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (value) => {
    expect(() => instant(value)).toThrow(RangeError);
  });

  it('is not interchangeable with a plain number', () => {
    // @ts-expect-error A plain number is not an Instant: it has to go through instant() first.
    const at: Instant = 1_790_000_000_000;
    expect(at).toBe(1_790_000_000_000);
  });
});

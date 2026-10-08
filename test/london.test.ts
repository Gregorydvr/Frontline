import { describe, expect, it } from 'vitest';
import { instantFromIso } from '../src/clock';
import { inLondon, londonDay } from '../src/london';

describe('inLondon', () => {
  it('reads a summer instant one hour ahead of UTC', () => {
    expect(inLondon(instantFromIso('2026-10-15T07:10:00Z'))).toEqual({
      year: 2026,
      month: 10,
      day: 15,
      weekday: 4,
      hour: 8,
      minute: 10,
    });
  });

  it('follows the clocks going back on Sunday 25 October 2026', () => {
    // 01:30 comes twice: first in summer time, then again an hour later.
    expect(inLondon(instantFromIso('2026-10-25T00:30:00Z'))).toMatchObject({ day: 25, hour: 1, minute: 30 });
    expect(inLondon(instantFromIso('2026-10-25T01:30:00Z'))).toMatchObject({ day: 25, hour: 1, minute: 30 });
    expect(inLondon(instantFromIso('2026-10-25T12:00:00Z'))).toMatchObject({ weekday: 0, hour: 12 });
    expect(inLondon(instantFromIso('2026-10-26T09:00:00Z'))).toMatchObject({ day: 26, weekday: 1, hour: 9 });
  });

  it('follows the clocks going forward on Sunday 28 March 2027', () => {
    expect(inLondon(instantFromIso('2027-03-28T00:59:00Z'))).toMatchObject({ hour: 0, minute: 59 });
    expect(inLondon(instantFromIso('2027-03-28T01:00:00Z'))).toMatchObject({ hour: 2, minute: 0 });
    expect(inLondon(instantFromIso('2027-03-29T08:00:00Z'))).toMatchObject({
      year: 2027,
      month: 3,
      day: 29,
      weekday: 1,
      hour: 9,
    });
  });

  it('gives midnight as hour 0', () => {
    expect(inLondon(instantFromIso('2026-12-31T00:00:00Z'))).toMatchObject({ day: 31, hour: 0, minute: 0 });
  });
});

describe('londonDay', () => {
  it('puts half past midnight in summer on the UK date, not the UTC one', () => {
    const halfPastMidnight = instantFromIso('2026-10-14T23:30:00Z');
    expect(londonDay(halfPastMidnight)).toBe(londonDay(instantFromIso('2026-10-15T12:00:00+01:00')));
    expect(londonDay(halfPastMidnight) - londonDay(instantFromIso('2026-10-14T22:59:00Z'))).toBe(1);
  });

  it('counts the days between dates across the clock change', () => {
    expect(
      londonDay(instantFromIso('2026-10-26T09:00:00Z')) - londonDay(instantFromIso('2026-10-23T09:00:00+01:00')),
    ).toBe(3);
  });
});

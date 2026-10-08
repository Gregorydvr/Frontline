import { describe, expect, it } from 'vitest';
import { instantFromIso } from '../src/clock';
import { clock24, inLondon, londonDay, londonDayAround, londonInstant, shortDate, startOfLondonDay } from '../src/london';

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

describe('the UK day', () => {
  it('starts at UK midnight, an hour before midnight UTC in summer', () => {
    expect(startOfLondonDay(2026, 10, 15)).toBe(instantFromIso('2026-10-14T23:00:00Z'));
    expect(startOfLondonDay(2026, 12, 1)).toBe(instantFromIso('2026-12-01T00:00:00Z'));
  });

  it('runs from midnight to midnight, 25 hours on the day the clocks go back', () => {
    expect(londonDayAround(instantFromIso('2026-10-15T16:00:00+01:00'))).toEqual({
      from: instantFromIso('2026-10-15T00:00:00+01:00'),
      to: instantFromIso('2026-10-16T00:00:00+01:00'),
    });
    const { from, to } = londonDayAround(instantFromIso('2026-10-25T12:00:00Z'));
    expect(to - from).toBe(25 * 3_600_000);
  });

  it('runs on into the next month', () => {
    expect(londonDayAround(instantFromIso('2026-10-31T12:00:00Z')).to).toBe(instantFromIso('2026-11-01T00:00:00Z'));
  });
});

describe('clock24 and shortDate', () => {
  it('write a time and a day as the example does, in UK time', () => {
    const at = instantFromIso('2026-10-16T09:00:00Z');
    expect(clock24(at)).toBe('10:00');
    expect(shortDate(at)).toBe('Fri 16 Oct');
    expect(clock24(instantFromIso('2026-10-15T07:05:00Z'))).toBe('08:05');
  });
});

describe('londonInstant', () => {
  it('turns 1pm UK time into 12:00 UTC in summer, and 13:00 UTC after the clocks go back', () => {
    // Step 4 of the acceptance story: Mrs Green's reminder.
    expect(londonInstant(2026, 10, 18, 13)).toBe(instantFromIso('2026-10-18T12:00:00Z'));
    // Step 7: the reminder for a visit on Monday 26 October.
    expect(londonInstant(2026, 10, 25, 13)).toBe(instantFromIso('2026-10-25T13:00:00Z'));
  });

  it('turns 1pm on the day the clocks go forward into 12:00 UTC', () => {
    // Step 7: the reminder for a visit on Monday 29 March 2027.
    expect(londonInstant(2027, 3, 28, 13)).toBe(instantFromIso('2027-03-28T12:00:00Z'));
    expect(londonInstant(2027, 3, 29, 9)).toBe(instantFromIso('2027-03-29T08:00:00Z'));
  });

  it('reads an hour the clocks skip as the hour after it', () => {
    expect(londonInstant(2027, 3, 28, 1, 30)).toBe(instantFromIso('2027-03-28T01:30:00Z'));
    expect(inLondon(londonInstant(2027, 3, 28, 1, 30))).toMatchObject({ hour: 2, minute: 30 });
  });

  it('takes the first of an hour that happens twice', () => {
    expect(londonInstant(2026, 10, 25, 1, 30)).toBe(instantFromIso('2026-10-25T01:30:00+01:00'));
  });

  it('gives back every hour of the days the clocks change, apart from the skipped one', () => {
    for (const [year, month, day] of [
      [2026, 10, 25],
      [2027, 3, 28],
    ] as const) {
      for (let hour = 0; hour < 24; hour++) {
        if (year === 2027 && hour === 1) continue;
        expect(inLondon(londonInstant(year, month, day, hour, 15))).toMatchObject({ year, month, day, hour, minute: 15 });
      }
    }
  });

  it('runs a day past the end of the month into the next, and day 0 back into the month before', () => {
    expect(londonInstant(2026, 10, 32, 13)).toBe(instantFromIso('2026-11-01T13:00:00Z'));
    expect(londonInstant(2026, 11, 0, 13)).toBe(instantFromIso('2026-10-31T13:00:00Z'));
    expect(londonInstant(2026, 10, 1 - 1, 13)).toBe(instantFromIso('2026-09-30T13:00:00+01:00'));
  });

  it('refuses a time that is not one', () => {
    expect(() => londonInstant(2026, 10, 18, 24)).toThrow(RangeError);
    expect(() => londonInstant(2026, 10, 18, 13, 60)).toThrow(RangeError);
    expect(() => londonInstant(2026, 10, 18.5, 13)).toThrow(RangeError);
  });
});

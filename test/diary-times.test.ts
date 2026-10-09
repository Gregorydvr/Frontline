// Which times a firm's diary offers, and the rows that come with a visit,
// worked out in UK time from the firm's rules (src/diary/times.ts).

import { describe, expect, it } from 'vitest';
import { instantFromIso } from '../src/clock';
import { bookingDues, dateFromWords, isOffered, offeredStarts, reminderDue, startFromWords, startInWords, startToSay } from '../src/diary/times';
import { EXAMPLE_DIARY_RULES } from '../src/example/tidewell';
import type { DiaryRules } from '../src/record/types';

describe('the starts a firm offers', () => {
  it('are on the hour from 8am, the last ending by 4pm, Monday to Friday, from tomorrow, up to two weeks ahead', () => {
    const starts = offeredStarts(EXAMPLE_DIARY_RULES, 'quote_visit', instantFromIso('2026-09-28T11:14:00+01:00'));
    expect(starts).toHaveLength(10 * 8);
    expect(startInWords(starts[0] ?? instantFromIso('2000-01-01T00:00:00Z'))).toBe('2026-09-29T08:00');
    expect(startInWords(starts.at(-1) ?? instantFromIso('2000-01-01T00:00:00Z'))).toBe('2026-10-12T15:00');
  });

  it('are none for a kind of visit the firm gave no length', () => {
    expect(offeredStarts(EXAMPLE_DIARY_RULES, 'install', instantFromIso('2026-09-28T11:14:00+01:00'))).toEqual([]);
  });

  it('never include an hour the clocks skip', () => {
    const night: DiaryRules = { days: [0], opens: 0, closes: 4 * 60, every: 30, lengths: { quote_visit: 30 }, daysAhead: 7 };
    const starts = offeredStarts(night, 'quote_visit', instantFromIso('2027-03-25T12:00:00Z')).map(startInWords);
    expect(starts).toContain('2027-03-28T00:30');
    expect(starts).not.toContain('2027-03-28T01:00');
    expect(starts).not.toContain('2027-03-28T01:30');
    expect(starts).toContain('2027-03-28T02:00');
  });

  it('say whether one start is offered', () => {
    const now = instantFromIso('2026-09-28T11:14:00+01:00');
    expect(isOffered(EXAMPLE_DIARY_RULES, 'quote_visit', instantFromIso('2026-10-01T15:00:00+01:00'), now)).toBe(true);
    expect(isOffered(EXAMPLE_DIARY_RULES, 'quote_visit', instantFromIso('2026-10-01T15:00:01+01:00'), now)).toBe(false);
    expect(isOffered(EXAMPLE_DIARY_RULES, 'quote_visit', instantFromIso('2026-09-28T15:00:00+01:00'), now)).toBe(false);
  });
});

describe('reading what the voice agent hands back', () => {
  it('reads a UK date and time, and nothing else', () => {
    expect(startFromWords('2026-10-01T15:00')).toBe(instantFromIso('2026-10-01T15:00:00+01:00'));
    expect(startFromWords('2026-10-26T09:00')).toBe(instantFromIso('2026-10-26T09:00:00Z'));
    for (const words of ['2026-10-01 15:00', '2026-10-01T15:00Z', '2026-09-31T10:00', '2026-10-01T24:00', '2027-03-28T01:30', 'tomorrow']) {
      expect(startFromWords(words), words).toBeNull();
    }
  });

  it('reads a UK date, and nothing else', () => {
    expect(dateFromWords('2026-10-01')).toEqual({ year: 2026, month: 10, day: 1 });
    expect(dateFromWords('2026-02-29')).toBeNull();
    expect(dateFromWords('1 October')).toBeNull();
  });

  it('says a start as the agent reads it out', () => {
    expect(startToSay(instantFromIso('2026-10-19T09:00:00+01:00'))).toBe('Monday 19 October at 9am');
    expect(startToSay(instantFromIso('2026-10-21T12:00:00+01:00'))).toBe('Wednesday 21 October at midday');
  });
});

describe('the rows that come with a visit', () => {
  it('are its confirmation at once, until it starts, and its reminder at 1pm UK time the day before, until its day starts', () => {
    const now = instantFromIso('2026-09-28T11:15:00+01:00');
    const starts = instantFromIso('2026-10-01T15:00:00+01:00');
    expect(bookingDues(starts, now)).toEqual([
      { action: 'send_confirmation', runAt: now, latestAt: starts },
      { action: 'send_reminder', runAt: instantFromIso('2026-09-30T13:00:00+01:00'), latestAt: instantFromIso('2026-10-01T00:00:00+01:00') },
    ]);
  });

  it('have the reminder at 13:00 UTC once the clocks have gone back, and 12:00 UTC after they go forward', () => {
    const now = instantFromIso('2026-10-20T10:00:00+01:00');
    expect(reminderDue(instantFromIso('2026-10-26T09:00:00Z'), now)?.runAt).toBe(instantFromIso('2026-10-25T13:00:00Z'));
    expect(reminderDue(instantFromIso('2027-03-29T08:00:00Z'), now)?.runAt).toBe(instantFromIso('2027-03-28T12:00:00Z'));
  });

  it('have no reminder when 1pm the day before has come', () => {
    const starts = instantFromIso('2026-10-01T15:00:00+01:00');
    expect(reminderDue(starts, instantFromIso('2026-09-30T12:59:00+01:00'))).not.toBeNull();
    expect(reminderDue(starts, instantFromIso('2026-09-30T13:00:00+01:00'))).toBeNull();
    expect(bookingDues(starts, instantFromIso('2026-09-30T17:00:00+01:00')).map((due) => due.action)).toEqual(['send_confirmation']);
  });
});

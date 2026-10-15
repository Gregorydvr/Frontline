// Which times a firm's diary offers, and the rows that come with a visit,
// worked out in UK time from the firm's rules (src/diary/times.ts).

import { describe, expect, it } from 'vitest';
import { instantFromIso } from '../src/clock';
import {
  bookingDues,
  dateFromWords,
  DEFAULT_NEXT_DAY_FROM,
  isOffered,
  offeredStarts,
  reminderDue,
  spreadTimes,
  startFromWords,
  startInWords,
  startToSay,
} from '../src/diary/times';
import type { Instant } from '../src/clock';
import { EXAMPLE_DIARY_RULES } from '../src/example/tidewell';
import type { DiaryRules } from '../src/record/types';

describe('the starts a firm offers', () => {
  it('are on the hour from 8am, the last ending by 4pm, Monday to Friday, from noon on the next working day, up to two weeks ahead', () => {
    const starts = offeredStarts(EXAMPLE_DIARY_RULES, 'quote_visit', instantFromIso('2026-09-28T11:14:00+01:00'));
    expect(starts).toHaveLength(10 * 8 - 4);
    expect(startInWords(starts[0] ?? instantFromIso('2000-01-01T00:00:00Z'))).toBe('2026-09-29T12:00');
    expect(startInWords(starts.at(-1) ?? instantFromIso('2000-01-01T00:00:00Z'))).toBe('2026-10-12T15:00');
  });

  it('are none for a kind of visit the firm gave no length', () => {
    expect(offeredStarts(EXAMPLE_DIARY_RULES, 'install', instantFromIso('2026-09-28T11:14:00+01:00'))).toEqual([]);
  });

  it('never include an hour the clocks skip', () => {
    const night: DiaryRules = { days: [0], opens: 0, closes: 4 * 60, every: 30, lengths: { quote_visit: 30 }, daysAhead: 7, nextDayFrom: 0 };
    const starts = offeredStarts(night, 'quote_visit', instantFromIso('2027-03-25T12:00:00Z')).map(startInWords);
    expect(starts).toContain('2027-03-28T00:30');
    expect(starts).not.toContain('2027-03-28T01:00');
    expect(starts).not.toContain('2027-03-28T01:30');
    expect(starts).toContain('2027-03-28T02:00');
  });

  it('need noon’s notice on the next working day, unless the firm sets its own', () => {
    const at = (words: string) => instantFromIso(words);
    const first = (now: string, rules: DiaryRules = EXAMPLE_DIARY_RULES) => startInWords(offeredStarts(rules, 'quote_visit', at(now))[0] ?? at('2000-01-01T00:00:00Z'));
    expect(DEFAULT_NEXT_DAY_FROM).toBe(12 * 60);
    // Wednesday evening: Thursday from noon. Friday morning is not held back.
    expect(first('2026-10-14T20:20:00+01:00')).toBe('2026-10-15T12:00');
    expect(isOffered(EXAMPLE_DIARY_RULES, 'quote_visit', at('2026-10-15T09:00:00+01:00'), at('2026-10-14T20:20:00+01:00'))).toBe(false);
    expect(isOffered(EXAMPLE_DIARY_RULES, 'quote_visit', at('2026-10-16T08:00:00+01:00'), at('2026-10-14T20:20:00+01:00'))).toBe(true);
    // Early on a Wednesday is no different: Thursday from noon.
    expect(first('2026-10-14T07:00:00+01:00')).toBe('2026-10-15T12:00');
    // Friday: the next working day is Monday, from noon.
    expect(first('2026-10-16T10:00:00+01:00')).toBe('2026-10-19T12:00');
    // The firm's own notice, and none at all.
    expect(first('2026-10-14T20:20:00+01:00', { ...EXAMPLE_DIARY_RULES, nextDayFrom: 9 * 60 })).toBe('2026-10-15T09:00');
    expect(first('2026-10-14T20:20:00+01:00', { ...EXAMPLE_DIARY_RULES, nextDayFrom: 0 })).toBe('2026-10-15T08:00');
    // Monday 26 October, the day after the clocks go back: noon UK time is 12:00 UTC.
    expect(isOffered(EXAMPLE_DIARY_RULES, 'quote_visit', at('2026-10-26T11:00:00Z'), at('2026-10-23T17:00:00+01:00'))).toBe(false);
    expect(isOffered(EXAMPLE_DIARY_RULES, 'quote_visit', at('2026-10-26T12:00:00Z'), at('2026-10-23T17:00:00+01:00'))).toBe(true);
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
      { action: 'tell_owner_booked', runAt: now, latestAt: starts },
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
    expect(bookingDues(starts, instantFromIso('2026-09-30T17:00:00+01:00')).map((due) => due.action)).toEqual(['send_confirmation', 'tell_owner_booked']);
  });
});

describe('the free times offered', () => {
  const free = (...words: string[]) => words.map((one) => ({ startsAt: instantFromIso(`${one}:00+01:00`), label: one }));
  const labels = (times: { label: string }[]) => times.map((time) => time.label);
  const week = free(
    '2026-10-15T12:00', '2026-10-15T13:00', '2026-10-15T15:00',
    '2026-10-16T08:00', '2026-10-16T09:00', '2026-10-16T10:00', '2026-10-16T11:00', '2026-10-16T12:00', '2026-10-16T14:00', '2026-10-16T15:00',
    '2026-10-19T09:00', '2026-10-20T08:00',
  );

  it('with no day asked about, are the first on each of the next days that have one', () => {
    expect(labels(spreadTimes(week, false, 3))).toEqual(['2026-10-15T12:00', '2026-10-16T08:00', '2026-10-19T09:00']);
  });

  it('with a day asked about, are spread across the first day from it that has any: the earliest, the one nearest midday, and the latest', () => {
    expect(labels(spreadTimes(week.slice(3), true, 3))).toEqual(['2026-10-16T08:00', '2026-10-16T12:00', '2026-10-16T15:00']);
    // Nothing nearer midday than 11am or 1pm: the earlier of the two.
    expect(labels(spreadTimes(free('2026-10-16T08:00', '2026-10-16T11:00', '2026-10-16T13:00', '2026-10-16T15:00'), true, 3))).toEqual([
      '2026-10-16T08:00',
      '2026-10-16T11:00',
      '2026-10-16T15:00',
    ]);
  });

  it('are all of that day’s when it has three or fewer, and never another day’s', () => {
    expect(labels(spreadTimes(week, true, 3))).toEqual(['2026-10-15T12:00', '2026-10-15T13:00', '2026-10-15T15:00']);
    expect(labels(spreadTimes(free('2026-10-19T09:00', '2026-10-20T08:00'), true, 3))).toEqual(['2026-10-19T09:00']);
  });

  it('are none when nothing is free, or none are asked for', () => {
    expect(spreadTimes([] as { startsAt: Instant }[], false, 3)).toEqual([]);
    expect(spreadTimes(week, false, 0)).toEqual([]);
  });
});

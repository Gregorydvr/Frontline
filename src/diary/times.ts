// Which times a firm's diary offers, and the rows in the due list that come
// with a visit. Worked out in UK time (rule 18 in CLAUDE.md) from the firm's
// rules (DiaryRules in src/record/types.ts) and the clock; nothing here
// touches the record, so it is tested on its own.
//
// From the build's answers to open question 4 (9 Oct 2026, at Greg's
// request): visits start every `every` minutes from the firm's first start
// and end by its close; nothing is offered on the day itself; and a visit
// booked after 1pm the day before gets no reminder, since its confirmation
// has only just gone. From Greg's answers to open question 15 (14 Oct 2026):
// on the next day the firm works, nothing before its notice time, noon
// unless its rules say otherwise; and the agent is offered times spread
// across days, or across the day the caller asks about.

import { instant, type Instant } from '../clock';
import { inLondon, londonDay, londonInstant, MONTHS, startOfLondonDay, WEEKDAYS } from '../london';
import { clockWords } from '../history-lines';
import type { DiaryRules, VisitKind } from '../record/types';

/** A UK calendar date. */
export interface LondonDate {
  year: number;
  month: number;
  day: number;
}

/** The hour of the day before a visit when its reminder goes: 1pm UK time. From the example. */
export const REMINDER_HOUR = 13;

/** On the next day a firm works, the first start offered when its rules do not say: noon (Greg, 14 Oct 2026). */
export const DEFAULT_NEXT_DAY_FROM = 12 * 60;

/** How long a kind of visit takes under the firm's rules, in milliseconds, or null when the diary does not book it. */
export function visitLength(rules: DiaryRules, kind: VisitKind): number | null {
  const minutes = rules.lengths[kind];
  return minutes === undefined ? null : minutes * 60_000;
}

/**
 * The starts the firm's rules offer for a kind of visit, earliest first:
 * from the day after `now` (or from `from`, if later), on the days it books,
 * up to `daysAhead` days after today, and on the next of those days, none
 * before its notice time. Times taken in the diary are not looked at here.
 */
export function offeredStarts(rules: DiaryRules, kind: VisitKind, now: Instant, from: LondonDate | null = null): Instant[] {
  const length = rules.lengths[kind];
  if (length === undefined) {
    return [];
  }
  const today = londonDay(now);
  const first = Math.max(today + 1, from === null ? today + 1 : dayNumber(from));
  // The next day the firm works, on which nothing starts before its notice time.
  let nextWorkingDay = today + 1;
  while (!rules.days.includes(weekdayOf(nextWorkingDay)) && nextWorkingDay < today + 7) {
    nextWorkingDay += 1;
  }
  const nextDayFrom = rules.nextDayFrom ?? DEFAULT_NEXT_DAY_FROM;
  const starts: Instant[] = [];
  for (let day = first; day <= today + rules.daysAhead; day += 1) {
    const date = dateOf(day);
    if (!rules.days.includes(weekdayOf(day))) {
      continue;
    }
    for (let minute = rules.opens; minute + length <= rules.closes; minute += rules.every) {
      if (day === nextWorkingDay && minute < nextDayFrom) {
        continue;
      }
      const start = londonInstant(date.year, date.month, date.day, Math.floor(minute / 60), minute % 60);
      // An hour the clocks skip is not offered.
      const read = inLondon(start);
      if (read.hour * 60 + read.minute === minute && read.day === date.day) {
        starts.push(start);
      }
    }
  }
  return starts;
}

/**
 * Which free times to offer, from every free one, earliest first (Greg's
 * answer to open question 15, 14 Oct 2026). With no day asked about: the
 * first on each of the next days that have one. With a day asked about: the
 * first day from it that has any, and on it the earliest, the latest, then
 * those nearest midday, up to `count`. Earliest first.
 */
export function spreadTimes<T extends { startsAt: Instant }>(free: readonly T[], dayAskedAbout: boolean, count: number): T[] {
  const [earliest] = free;
  if (count < 1 || earliest === undefined) {
    return [];
  }
  if (!dayAskedAbout) {
    const chosen: T[] = [];
    for (const time of free) {
      if (chosen.length === count) break;
      const last = chosen.at(-1);
      if (last === undefined || londonDay(last.startsAt) !== londonDay(time.startsAt)) chosen.push(time);
    }
    return chosen;
  }
  const day = londonDay(earliest.startsAt);
  const thatDay = free.filter((time) => londonDay(time.startsAt) === day);
  const fromMidday = (time: T) => {
    const at = inLondon(time.startsAt);
    return Math.abs(at.hour * 60 + at.minute - 12 * 60);
  };
  const byPreference = [thatDay[0], thatDay.at(-1), ...[...thatDay].sort((a, b) => fromMidday(a) - fromMidday(b))];
  const chosen = new Set<T>();
  for (const time of byPreference) {
    if (chosen.size === count) break;
    if (time !== undefined) chosen.add(time);
  }
  return [...chosen].sort((a, b) => a.startsAt - b.startsAt);
}

/** Whether the firm's rules offer this start for a kind of visit now. */
export function isOffered(rules: DiaryRules, kind: VisitKind, startsAt: Instant, now: Instant): boolean {
  const date = inLondon(startsAt);
  return offeredStarts(rules, kind, now, date).some((start) => start === startsAt);
}

/**
 * A UK date and time as the voice agent hands it back, such as
 * "2026-10-01T15:00", read as UK time. Null for anything else.
 */
export function startFromWords(text: string): Instant | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (parts === null) {
    return null;
  }
  const [year, month, day, hour, minute] = parts.slice(1).map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }
  const start = londonInstant(year, month, day, hour, minute);
  const read = inLondon(start);
  // A date that does not exist, such as 31 September, runs on into the next month.
  return read.year === year && read.month === month && read.day === day && read.hour === hour && read.minute === minute
    ? start
    : null;
}

/** A UK date as the voice agent hands it, such as "2026-10-01". Null for anything else. */
export function dateFromWords(text: string): LondonDate | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (parts === null) {
    return null;
  }
  const [year, month, day] = parts.slice(1).map(Number) as [number, number, number];
  const back = dateOf(dayNumber({ year, month, day }));
  return back.year === year && back.month === month && back.day === day ? back : null;
}

/** A start as the voice agent hands it back: "2026-10-01T15:00", UK time. */
export function startInWords(startsAt: Instant): string {
  const { year, month, day, hour, minute } = inLondon(startsAt);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(year)}-${two(month)}-${two(day)}T${two(hour)}:${two(minute)}`;
}

/** A start as the voice agent reads it out, and as a text gives it: "Thursday 1 October at 3pm". */
export function startToSay(startsAt: Instant): string {
  const { month, day, weekday, hour, minute } = inLondon(startsAt);
  return `${WEEKDAYS[weekday] ?? ''} ${String(day)} ${MONTHS[month - 1] ?? ''} at ${clockWords(hour, minute)}`;
}

/** A row in the due list that comes with a visit. */
export interface VisitDue {
  action: 'send_confirmation' | 'send_reminder' | 'tell_owner_booked' | 'send_visit_followup';
  runAt: Instant;
  latestAt: Instant;
}

/** When the text after a quote visit goes: 10am UK time the morning after (task 5, [to agree]), until quiet hours begin that day. */
export const FOLLOWUP_HOUR = 10;

/**
 * The text after a quote visit, while the copy switches it on: at 10am UK
 * time the day after the visit, worth sending until 8pm that day.
 */
export function followupDue(startsAt: Instant): { action: 'send_visit_followup'; runAt: Instant; latestAt: Instant } {
  const { year, month, day } = inLondon(startsAt);
  return { action: 'send_visit_followup', runAt: londonInstant(year, month, day + 1, FOLLOWUP_HOUR), latestAt: londonInstant(year, month, day + 1, 20) };
}

/**
 * The rows for a visit the voice agent just booked: its confirmation, at
 * once and worth sending until the visit starts; its reminder (see
 * reminderDue()); and the owner's text about it, on the same terms as the
 * confirmation.
 */
export function bookingDues(startsAt: Instant, now: Instant, also: { followup: boolean } = { followup: false }): VisitDue[] {
  const confirmation: VisitDue = { action: 'send_confirmation', runAt: now, latestAt: instant(Math.max(now, startsAt)) };
  // The owner hears of the booking (Greg's answer to open question 16, 14 Oct 2026).
  const toldOwner: VisitDue = { action: 'tell_owner_booked', runAt: now, latestAt: instant(Math.max(now, startsAt)) };
  const reminder = reminderDue(startsAt, now);
  const dues = reminder === null ? [confirmation, toldOwner] : [confirmation, reminder, toldOwner];
  // Only quote visits are booked on a call, so this is a quote visit's.
  return also.followup ? [...dues, followupDue(startsAt)] : dues;
}

/**
 * A visit's reminder: at 1pm UK time the day before, worth sending until the
 * start of the visit's day (Settled, 8 Oct 2026). None when 1pm the day
 * before has already come, such as for a visit booked late the day before.
 */
export function reminderDue(startsAt: Instant, now: Instant): VisitDue | null {
  const { year, month, day } = inLondon(startsAt);
  const runAt = londonInstant(year, month, day - 1, REMINDER_HOUR);
  if (now >= runAt) {
    return null;
  }
  return { action: 'send_reminder', runAt, latestAt: startOfLondonDay(year, month, day) };
}

/** The UK date for a count of days since 1 January 1970. */
function dateOf(dayCount: number): LondonDate {
  const date = new Date(dayCount * 86_400_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function dayNumber(date: LondonDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / 86_400_000;
}

/** 0 for Sunday to 6 for Saturday. 1 January 1970 was a Thursday. */
function weekdayOf(dayCount: number): number {
  return (((dayCount + 4) % 7) + 7) % 7;
}

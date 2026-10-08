// Reading a stored instant as the time a person in the UK reads it, and the
// other way round (rule 18 in CLAUDE.md). Instants are stored in UTC; this
// works out the date and time in Europe/London, with the clocks going forward
// and back.

import { instant, type Instant } from './clock';

export interface LondonTime {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  /** 0 for Sunday to 6 for Saturday. */
  weekday: number;
  /** 0 to 23. */
  hour: number;
  minute: number;
}

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

export function inLondon(at: Instant): LondonTime {
  const parts = Object.fromEntries(
    PARTS.formatToParts(new Date(at)).map((part) => [part.type, Number(part.value)] as const),
  );
  const year = parts.year ?? Number.NaN;
  const month = parts.month ?? Number.NaN;
  const day = parts.day ?? Number.NaN;
  return {
    year,
    month,
    day,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    hour: parts.hour ?? Number.NaN,
    minute: parts.minute ?? Number.NaN,
  };
}

/** The UK calendar date of an instant, as a count of days since 1 January 1970, for comparing dates. */
export function londonDay(at: Instant): number {
  const { year, month, day } = inLondon(at);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/**
 * The instant a UK day starts. Midnight is never skipped or repeated in the
 * UK (the clocks change at 1am and 2am), so midnight UTC moved by that day's
 * offset is exact. A day past the end of the month runs on into the next.
 */
export function startOfLondonDay(year: number, month: number, day: number): Instant {
  const midnightUtc = Date.UTC(year, month - 1, day);
  const offsetHours = inLondon(instant(midnightUtc)).hour;
  return instant(midnightUtc - offsetHours * 3_600_000);
}

/**
 * The instant of a UK date and time, such as 1pm on Sunday 18 October 2026
 * (12:00 UTC, in summer time) or 1pm on Sunday 25 October 2026 (13:00 UTC,
 * after the clocks go back). A day past the end of the month runs on into the
 * next, and day 0 is the last day of the month before, so "the day before"
 * is simply `day - 1`.
 *
 * Twice a year an hour is odd. When the clocks go forward, 1:30am does not
 * happen: it is read as 2:30am, the same distance into the day. When they go
 * back, 1:30am happens twice: the first is taken.
 */
export function londonInstant(year: number, month: number, day: number, hour: number, minute = 0): Instant {
  if (![year, month, day, hour, minute].every(Number.isSafeInteger) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new RangeError('Not a UK date and time');
  }
  // The date and time as written, read as if UK time were UTC.
  const asWritten = Date.UTC(year, month - 1, day, hour, minute);
  const wanted = new Date(asWritten);
  // UK time is UTC or an hour ahead. Summer time first, so a repeated hour
  // gives the first of the two.
  for (const offset of [3_600_000, 0]) {
    const at = instant(asWritten - offset);
    const read = inLondon(at);
    if (
      read.year === wanted.getUTCFullYear() &&
      read.month === wanted.getUTCMonth() + 1 &&
      read.day === wanted.getUTCDate() &&
      read.hour === wanted.getUTCHours() &&
      read.minute === wanted.getUTCMinutes()
    ) {
      return at;
    }
  }
  // An hour the clocks skipped. As UTC it reads an hour later in UK time.
  return instant(asWritten);
}

/** The UK day that holds an instant: from its start up to, not including, the next day's. */
export function londonDayAround(at: Instant): { from: Instant; to: Instant } {
  const { year, month, day } = inLondon(at);
  return { from: startOfLondonDay(year, month, day), to: startOfLondonDay(year, month, day + 1) };
}

/** "08:50", as the example writes the time of a line. */
export function clock24(at: Instant): string {
  const { hour, minute } = inLondon(at);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "Mon 14 Sep", as the example writes a day on a job page or in the diary. */
export function shortDate(at: Instant): string {
  const { month, day, weekday } = inLondon(at);
  return `${(WEEKDAYS[weekday] ?? '').slice(0, 3)} ${String(day)} ${(MONTHS[month - 1] ?? '').slice(0, 3)}`;
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

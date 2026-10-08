// Reading a stored instant as the time a person in the UK reads it (rule 18 in
// CLAUDE.md). Instants are stored in UTC; this works out the date and time in
// Europe/London, with the clocks going forward and back.
//
// Turning a UK date and time into an instant, for the due list, comes with
// slice D.

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

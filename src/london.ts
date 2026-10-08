// Reading a stored instant as the time a person in the UK reads it (rule 18 in
// CLAUDE.md). Instants are stored in UTC; this works out the date and time in
// Europe/London, with the clocks going forward and back.
//
// Turning a UK date and time into an instant, for the due list, comes with
// slice D.

import type { Instant } from './clock';

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

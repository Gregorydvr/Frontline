// The clock: the only place in Front-line that reads the system time (rule 19
// in CLAUDE.md). Everything else is given a Clock, so tests can use a pretend
// one.
//
// Instants are stored in UTC (rule 18). src/london.ts reads one as the time a
// person in the UK reads it, and turns a UK date and time into an instant.

declare const instantBrand: unique symbol;

/** A moment in time: whole milliseconds since 1 January 1970, UTC. */
export type Instant = number & { readonly [instantBrand]: true };

export interface Clock {
  now(): Instant;
}

/** A clock for tests that stays still until it is told to move. */
export interface PretendClock extends Clock {
  set(at: Instant): void;
  advance(milliseconds: number): void;
}

export const systemClock: Clock = {
  now: () => instant(Date.now()),
};

export function pretendClock(start: Instant): PretendClock {
  let at = instant(start);
  return {
    now: () => at,
    set(next) {
      at = instant(next);
    },
    advance(milliseconds) {
      if (!Number.isSafeInteger(milliseconds)) {
        throw new RangeError('A pretend clock moves by whole milliseconds');
      }
      at = instant(at + milliseconds);
    },
  };
}

/** Checks that a number of milliseconds since 1970 is a whole number, and marks it as an Instant. */
export function instant(milliseconds: number): Instant {
  if (!Number.isSafeInteger(milliseconds)) {
    throw new RangeError('An instant is a whole number of milliseconds');
  }
  return milliseconds as Instant;
}

const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;

/**
 * Reads a date and time such as "2026-09-28T10:15:00Z" or
 * "2026-09-28T11:15:00+01:00". Refuses one without a zone: "2026-09-28T11:15"
 * could be UTC or UK time, and the two differ for half the year.
 */
export function instantFromIso(text: string): Instant {
  const parts = ISO_WITH_ZONE.exec(text);
  if (!parts) {
    throw new RangeError('A date and time needs a zone, such as Z or +01:00');
  }
  const [, y, mo, d, h, mi, s = '0', ms = '0', utc, sign, oh = '0', om = '0'] = parts;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const offsetHours = Number(oh);
  const offsetMinutes = Number(om);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHours > 23 ||
    offsetMinutes > 59
  ) {
    throw new RangeError('Not a real date and time');
  }
  const offset = utc ? 0 : (sign === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60_000;
  const millisecond = Number(ms.padEnd(3, '0'));
  return instant(Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offset);
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

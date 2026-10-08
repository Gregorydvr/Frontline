// Turns one history entry into the line the owner reads. An entry holds no
// words, so its line is made here each time it is shown.
//
// Two forms (section 6 of docs/build-brief.md):
// - "job", on a job's page: no "her" or "his", since the record does not
//   reliably know which. "Sent a confirmation."
// - "feed", in Done for you: names the customer. "Sent Mrs Green a confirmation."
//
// The words are data, kept apart from the code below. They come from the
// example app and the brief; the pull request for slice B lists the few that
// are new. Lines in the app keep the example's curly apostrophe. Texts to
// customers, which must use straight ones, come in slice D.

import type { Instant } from './clock';
import { inLondon, londonDay, MONTHS, WEEKDAYS } from './london';
import type { HistoryEntry, HistoryKind, VisitKind } from './record/types';

export type LineForm = 'job' | 'feed';

/**
 * The words for each kind of entry, or null for a kind the owner is not shown.
 * The gaps are:
 * - {customer}: the customer's name as given, such as "Mrs Green"
 * - {customer’s}: the same, as in "Mrs Green’s"
 * - {visit} and {Visit}: the kind of visit, such as "quote visit"
 * - {short visit}: the shorter word, such as "visit"
 * - {when}: the visit's day and time, such as "Monday, 9am"
 */
export const HISTORY_WORDS: Readonly<Record<HistoryKind, Readonly<Record<LineForm, string>> | null>> = {
  call_answered: {
    job: 'Answered the call.',
    feed: 'Call from {customer} answered.',
  },
  passed_to_owner: {
    job: 'Passed straight to you.',
    feed: 'Call from {customer}. Passed straight to you.',
  },
  // Part of answering the call. The example never shows it.
  details_taken: null,
  visit_booked: {
    job: '{Visit} booked for {when}.',
    feed: 'Booked {customer’s} {visit} for {when}.',
  },
  confirmation_sent: {
    job: 'Sent a confirmation.',
    feed: 'Sent {customer} a confirmation.',
  },
  reminder_sent: {
    job: 'Sent a reminder about the {short visit}.',
    feed: 'Reminded {customer} about the {short visit}.',
  },
  // For the control room, in slice G.
  service_on: null,
  service_off: null,
  stop_on: null,
  stop_off: null,
};

/** The words for each kind of visit. */
export const VISIT_WORDS: Readonly<Record<VisitKind, { name: string; short: string }>> = {
  quote_visit: { name: 'quote visit', short: 'visit' },
  install: { name: 'install', short: 'install' },
  service: { name: 'service', short: 'service' },
};

/** The line the owner reads for one entry, or null for a kind the owner is not shown. */
export function historyLine(entry: HistoryEntry, form: LineForm): string | null {
  const words = HISTORY_WORDS[entry.kind]?.[form];
  if (words === undefined) {
    return null;
  }
  return words.replace(/\{([^{}]+)\}/g, (_, gap: string) => fill(gap, entry));
}

function fill(gap: string, entry: HistoryEntry): string {
  switch (gap) {
    case 'customer':
      return customerName(entry);
    case 'customer’s':
      return `${customerName(entry)}’s`;
    case 'visit':
      return visitWords(entry).name;
    case 'Visit':
      return capitalised(visitWords(entry).name);
    case 'short visit':
      return visitWords(entry).short;
    case 'when':
      return whenWords(visitOf(entry).startsAt, entry.at);
    default:
      throw new RangeError('The words have a gap this does not know');
  }
}

/**
 * A visit's day and time as the owner reads it, seen from the moment of the
 * entry: the day's name for a visit in the next six days ("Monday, 9am"),
 * and the date beyond that ("Wednesday 21 October, 2pm"). The year is added
 * only when it is not the entry's year. All in UK time.
 */
export function whenWords(visitAt: Instant, from: Instant): string {
  const visit = inLondon(visitAt);
  const ahead = londonDay(visitAt) - londonDay(from);
  const weekday = WEEKDAYS[visit.weekday] ?? '';
  let day = weekday;
  if (ahead < 0 || ahead > 6) {
    day = `${weekday} ${String(visit.day)} ${MONTHS[visit.month - 1] ?? ''}`;
    if (visit.year !== inLondon(from).year) {
      day += ` ${String(visit.year)}`;
    }
  }
  return `${day}, ${clockWords(visit.hour, visit.minute)}`;
}

/** "9am", "8:30am", "2pm", "midday", "midnight". */
export function clockWords(hour: number, minute: number): string {
  if (minute === 0 && hour === 12) return 'midday';
  if (minute === 0 && hour === 0) return 'midnight';
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  const half = hour < 12 ? 'am' : 'pm';
  return minute === 0 ? `${String(shown)}${half}` : `${String(shown)}:${String(minute).padStart(2, '0')}${half}`;
}

function customerName(entry: HistoryEntry): string {
  if (entry.customer === null) {
    throw new RangeError('This line needs the customer');
  }
  return entry.customer.name;
}

function visitOf(entry: HistoryEntry): NonNullable<HistoryEntry['visit']> {
  if (entry.visit === null) {
    throw new RangeError('This line needs the visit');
  }
  return entry.visit;
}

function visitWords(entry: HistoryEntry): { name: string; short: string } {
  return VISIT_WORDS[visitOf(entry).kind];
}

function capitalised(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

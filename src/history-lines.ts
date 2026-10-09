// Turns one history entry into the line the owner reads. An entry holds no
// words, so its line is made here each time it is shown.
//
// Two forms (section 6 of docs/build-brief.md):
// - "job", on a job's page: no "her" or "his", since the record does not
//   reliably know which. "Sent a confirmation."
// - "feed", in Done for you: names the customer. "Sent Mrs Green a confirmation."
//
// The words are data, kept apart from the code below. They come from the
// example app and the brief; the pull requests for slices B and D list the
// few that are new. A firm can have its own words for any line, stored with
// its agreed wording (src/record/wording.ts); where it has none, these are
// used. Lines in the app keep the example's curly apostrophe. Texts, which
// must use straight ones, are made in src/messages.ts.

import type { Instant } from './clock';
import { inLondon, londonDay, MONTHS, WEEKDAYS } from './london';
import { nationalNumber } from './phone';
import type { FirmWording, HistoryEntry, HistoryKind, VisitKind } from './record/types';

export type LineForm = 'job' | 'feed';

/**
 * The words for each kind of entry, or null for a kind the owner is not shown.
 * The gaps are:
 * - {customer}: the customer's name as given, such as "Mrs Green"
 * - {customer’s}: the same, as in "Mrs Green’s"
 * - {visit} and {Visit}: the kind of visit, such as "quote visit"
 * - {short visit}: the shorter word, such as "visit"
 * - {when}: the visit's day and time, such as "Monday, 9am"
 * - {caller}: who rang, for a caller who is not a customer, such as "a supplier"
 * - {message}: the one line about their call, such as "Your order is ready to
 *   collect." Left out when there is none.
 * - {words}: what a customer wrote in a text, as they wrote it
 * - {number}: the number a call came from, such as "07700 900123", or "a
 *   withheld number"
 * A form that is null is not shown in that place.
 */
export const HISTORY_WORDS: Readonly<Record<HistoryKind, Readonly<Record<LineForm, string | null>> | null>> = {
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
  // New in slice E: a visit moved or cancelled, and a customer checking
  // their details from their link. Flagged in the pull request. {when} is
  // the visit's time now, so a visit moved twice shows its latest time.
  visit_moved: {
    job: '{Visit} moved to {when}.',
    feed: 'Moved {customer’s} {visit} to {when}.',
  },
  visit_cancelled: {
    job: '{Visit} cancelled.',
    feed: 'Cancelled {customer’s} {visit}.',
  },
  details_confirmed: {
    job: 'They checked their details.',
    feed: '{customer} checked their details.',
  },
  details_corrected: {
    job: 'They corrected their details.',
    feed: '{customer} corrected their details.',
  },
  // A caller who is not a customer has no job page, so both forms are the
  // example's line in Done for you.
  message_taken: {
    job: 'Call from {caller}. {message}',
    feed: 'Call from {caller}. {message}',
  },
  // A call whose details did not all come through has no job page. New in
  // slice F; flagged in its pull request. {number} is the number it came
  // from, or "a withheld number".
  details_missing: {
    job: null,
    feed: 'Call from {number}. Details missing.',
  },
  // New in slice D, after the example's "Voice note: “Running 20 minutes
  // late.”". A customer's text is shown on their job, not in Done for you,
  // which lists what was done for the owner.
  text_received: {
    job: 'Text: “{words}”',
    feed: null,
  },
  // After a customer's STOP or START, on the job their text went on. Greg,
  // 8 Oct 2026. An opt-out made some other way names no job, so it shows on
  // no job page.
  opted_out: {
    job: 'No more texts will go to them.',
    feed: null,
  },
  opted_in: {
    job: 'Texts can go to them again.',
    feed: null,
  },
  // For the control room, in slice G.
  service_on: null,
  service_off: null,
  stop_on: null,
  stop_off: null,
  number_set: null,
  urgent_list_set: null,
  owner_mobile_set: null,
  diary_rules_set: null,
  // An owner logging in and out, and writing to Front-line in Message us:
  // recorded for who did what (rule 15), and not lines the owner reads.
  logged_in: null,
  logged_out: null,
  owner_message_sent: null,
};

/** The words for each kind of visit. */
export const VISIT_WORDS: Readonly<Record<VisitKind, { name: string; short: string }>> = {
  quote_visit: { name: 'quote visit', short: 'visit' },
  install: { name: 'install', short: 'install' },
  service: { name: 'service', short: 'service' },
};

/**
 * The line the owner reads for one entry, or null for a kind the owner is not
 * shown in that place. The firm's own words for the line are used when it
 * has them.
 */
export function historyLine(entry: HistoryEntry, form: LineForm, firmWords: FirmWording = {}): string | null {
  const ours = HISTORY_WORDS[entry.kind]?.[form];
  if (ours === undefined || ours === null) {
    return null;
  }
  const words = firmWords[`line:${entry.kind}:${form}`]?.words ?? ours;
  // A gap left empty at the end, such as a missing {message}, leaves no space behind.
  return words.replace(/\{([^{}]+)\}/g, (_, gap: string) => fill(gap, entry)).trimEnd();
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
    case 'caller':
      return callOf(entry).caller ?? missing('This line needs who rang');
    case 'message':
      return callOf(entry).summary ?? '';
    case 'words':
      return (entry.textIn ?? missing('This line needs the text')).words;
    case 'number': {
      const from = callOf(entry).from;
      return from === null ? 'a withheld number' : nationalNumber(from);
    }
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

function callOf(entry: HistoryEntry): NonNullable<HistoryEntry['call']> {
  return entry.call ?? missing('This line needs the call');
}

function missing(what: string): never {
  throw new RangeError(what);
}

function visitWords(entry: HistoryEntry): { name: string; short: string } {
  return VISIT_WORDS[visitOf(entry).kind];
}

/** "quote visit" as "Quote visit", "a supplier" as "A supplier". */
export function capitalised(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

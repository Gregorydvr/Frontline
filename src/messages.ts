// The words of each kind of text. A firm's own wording, agreed at set-up, is
// kept in the record (src/record/wording.ts); send() makes every text from it
// and from facts in the record, so no text can carry words nobody agreed
// (rule 2 in CLAUDE.md). The drafts here are where a firm's wording starts.
//
// Texts carry plain text characters only (rule 4): straight quotes, no emoji.
// A test reads every draft and fails on anything else.

import type { Instant } from './clock';
import { plainForText } from './gsm';
import { inLondon, londonInstant } from './london';
import type { MessageKind } from './record/types';

/**
 * The drafts. The gaps each kind may use are in MESSAGE_KINDS in
 * src/record/types.ts:
 * - visit_reminder: {owner}, the owner's name; {weekday}, the visit's day,
 *   such as "Thursday"; {time}, such as "3pm"
 * - urgent_alert: {customer}, {place}, {summary}, the one line about the
 *   call, and {number}, the number to ring them on
 * - urgent_alert_details_missing: {summary} and {number}
 *
 * A firm with no agreed wording for a kind gets no text of that kind: send()
 * refuses it.
 */
export const DRAFT_WORDING: Readonly<Record<MessageKind, string | null>> = {
  // From section 6 of docs/build-brief.md, with a straight apostrophe.
  visit_reminder: "Reminder: {owner}'s visit is tomorrow, {weekday}, at {time}. See you then.",
  // Greg's answer to open question 7, 8 Oct 2026. "Front-line:" tells the
  // owner it is not a customer's text, since it comes from the firm's own
  // number. A link to the job comes once the owner can log in (slice F).
  urgent_alert: 'Front-line: urgent call from {customer}, {place}. {summary} Their number: {number}.',
  // For an urgent call whose caller's details did not all come through.
  // Greg, 8 Oct 2026.
  urgent_alert_details_missing: 'Front-line: urgent call. Not all their details came through. {summary} Their number: {number}.',
};

/** The facts that fill a text's gaps. A fact that is null, such as a missing summary, leaves its gap empty. */
export type Facts = Readonly<Record<string, string | null>>;

/**
 * Makes a text from the firm's words and the facts. The facts are what
 * callers said and the record holds, so each is made fit for a text first:
 * curly quotes become straight, and anything else a text cannot carry
 * becomes "?". The firm's own words are used as they are. An empty gap
 * leaves no doubled space behind.
 */
export function makeWords(words: string, facts: Facts): string {
  const filled = words.replace(/\{([^{}]+)\}/g, (_, gap: string) => {
    const fact = facts[gap];
    if (fact === undefined) {
      throw new RangeError('The words have a gap with no fact for it');
    }
    return fact === null ? '' : plainForText(fact.replace(/\s+/g, ' ').trim());
  });
  return filled
    .split('\n')
    .map((part) => part.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .trim();
}

/**
 * The words that opt a number out of every text from a firm, and back in
 * (Greg's answer to open question 2, 8 Oct 2026). Only the whole text counts,
 * in any capitals, with spaces trimmed: "Please stop texting me" is stored and
 * shown, and nothing more. What a customer writes is data, never instructions
 * (rule 17), so nothing else in a text is acted on.
 */
const STOP_WORDS: readonly string[] = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
const START_WORDS: readonly string[] = ['START', 'UNSTOP'];

export function stopOrStart(words: string): 'stop' | 'start' | null {
  const word = words.trim().toUpperCase();
  if (STOP_WORDS.includes(word)) return 'stop';
  if (START_WORDS.includes(word)) return 'start';
  return null;
}

/**
 * Quiet hours: no text goes to a customer from 8pm to 8am UK time, any day
 * (Greg's answer to open question 8, 8 Oct 2026). The same for every firm for
 * now. Alerts to the owner go at any hour.
 */
export const QUIET_HOURS = { from: 20, to: 8 } as const;

/** When quiet hours end, if `at` falls in them: 8am that morning or the next. Otherwise null. */
export function quietUntil(at: Instant): Instant | null {
  const { year, month, day, hour } = inLondon(at);
  if (hour >= QUIET_HOURS.from) {
    return londonInstant(year, month, day + 1, QUIET_HOURS.to);
  }
  if (hour < QUIET_HOURS.to) {
    return londonInstant(year, month, day, QUIET_HOURS.to);
  }
  return null;
}

// The words of each kind of text. A firm's own wording, agreed at set-up, is
// kept in the record (src/record/wording.ts); send() makes every text from it
// and from facts in the record, so no text can carry words nobody agreed
// (rule 2 in CLAUDE.md). The drafts here are where a firm's wording starts.
//
// Texts carry plain text characters only (rule 4): straight quotes, no emoji.
// A test reads every draft and fails on anything else.

import { plainForText } from './gsm';
import type { MessageKind } from './record/types';

/**
 * The drafts. The gaps each kind may use are in MESSAGE_KINDS in
 * src/record/types.ts:
 * - visit_reminder: {owner}, the owner's name; {weekday}, the visit's day,
 *   such as "Thursday"; {time}, such as "3pm"
 * - urgent_alert: {customer}, {place}, {summary}, the one line about the
 *   call, and {number}, the number to ring them on
 */
export const DRAFT_WORDING: Readonly<Record<MessageKind, string | null>> = {
  // From section 6 of docs/build-brief.md, with a straight apostrophe.
  visit_reminder: "Reminder: {owner}'s visit is tomorrow, {weekday}, at {time}. See you then.",
  // A named gap: the words of the owner's alert for an urgent call are open
  // question 7 in docs/decisions.md. A firm with no agreed wording for a kind
  // gets no text of that kind: send() refuses it.
  urgent_alert: null,
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

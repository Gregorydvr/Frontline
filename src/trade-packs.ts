// Trade starter packs (task 2 of queue 2 in docs/autopilot.md). When staff
// choose a firm's trade at set-up, its pack fills in what the firm does not
// have yet: what counts as urgent, when visits can be booked, and the drafts
// its texts start from. A pack only fills in: staff change any of it on the
// firm's set-up pages, on the owner's word, as before. Nothing here is ever
// sent: a text still goes only in words the owner agreed (rule 2).
//
// Everything an owner or a customer would read is [to agree] with Greg
// (docs/texts-to-agree.md): the urgent lists, which the owner reads in Your
// rules and which name urgent calls, and the drafts. The hours and visit
// lengths are the build's starting points, for Greg to check too.
//
// Nothing here touches the database.

import { DRAFT_WORDING } from './messages';
import type { DiaryRules, MessageKind, Trade } from './record/types';

export interface TradePack {
  /** What counts as urgent, as the owner reads it and the voice agent matches it. [to agree] */
  urgentList: readonly string[];
  /** When visits can be booked, and how long each kind takes. */
  diaryRules: DiaryRules;
  /** The trade's own drafts, where they differ from the drafts in src/messages.ts. [to agree] */
  wording: Readonly<Partial<Record<MessageKind, string>>>;
}

const MONDAY_TO_FRIDAY = [1, 2, 3, 4, 5] as const;
const MONDAY_TO_SATURDAY = [1, 2, 3, 4, 5, 6] as const;

/** The reminder with one line about what the visit needs, in the firm's own voice. [to agree] */
function reminderNeeding(line: string): string {
  return `Reminder: {owner}'s visit is tomorrow, {weekday}, at {time}. ${line} See you then.`;
}

export const TRADE_PACKS: Readonly<Record<Trade, TradePack>> = {
  plumbing_heating: {
    // The demo firm's and the practice firm's lists, with a burst pipe and a
    // carbon monoxide alarm, which the practice agent met on 15 Oct 2026.
    urgentList: ['a leak', 'a burst pipe', 'a smell of gas', 'a carbon monoxide alarm'],
    diaryRules: {
      days: MONDAY_TO_FRIDAY,
      opens: 8 * 60,
      closes: 17 * 60,
      every: 60,
      lengths: { quote_visit: 60, service: 60 },
      daysAhead: 14,
      nextDayFrom: 12 * 60,
    },
    wording: {
      visit_reminder: reminderNeeding('Please make sure we can get to the boiler and the pipes.'),
    },
  },
  drainage: {
    urgentList: ['sewage coming up', 'a drain overflowing', 'the only toilet blocked'],
    diaryRules: {
      days: MONDAY_TO_SATURDAY,
      opens: 8 * 60,
      closes: 18 * 60,
      every: 60,
      lengths: { quote_visit: 45 },
      daysAhead: 7,
      // Drains are rarely left to wait: from 8am on the next day it works.
      nextDayFrom: 8 * 60,
    },
    wording: {
      visit_reminder: reminderNeeding('Please make sure we can get to the drain covers.'),
    },
  },
  electrical: {
    urgentList: ['no power', 'a burning smell', 'sparks from a socket or switch', 'water near electrics', 'an electric shock'],
    diaryRules: {
      days: MONDAY_TO_FRIDAY,
      opens: 8 * 60,
      closes: 17 * 60,
      every: 60,
      lengths: { quote_visit: 60 },
      daysAhead: 14,
      nextDayFrom: 12 * 60,
    },
    wording: {
      visit_reminder: reminderNeeding('Please make sure we can get to the fuse box.'),
    },
  },
};

/**
 * The draft a firm's wording for a kind of text starts from: its trade's own,
 * or the draft every firm starts from. Null for a kind with no draft.
 */
export function draftFor(trade: Trade | null, kind: MessageKind): string | null {
  return (trade === null ? undefined : TRADE_PACKS[trade].wording[kind]) ?? DRAFT_WORDING[kind];
}

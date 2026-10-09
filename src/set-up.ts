// Setting up a firm (slice H2 of docs/build-brief.md): the checks on what
// staff enter, each with its reason, and what a firm still needs before
// Calls & bookings. The record refuses on the same checks (src/record/), and
// the control room shows their reasons, so the two can never disagree.
// Nothing here touches the database.

import { notGsm7, plainForText } from './gsm';
import { VISIT_PURPOSES, type Facts } from './messages';
import { nationalNumber, type UkMobile } from './phone';
import {
  CALL_LIMITS,
  CUSTOMER_LIMITS,
  HISTORY_KINDS,
  LINE_GAPS,
  MESSAGE_KINDS,
  TEXT_LIMITS,
  VISIT_KINDS,
  type Firm,
  type FirmWording,
  type MessageKind,
  type Owner,
  type VisitKind,
} from './record/types';

/** Why some words cannot be a firm's wording. */
export type WordingProblem =
  | { kind: 'empty' }
  | { kind: 'too_long'; longest: number }
  /** Tabs, or line breaks other than a plain new line. */
  | { kind: 'spacing' }
  /** For one of the owner's lines: it must be one line. */
  | { kind: 'two_lines' }
  | { kind: 'not_gsm7'; characters: string[] }
  | { kind: 'unknown_gap'; gap: string }
  | { kind: 'stray_brace' }
  /** A text that must carry its link, without {link}. */
  | { kind: 'needs_link' }
  /** The first text to a customer, without the line on opting out. */
  | { kind: 'needs_stop' }
  | { kind: 'unknown_key' };

/**
 * The word the first text to a customer must hold, so it tells them how to
 * opt out. The build's reading of question 3 of the slice H2 plan, waiting
 * for Greg.
 */
export const OPT_OUT_WORD = 'STOP';

/**
 * Why some words cannot be the firm's wording for a key (a WordingKey, or
 * anything staff or a caller might name), or nothing when they can. A text carries plain text characters only (rule 4), uses only
 * the gaps its kind has, and carries {link} when it must. An owner's line is
 * one line.
 */
export function wordingProblems(key: string, words: string): WordingProblem[] {
  if (typeof words !== 'string' || words.trim() === '') {
    return [{ kind: 'empty' }];
  }
  const problems: WordingProblem[] = [];
  if (words.length > TEXT_LIMITS.words) {
    problems.push({ kind: 'too_long', longest: TEXT_LIMITS.words });
  }
  if (/[\r\t\v\f]/.test(words)) {
    problems.push({ kind: 'spacing' });
  }
  const [type, name, form] = key.split(':');
  let gaps: readonly string[];
  if (type === 'text' && name !== undefined && form === undefined && Object.hasOwn(MESSAGE_KINDS, name)) {
    const kind = MESSAGE_KINDS[name as MessageKind];
    const cannot = notGsm7(words);
    if (cannot.length > 0) {
      problems.push({ kind: 'not_gsm7', characters: cannot });
    }
    gaps = kind.gaps;
    if (kind.linkRequired && !gapsIn(words).includes('link')) {
      problems.push({ kind: 'needs_link' });
    }
    if (name === 'visit_confirmation_first' && !words.includes(OPT_OUT_WORD)) {
      problems.push({ kind: 'needs_stop' });
    }
  } else if (type === 'line' && name !== undefined && Object.hasOwn(HISTORY_KINDS, name) && (form === 'job' || form === 'feed')) {
    if (words.includes('\n')) {
      problems.push({ kind: 'two_lines' });
    }
    gaps = LINE_GAPS;
  } else {
    return [{ kind: 'unknown_key' }];
  }
  // Every brace must open or close a known gap.
  const found = gapsIn(words);
  if ((words.match(/[{}]/g) ?? []).length !== found.length * 2 || found.includes('')) {
    problems.push({ kind: 'stray_brace' });
  }
  for (const gap of new Set(found)) {
    if (gap !== '' && !gaps.includes(gap)) {
      problems.push({ kind: 'unknown_gap', gap });
    }
  }
  return problems;
}

/** The gaps in some words, such as "owner" in "Reminder: {owner}'s visit". */
export function gapsIn(words: string): string[] {
  return [...words.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? '');
}

/** The longest a visit may be, and the most days ahead times may be offered. */
export const DIARY_LIMITS = { length: 12 * 60, daysAhead: 90, every: 5 } as const;

/** Why some diary rules do not make sense. */
export type DiaryProblem =
  | { kind: 'no_days' }
  | { kind: 'hours' }
  | { kind: 'every' }
  | { kind: 'days_ahead' }
  | { kind: 'length'; visit: VisitKind | null };

/**
 * Why some rules for when visits can be booked do not make sense, or nothing
 * when they do: days of the week, hours within a day, the last start before
 * the close, lengths that fit. It takes anything, since types can be got
 * round.
 */
export function diaryRulesProblems(rules: unknown): DiaryProblem[] {
  if (typeof rules !== 'object' || rules === null) return [{ kind: 'no_days' }];
  const { days, opens, closes, every, lengths, daysAhead } = rules as Record<string, unknown>;
  const minuteOfDay = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 24 * 60;
  const problems: DiaryProblem[] = [];
  if (
    !Array.isArray(days) ||
    days.length === 0 ||
    !days.every((day) => Number.isSafeInteger(day) && day >= 0 && day <= 6) ||
    new Set(days).size !== days.length
  ) {
    problems.push({ kind: 'no_days' });
  }
  const hours = minuteOfDay(opens) && minuteOfDay(closes) && opens < closes;
  if (!hours) {
    problems.push({ kind: 'hours' });
  }
  if (!Number.isSafeInteger(every) || (every as number) < DIARY_LIMITS.every || (hours && (every as number) > closes - opens)) {
    problems.push({ kind: 'every' });
  }
  if (!Number.isSafeInteger(daysAhead) || (daysAhead as number) < 1 || (daysAhead as number) > DIARY_LIMITS.daysAhead) {
    problems.push({ kind: 'days_ahead' });
  }
  if (typeof lengths !== 'object' || lengths === null || Array.isArray(lengths)) {
    problems.push({ kind: 'length', visit: null });
  } else {
    const longest = hours ? Math.min(DIARY_LIMITS.length, closes - opens) : DIARY_LIMITS.length;
    for (const [kind, length] of Object.entries(lengths)) {
      if (!VISIT_KINDS.includes(kind as VisitKind)) {
        problems.push({ kind: 'length', visit: null });
      } else if (!Number.isSafeInteger(length) || (length as number) < DIARY_LIMITS.every || (length as number) > longest) {
        problems.push({ kind: 'length', visit: kind as VisitKind });
      }
    }
  }
  return problems;
}

/** The most items an urgent list holds, and the longest an item may be. */
export const URGENT_LIST_LIMITS = { items: 20, length: 60 } as const;

/** Why an urgent list cannot be the firm's. */
export type UrgentListProblem = { kind: 'too_many' } | { kind: 'item'; item: string } | { kind: 'twice'; item: string };

/** Why some items cannot be the firm's urgent list, or nothing when they can: short single lines, none twice. */
export function urgentListProblems(items: readonly string[]): UrgentListProblem[] {
  const problems: UrgentListProblem[] = [];
  if (items.length > URGENT_LIST_LIMITS.items) {
    problems.push({ kind: 'too_many' });
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (item.trim() === '' || item.length > URGENT_LIST_LIMITS.length || /\p{Cc}/u.test(item)) {
      problems.push({ kind: 'item', item });
    } else if (seen.has(item.toLowerCase())) {
      problems.push({ kind: 'twice', item });
    }
    seen.add(item.toLowerCase());
  }
  return problems;
}

/** The longest a firm's name and an owner's name may be. */
export const NAME_LIMITS = { firm: 120, owner: 60 } as const;

/** Why a name cannot be a firm's or an owner's. */
export type NameProblem = { kind: 'empty' } | { kind: 'too_long'; longest: number } | { kind: 'not_gsm7'; characters: string[] };

/**
 * Why a name cannot be a firm's or an owner's, or nothing when it can. A
 * name fills {firm} or {owner} in texts, so a text must be able to carry it:
 * curly quotes are made straight there, and nothing else may need changing.
 */
export function nameProblems(name: string, longest: number): NameProblem[] {
  if (typeof name !== 'string' || name.trim() === '') return [{ kind: 'empty' }];
  const problems: NameProblem[] = [];
  if (name.length > longest || /\p{Cc}/u.test(name)) {
    problems.push({ kind: 'too_long', longest });
  }
  const changed = Array.from(name).filter((character) => plainForText(character) === '?' && character !== '?');
  if (changed.length > 0) {
    problems.push({ kind: 'not_gsm7', characters: [...new Set(changed)] });
  }
  return problems;
}

/** The kinds of text a firm needs agreed wording for before Calls & bookings: every kind there is in Release 1. */
export const CALLS_WORDING: readonly MessageKind[] = Object.keys(MESSAGE_KINDS) as MessageKind[];

/** Something a firm still needs before Calls & bookings can be switched on. */
export type SetUpGap =
  | { kind: 'number' }
  | { kind: 'owner' }
  | { kind: 'owner_mobile' }
  | { kind: 'urgent_list' }
  | { kind: 'diary' }
  | { kind: 'quote_visit_length' }
  | { kind: 'wording'; missing: MessageKind[] };

/**
 * What the firm still needs before Calls & bookings can be switched on: its
 * number, an owner with a mobile, at least one item on its urgent list (the
 * build's reading of question 4 of the slice H2 plan, waiting for Greg),
 * when visits can be booked with a length for a quote visit (the only kind
 * the voice agent books), and agreed wording for every kind of text. Its
 * agent in Vapi and its number in Twilio are set up outside, and cannot be
 * checked here.
 */
export function callsSetUpGaps(firm: Firm, owners: readonly Owner[], wording: FirmWording): SetUpGap[] {
  const gaps: SetUpGap[] = [];
  if (firm.phoneNumber === null) gaps.push({ kind: 'number' });
  if (owners.length === 0) gaps.push({ kind: 'owner' });
  else if (!owners.some((owner) => owner.mobile !== null)) gaps.push({ kind: 'owner_mobile' });
  if (firm.urgentList.length === 0) gaps.push({ kind: 'urgent_list' });
  if (firm.diaryRules === null) gaps.push({ kind: 'diary' });
  else if (firm.diaryRules.lengths.quote_visit === undefined) gaps.push({ kind: 'quote_visit_length' });
  const missing = CALLS_WORDING.filter((kind) => wording[`text:${kind}`] === undefined);
  if (missing.length > 0) gaps.push({ kind: 'wording', missing });
  return gaps;
}

/** Where the links in a firm's texts point: the copy's own addresses, or, while they are empty, one of a likely length. */
export interface PreviewAddresses {
  /** Where customers' links are served. */
  links: string | null;
  /** The owner's app. */
  app: string | null;
}

/** An address of the length the real ones are likely to have, for a preview while a copy has none. */
const LIKELY_ADDRESS = 'https://app.example.co.uk';
/** An id of the length the real ones have, for a preview. */
const AN_ID = '0'.repeat(26);

/**
 * The facts a preview of a firm's text is made from: the firm's own name and
 * owner, and the rest from the example's invented Mrs Ahmed, or, with
 * `longest`, each gap as long as a call can make it. Links are the length a
 * real one is.
 */
export function previewFacts(kind: MessageKind, firm: Firm, owner: Owner | null, addresses: PreviewAddresses, longest: boolean): Facts {
  const links = addresses.links ?? LIKELY_ADDRESS;
  const app = addresses.app ?? LIKELY_ADDRESS;
  const long = (length: number) => 'a'.repeat(length);
  const all: Record<string, string> = {
    customer: longest ? long(CUSTOMER_LIMITS.name) : 'Mrs Ahmed',
    firm: firm.name,
    owner: owner?.name ?? firm.name,
    day: longest ? 'Wednesday 30 September' : 'Thursday 1 October',
    time: longest ? '10:30am' : '3pm',
    weekday: longest ? 'Wednesday' : 'Thursday',
    purpose: longest ? Object.values(VISIT_PURPOSES).reduce((x, y) => (y.length > x.length ? y : x)) : VISIT_PURPOSES.quote_visit,
    place: longest ? long(CALL_LIMITS.place) : '27 Station Road',
    summary: longest ? long(CALL_LIMITS.summary) : 'Her boiler keeps cutting out.',
    number: nationalNumber('+447700900003' as UkMobile),
    link:
      kind === 'login_link' ? `${app}/in/${AN_ID}` : kind === 'urgent_alert' ? `${app}/jobs/${AN_ID}` : `${links}/d/${AN_ID}`,
  };
  return Object.fromEntries(MESSAGE_KINDS[kind].gaps.map((gap) => [gap, all[gap] ?? null]));
}

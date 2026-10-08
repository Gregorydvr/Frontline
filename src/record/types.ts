// The shapes the record layer takes and gives back. Lists that later slices
// will add to are here, and are checked by the record layer, not the database.

import type { Instant } from '../clock';
import type { Id } from '../ids';
import type { UkLandline, UkMobile } from '../phone';

declare const firmBrand: unique symbol;
declare const ownerBrand: unique symbol;
declare const staffBrand: unique symbol;
declare const customerBrand: unique symbol;
declare const jobBrand: unique symbol;
declare const visitBrand: unique symbol;
declare const historyBrand: unique symbol;
declare const callBrand: unique symbol;
declare const dueBrand: unique symbol;
declare const messageBrand: unique symbol;
declare const textInBrand: unique symbol;
declare const wordingBrand: unique symbol;

// Each kind of id is its own type, so one cannot be passed for another.
export type FirmId = Id & { readonly [firmBrand]: true };
export type OwnerId = Id & { readonly [ownerBrand]: true };
export type StaffId = Id & { readonly [staffBrand]: true };
export type CustomerId = Id & { readonly [customerBrand]: true };
export type JobId = Id & { readonly [jobBrand]: true };
export type VisitId = Id & { readonly [visitBrand]: true };
export type HistoryId = Id & { readonly [historyBrand]: true };
export type CallId = Id & { readonly [callBrand]: true };
export type DueId = Id & { readonly [dueBrand]: true };
export type MessageId = Id & { readonly [messageBrand]: true };
export type TextInId = Id & { readonly [textInBrand]: true };
export type WordingId = Id & { readonly [wordingBrand]: true };

/** The five services, by the example app's names for them. */
export const SERVICES = ['calls', 'quotes', 'followups', 'paperwork', 'invoices'] as const;
export type Service = (typeof SERVICES)[number];

export interface Firm {
  id: FirmId;
  name: string;
  isExample: boolean;
  /** Which services are switched on. */
  services: Readonly<Record<Service, boolean>>;
  /** The stop button: when on, nothing goes to this firm's customers. */
  stopped: boolean;
  /** The number its customers ring and text, once it has one. */
  phoneNumber: UkMobile | null;
  /** What counts as urgent, set at set-up: short words such as "a leak". */
  urgentList: readonly string[];
  createdAt: Instant;
}

export interface Owner {
  id: OwnerId;
  name: string;
  /** For alerts and, from slice F, the login link. */
  mobile: UkMobile | null;
  createdAt: Instant;
}

/** Why no text can reach a customer: their number was withheld, or they rang from a landline. */
export const NO_TEXT_REASONS = ['withheld', 'landline'] as const;
export type NoTextReason = (typeof NO_TEXT_REASONS)[number];

export interface Customer {
  id: CustomerId;
  /** The name as given, such as "Mrs Green". */
  name: string;
  mobile: UkMobile | null;
  /** A landline they rang from, so the owner can ring back. */
  landline: UkLandline | null;
  /** Set when they have no mobile, because then no text can reach them. */
  noText: NoTextReason | null;
  createdAt: Instant;
}

export interface Job {
  id: JobId;
  customer: CustomerId;
  /** What it is about, such as "No hot water". */
  about: string;
  /** Where, such as "24 Beech Avenue". */
  place: string;
  urgent: boolean;
  createdAt: Instant;
}

export const VISIT_KINDS = ['quote_visit', 'install', 'service'] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];

export const VISIT_STATES = ['booked', 'cancelled'] as const;
export type VisitState = (typeof VISIT_STATES)[number];

export interface Visit {
  id: VisitId;
  job: JobId;
  startsAt: Instant;
  kind: VisitKind;
  state: VisitState;
  createdAt: Instant;
}

/** Who did something. A customer is the customer the entry is about. */
export type Actor =
  | { kind: 'frontline' }
  | { kind: 'owner'; owner: OwnerId }
  | { kind: 'customer' }
  | { kind: 'staff'; staff: StaffId };

/**
 * The kinds of history entry. Each says what it is about:
 * - a job: call_answered, passed_to_owner. A call_answered entry written by
 *   recordCall() also names its call. passed_to_owner is written when the
 *   owner's urgent alert has gone (markMessageSent()), or by the demo firm.
 * - a customer: details_taken, and opted_out and opted_in, which also name
 *   the kind of text
 * - a visit: visit_booked, confirmation_sent, reminder_sent
 * - a call with no customer or job: message_taken, for a caller who is not
 *   a customer, and details_missing, for a call whose details did not come
 *   through. Written only by recordCall().
 * - a text that came in: text_received, written only by recordTextIn(), on
 *   the customer's job when it has one
 * - the firm itself: service_on, service_off, stop_on, stop_off, number_set,
 *   urgent_list_set, owner_mobile_set, written only by the functions in
 *   firms.ts and owners.ts
 * Later slices add their own.
 */
export const HISTORY_KINDS = {
  call_answered: 'job',
  passed_to_owner: 'job',
  details_taken: 'customer',
  visit_booked: 'visit',
  confirmation_sent: 'visit',
  reminder_sent: 'visit',
  message_taken: 'call',
  details_missing: 'call',
  opted_out: 'opt_out',
  opted_in: 'opt_out',
  text_received: 'text',
  service_on: 'service',
  service_off: 'service',
  stop_on: 'firm',
  stop_off: 'firm',
  number_set: 'firm',
  urgent_list_set: 'firm',
  owner_mobile_set: 'firm',
} as const;
export type HistoryKind = keyof typeof HISTORY_KINDS;

type KindAbout<About> = {
  [K in HistoryKind]: (typeof HISTORY_KINDS)[K] extends About ? K : never;
}[HistoryKind];

/** A history entry to add, about a job, a customer or a visit. */
export type NewHistory =
  | { kind: KindAbout<'job'>; by: Actor; job: JobId }
  | { kind: KindAbout<'customer'>; by: Actor; customer: CustomerId }
  | { kind: KindAbout<'visit'>; by: Actor; visit: VisitId };

/**
 * A history entry as read back, with what the line an owner reads is made
 * from: the customer's name and the visit's kind and time.
 */
export interface HistoryEntry {
  id: HistoryId;
  at: Instant;
  by: Actor;
  kind: HistoryKind;
  customer: { id: CustomerId; name: string } | null;
  job: JobId | null;
  visit: { id: VisitId; kind: VisitKind; startsAt: Instant } | null;
  /** The call the entry names, with what its line is made from. */
  call: { id: CallId; caller: string | null; summary: string | null } | null;
  /** The text that came in that the entry names, with its words. */
  textIn: { id: TextInId; words: string } | null;
  /** For an opt-out: the kind of text, or every kind. */
  textKind: OptOutKind | null;
  service: Service | null;
}

/** Who answered a firm's calls. */
export const CALL_PROVIDERS = ['vapi'] as const;
export type CallProvider = (typeof CALL_PROVIDERS)[number];

/**
 * How a call ended up, as the example's Calls & bookings screen shows it:
 * a visit booked, an urgent call, or a message taken. Worked out by code,
 * never taken from what the voice agent said.
 */
export const CALL_OUTCOMES = ['booked', 'urgent', 'message'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** What a call was about, and for whom. */
export type CallFor =
  /** A caller who is not yet a customer: the customer and their first job. */
  | {
      kind: 'new_customer';
      name: string;
      mobile: UkMobile | null;
      landline: UkLandline | null;
      noText: NoTextReason | null;
      about: string;
      place: string;
    }
  /** One of the firm's customers, with a new job. */
  | { kind: 'customer'; customer: CustomerId; about: string; place: string }
  /** Someone who is not a customer, such as a supplier. No customer and no job. */
  | { kind: 'not_customer'; caller: string }
  /** A call whose details did not come through. No customer and no job. */
  | { kind: 'details_missing' };

/**
 * The longest each piece of a call may be. Anything longer is refused by the
 * record, so what reads a provider's report treats it as missing instead.
 */
export const CALL_LIMITS = {
  providerCallId: 200,
  name: 60,
  about: 80,
  place: 120,
  caller: 60,
  summary: 200,
  urgentItem: 60,
  transcript: 100_000,
} as const;

export interface NewCall {
  provider: CallProvider;
  /** The provider's own id for the call. */
  providerCallId: string;
  startedAt: Instant;
  endedAt: Instant | null;
  /** The number the call came from, or null when it was withheld. */
  from: UkMobile | UkLandline | null;
  for: CallFor;
  /** The item on the firm's urgent list that the call matched, which makes it urgent. */
  urgentItem: string | null;
  summary: string | null;
  transcript: string | null;
}

export interface Call {
  id: CallId;
  provider: CallProvider;
  providerCallId: string;
  startedAt: Instant;
  endedAt: Instant | null;
  from: UkMobile | UkLandline | null;
  customer: { id: CustomerId; name: string } | null;
  job: JobId | null;
  /** The visit booked on the call. */
  visit: { id: VisitId; kind: VisitKind; startsAt: Instant } | null;
  outcome: CallOutcome;
  urgentItem: string | null;
  /** Who rang, for a caller who is not a customer, such as "a supplier". */
  caller: string | null;
  summary: string | null;
  createdAt: Instant;
}

/** A booked visit with the customer it is for, as a diary shows it. */
export interface DiaryVisit extends Visit {
  customer: { id: CustomerId; name: string };
}

/**
 * The kinds of text. Each says who it goes to, the service it belongs to (for
 * a text to a customer, whose service switch must be on), the history entry
 * written when it has gone, and the gaps its wording may use.
 *
 * Every kind here uses wording the firm agreed at set-up (rule 2 in
 * CLAUDE.md). Kinds that need the owner's approval of the exact version, such
 * as a quote or an invoice, come with their releases. Slice E adds the visit
 * confirmation.
 */
export const MESSAGE_KINDS = {
  /** The reminder the day before a visit. */
  visit_reminder: { to: 'customer', service: 'calls', history: 'reminder_sent', gaps: ['owner', 'weekday', 'time'] },
  /** The owner's alert about an urgent call. */
  urgent_alert: { to: 'owner', service: null, history: 'passed_to_owner', gaps: ['customer', 'place', 'summary', 'number'] },
} as const satisfies Record<
  string,
  { to: 'customer' | 'owner'; service: Service | null; history: HistoryKind; gaps: readonly string[] }
>;
export type MessageKind = keyof typeof MESSAGE_KINDS;

/** What a customer can opt out of: one kind of text to them, or every kind. */
export type OptOutKind = { [K in MessageKind]: (typeof MESSAGE_KINDS)[K]['to'] extends 'customer' ? K : never }[MessageKind] | 'every';

/**
 * Where a text is in its life: claimed and being handed over, taken by the
 * provider, delivered, failed, or not sent at all. A text only moves forward.
 */
export const MESSAGE_STATES = ['sending', 'sent', 'delivered', 'failed', 'not_sent'] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

/** Why a text was not sent, or failed. */
export const MESSAGE_REASONS = [
  // Not sent: it never reached the provider.
  'opted_out',
  'no_mobile',
  'no_number',
  'no_wording',
  'not_gsm7',
  // Failed: the provider refused it, it could not be delivered, the
  // customer had unsubscribed with the provider, or it is not clear whether
  // the provider took it. Staff check that last one: it is never sent again.
  'refused',
  'undelivered',
  'unsubscribed',
  'unclear',
] as const;
export type MessageReason = (typeof MESSAGE_REASONS)[number];

/** Who carries a firm's texts: Twilio, or the stand-in on this machine and in tests. */
export const TEXT_PROVIDERS = ['twilio', 'fake'] as const;
export type TextProvider = (typeof TEXT_PROVIDERS)[number];

/** Who a text is to. */
export type Recipient = { kind: 'customer'; customer: CustomerId } | { kind: 'owner'; owner: OwnerId };

export interface Message {
  id: MessageId;
  due: DueId;
  kind: MessageKind;
  to: Recipient;
  job: JobId | null;
  visit: VisitId | null;
  call: CallId | null;
  toNumber: UkMobile | null;
  fromNumber: UkMobile | null;
  words: string | null;
  wording: WordingId | null;
  segments: number | null;
  state: MessageState;
  reason: MessageReason | null;
  provider: TextProvider | null;
  providerId: string | null;
  errorCode: number | null;
  createdAt: Instant;
  sentAt: Instant | null;
  updatedAt: Instant;
}

/** The longest a text's words may be, and a firm's wording. */
export const TEXT_LIMITS = { words: 1_000, providerId: 100, textIn: 2_000 } as const;

/** A text that came in to the firm's number. */
export interface TextIn {
  id: TextInId;
  provider: TextProvider;
  providerId: string;
  /** The number it came from, as the provider gave it. */
  from: string | null;
  customer: { id: CustomerId; name: string } | null;
  job: JobId | null;
  words: string;
  receivedAt: Instant;
}

/** What a row in the due list does. Slice E adds the visit confirmation; slice H the deletions. */
export const DUE_ACTIONS = ['alert_owner', 'send_reminder'] as const;
export type DueAction = (typeof DUE_ACTIONS)[number];

export const DUE_STATES = ['waiting', 'claimed', 'done', 'skipped', 'cancelled'] as const;
export type DueState = (typeof DUE_STATES)[number];

/**
 * How a row ended. Done: its texts were sent, not sent, or failed (each text
 * says why), or there was nothing to do because what it was about changed.
 * Skipped: it was past its latest time.
 */
export const DUE_OUTCOMES = ['sent', 'not_sent', 'failed', 'nobody_to_tell', 'visit_changed', 'too_late', 'cancelled'] as const;
export type DueOutcome = (typeof DUE_OUTCOMES)[number];

export interface Due {
  id: DueId;
  action: DueAction;
  call: CallId | null;
  visit: VisitId | null;
  runAt: Instant;
  latestAt: Instant;
  state: DueState;
  outcome: DueOutcome | null;
  createdAt: Instant;
  finishedAt: Instant | null;
}

/** A row in the due list as a worker holds it once claimed: the claim proves it is this worker's. */
export interface ClaimedDue extends Due {
  claim: Id;
}

/**
 * What a firm's own words can be for: a kind of text, or one of the owner's
 * lines in one of its two forms (src/history-lines.ts).
 */
export type WordingKey = `text:${MessageKind}` | `line:${HistoryKind}:${'job' | 'feed'}`;

/** The gaps the owner's lines may use, as src/history-lines.ts fills them. */
export const LINE_GAPS = ['customer', 'customer’s', 'visit', 'Visit', 'short visit', 'when', 'caller', 'message', 'words'] as const;

/** The firm's words in use: for each key, the newest. */
export type FirmWording = Partial<Record<WordingKey, { id: WordingId; words: string }>>;

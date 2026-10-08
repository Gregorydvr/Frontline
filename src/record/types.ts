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

// Each kind of id is its own type, so one cannot be passed for another.
export type FirmId = Id & { readonly [firmBrand]: true };
export type OwnerId = Id & { readonly [ownerBrand]: true };
export type StaffId = Id & { readonly [staffBrand]: true };
export type CustomerId = Id & { readonly [customerBrand]: true };
export type JobId = Id & { readonly [jobBrand]: true };
export type VisitId = Id & { readonly [visitBrand]: true };
export type HistoryId = Id & { readonly [historyBrand]: true };
export type CallId = Id & { readonly [callBrand]: true };

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
 *   recordCall() also names its call.
 * - a customer: details_taken
 * - a visit: visit_booked, confirmation_sent, reminder_sent
 * - a call with no customer or job: message_taken, for a caller who is not
 *   a customer, and details_missing, for a call whose details did not come
 *   through. Written only by recordCall().
 * - the firm itself: service_on, service_off, stop_on, stop_off, number_set,
 *   urgent_list_set, written only by the functions in firms.ts
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
  service_on: 'service',
  service_off: 'service',
  stop_on: 'firm',
  stop_off: 'firm',
  number_set: 'firm',
  urgent_list_set: 'firm',
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

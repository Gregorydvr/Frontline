// The shapes the record layer takes and gives back. Lists that later slices
// will add to are here, and are checked by the record layer, not the database.

import type { Instant } from '../clock';
import type { Id } from '../ids';
import type { UkMobile } from '../phone';

declare const firmBrand: unique symbol;
declare const ownerBrand: unique symbol;
declare const staffBrand: unique symbol;
declare const customerBrand: unique symbol;
declare const jobBrand: unique symbol;
declare const visitBrand: unique symbol;
declare const historyBrand: unique symbol;

// Each kind of id is its own type, so one cannot be passed for another.
export type FirmId = Id & { readonly [firmBrand]: true };
export type OwnerId = Id & { readonly [ownerBrand]: true };
export type StaffId = Id & { readonly [staffBrand]: true };
export type CustomerId = Id & { readonly [customerBrand]: true };
export type JobId = Id & { readonly [jobBrand]: true };
export type VisitId = Id & { readonly [visitBrand]: true };
export type HistoryId = Id & { readonly [historyBrand]: true };

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
  createdAt: Instant;
}

export interface Owner {
  id: OwnerId;
  name: string;
  createdAt: Instant;
}

export interface Customer {
  id: CustomerId;
  /** The name as given, such as "Mrs Green". */
  name: string;
  mobile: UkMobile | null;
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
 * - a job: call_answered, passed_to_owner
 * - a customer: details_taken
 * - a visit: visit_booked, confirmation_sent, reminder_sent
 * - the firm itself: service_on, service_off, stop_on, stop_off, written only
 *   by setService() and setStopButton()
 * Later slices add their own.
 */
export const HISTORY_KINDS = {
  call_answered: 'job',
  passed_to_owner: 'job',
  details_taken: 'customer',
  visit_booked: 'visit',
  confirmation_sent: 'visit',
  reminder_sent: 'visit',
  service_on: 'service',
  service_off: 'service',
  stop_on: 'firm',
  stop_off: 'firm',
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
  service: Service | null;
}

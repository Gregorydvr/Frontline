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
declare const holdBrand: unique symbol;
declare const linkBrand: unique symbol;
declare const loginBrand: unique symbol;
declare const ownerMessageBrand: unique symbol;
declare const staffLogBrand: unique symbol;
declare const firmExportBrand: unique symbol;
declare const agentPushBrand: unique symbol;

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
export type AgentPushId = Id & { readonly [agentPushBrand]: true };
export type HoldId = Id & { readonly [holdBrand]: true };
/** The token in a link a customer opens. It cannot be guessed (rule 13). */
export type LinkToken = Id & { readonly [linkBrand]: true };
/** The token in a link that logs an owner in. It cannot be guessed, and works once. */
export type LoginToken = Id & { readonly [loginBrand]: true };
/** What an owner wrote in Message us. */
export type OwnerMessageId = Id & { readonly [ownerMessageBrand]: true };
/** A row in the staff log: one view or action in the control room. */
export type StaffLogId = Id & { readonly [staffLogBrand]: true };
/** A file of one firm's records, made for handing over. */
export type FirmExportId = Id & { readonly [firmExportBrand]: true };

/** The five services, by the example app's names for them. */
export const SERVICES = ['calls', 'quotes', 'followups', 'paperwork', 'invoices'] as const;
export type Service = (typeof SERVICES)[number];

/** What staff can ask a provider to make for a firm at set-up: its number in Twilio, its voice agent in Vapi. */
export const PROVISIONS = ['number', 'agent'] as const;
export type Provision = (typeof PROVISIONS)[number];

/** Where a request to a provider stands. Unclear: the provider's answer did not say whether it was made. */
export type ProvisionState = 'asked' | 'done' | 'failed' | 'unclear';

export type ProvisioningId = Id & { readonly __provisioning: true };

/** One request to a provider to make something for the firm. */
export interface Provisioning {
  id: ProvisioningId;
  what: Provision;
  state: ProvisionState;
  askedAt: Instant;
  finishedAt: Instant | null;
  /** The number bought, or Vapi's id for the agent. */
  made: string | null;
}

/**
 * The trades a firm can choose at set-up, each with a starter pack in
 * src/trade-packs.ts.
 */
export const TRADES = ['plumbing_heating', 'drainage', 'electrical'] as const;
export type Trade = (typeof TRADES)[number];

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
  /** When visits can be booked, and how long each kind takes. Null: no times are offered. */
  diaryRules: DiaryRules | null;
  /** The trade chosen at set-up, whose starter pack its set-up started from. Null: none chosen. */
  trade: Trade | null;
  /** The services the firm chose at set-up. Choosing switches nothing on. */
  servicesChosen: readonly Service[];
  /**
   * How far ahead of the real time the firm's clock runs, in milliseconds:
   * 0 for every real firm. Only an example firm's clock is ever moved.
   */
  clockAhead: number;
  /** When staff said the firm is leaving, and who: its records are handed over and deleted within 30 days. */
  leaving: { at: Instant; by: StaffId } | null;
  createdAt: Instant;
}

/**
 * When a firm's visits can be booked, set at set-up. Times are UK time, in
 * minutes after midnight. Visits start every `every` minutes from `opens`,
 * and end by `closes`. Nothing is offered on the day itself; times are
 * offered from the next day the firm books, up to `daysAhead` days ahead.
 * A kind of visit with no length is not booked by the diary.
 */
export interface DiaryRules {
  /** The days visits can be booked, 0 for Sunday to 6 for Saturday. */
  days: readonly number[];
  /** The first start, such as 480 for 8am. */
  opens: number;
  /** When the last visit must have ended, such as 960 for 4pm. */
  closes: number;
  /** Minutes between one start and the next, such as 60 for on the hour. */
  every: number;
  /** How long each kind of visit takes, in minutes. */
  lengths: Readonly<Partial<Record<VisitKind, number>>>;
  /** How many days ahead times are offered. */
  daysAhead: number;
  /**
   * The notice a booking needs: on the next day the firm works, the first
   * start offered, such as 720 for noon. Missing means noon
   * (DEFAULT_NEXT_DAY_FROM in src/diary/times.ts). Nothing is offered on
   * the day itself.
   */
  nextDayFrom?: number;
}

export interface Owner {
  id: OwnerId;
  name: string;
  /** For alerts and the login link. */
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
  /** The address taken on the call, or as they corrected it. */
  address: string | null;
  /** An email they added from their link. */
  email: string | null;
  /** When they last confirmed their details from their link. */
  detailsConfirmedAt: Instant | null;
  createdAt: Instant;
}

/** The longest each of a customer's own details may be. */
export const CUSTOMER_LIMITS = { name: 60, address: 120, email: 254 } as const;

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
  /** When it ends. Visits from before slice E have none. */
  endsAt: Instant | null;
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
 * - a visit: visit_booked, confirmation_sent, reminder_sent, visit_moved,
 *   visit_cancelled, and, for the texts of task 5 when they go,
 *   moved_notice_sent, cancelled_notice_sent and followup_sent
 * - a job, done by the customer from the link about it: details_confirmed,
 *   when nothing changed, and details_corrected. The old details are not kept.
 * - a call with no customer or job: message_taken, for a caller who is not
 *   a customer, and details_missing, for a call whose details did not come
 *   through. Written only by recordCall().
 * - a text that came in: text_received, written only by recordTextIn(), on
 *   the customer's job when it has one
 * - the firm itself: service_on, service_off, stop_on, stop_off, number_set,
 *   urgent_list_set, owner_mobile_set, diary_rules_set, and, from slice H2,
 *   firm_added, owner_added and wording_agreed, and trade_set, written only by the
 *   functions in firms.ts, owners.ts and wording.ts. The owner is not shown
 *   them.
 * - an owner using the app: logged_in and logged_out, written only by
 *   logins.ts, and owner_message_sent, for Message us, written only by
 *   owner-messages.ts. Each names the owner who did it.
 * - a call's recording: recording_deleted, when the clock deletes it at the
 *   end of its period and the call stays. It names the call, and the
 *   customer and job the call is about. Written only by keeping.ts. The
 *   owner is not shown it.
 * Later slices add their own.
 */
export const HISTORY_KINDS = {
  call_answered: 'job',
  passed_to_owner: 'job',
  details_taken: 'customer',
  visit_booked: 'visit',
  confirmation_sent: 'visit',
  reminder_sent: 'visit',
  visit_moved: 'visit',
  visit_cancelled: 'visit',
  moved_notice_sent: 'visit',
  cancelled_notice_sent: 'visit',
  followup_sent: 'visit',
  details_confirmed: 'job',
  details_corrected: 'job',
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
  diary_rules_set: 'firm',
  trade_set: 'firm',
  services_chosen: 'firm',
  firm_added: 'firm',
  owner_added: 'firm',
  wording_agreed: 'firm',
  logged_in: 'firm',
  logged_out: 'firm',
  owner_message_sent: 'firm',
  recording_deleted: 'recording',
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
  call: { id: CallId; caller: string | null; summary: string | null; from: UkMobile | UkLandline | null } | null;
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
  /** The first line of the address, short enough that ", " and a postcode still fit in the place. */
  firstLine: 110,
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
  /** The voice agent said it was urgent, for something not on the firm's list, so it is not. Shown to staff. */
  urgentNotOnList?: boolean;
  summary: string | null;
  transcript: string | null;
  /**
   * The time held in the diary during the call, to file as a visit on the
   * call's job, with the rows in the due list that come with it: the
   * confirmation and the reminder. Only a customer's call that is not urgent
   * can be booked.
   */
  booking?: NewBooking | null;
  /**
   * The call's recording, from slice H: waiting in the inbox under this
   * firm's path, to be moved into the kept store and deleted at the end of
   * its period; or not kept, when the report named somewhere else. None
   * when left out.
   */
  recording?: { kind: 'waiting'; from: string } | { kind: 'not_kept' } | null;
}

/** A hold to file as a visit, as recordCall() takes it. */
export interface NewBooking {
  hold: HoldId;
  kind: VisitKind;
  startsAt: Instant;
  endsAt: Instant;
  /** The rows in the due list for the visit, worked out from its time (src/booking.ts). */
  dues: readonly { action: 'send_confirmation' | 'send_reminder' | 'tell_owner_booked' | 'send_visit_followup'; runAt: Instant; latestAt: Instant }[];
}

export const HOLD_STATES = ['held', 'filed', 'released'] as const;
export type HoldState = (typeof HOLD_STATES)[number];

/** A time held in the diary during a call, under the provider's id for the call. */
export interface Hold {
  id: HoldId;
  provider: CallProvider;
  providerCallId: string;
  kind: VisitKind;
  startsAt: Instant;
  endsAt: Instant;
  state: HoldState;
  visit: VisitId | null;
  createdAt: Instant;
  updatedAt: Instant;
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
 * written when it has gone, if any, the gaps its wording may use, whether it
 * must carry its link (a text that must, when no link could be made because
 * this copy has no address for it yet, is not sent), and whether quiet hours
 * hold it until 8am.
 *
 * Every kind here uses wording the firm agreed at set-up (rule 2 in
 * CLAUDE.md). Kinds that need the owner's approval of the exact version, such
 * as a quote or an invoice, come with their releases.
 */
export const MESSAGE_KINDS = {
  /** The confirmation when a visit is booked. */
  visit_confirmation: {
    to: 'customer',
    service: 'calls',
    history: 'confirmation_sent',
    gaps: ['customer', 'firm', 'owner', 'day', 'time', 'purpose'],
    linkRequired: false,
    quietHours: true,
    switchable: false,
  },
  /**
   * The confirmation as the first text the firm sends a customer: the same,
   * with a link to confirm their details and a line on opting out.
   */
  visit_confirmation_first: {
    to: 'customer',
    service: 'calls',
    history: 'confirmation_sent',
    gaps: ['customer', 'firm', 'owner', 'day', 'time', 'purpose', 'link'],
    linkRequired: true,
    quietHours: true,
    switchable: false,
  },
  /** The reminder the day before a visit. */
  visit_reminder: { to: 'customer', service: 'calls', history: 'reminder_sent', gaps: ['owner', 'weekday', 'time'], linkRequired: false, quietHours: true, switchable: false },
  /**
   * The owner's alert about an urgent call, with a link to the job once this
   * copy has an address for the app. It goes without the link otherwise: an
   * urgent call is never held up for want of one.
   */
  urgent_alert: {
    to: 'owner',
    service: null,
    history: 'passed_to_owner',
    gaps: ['customer', 'place', 'summary', 'number', 'link'],
    linkRequired: false,
    quietHours: false,
    switchable: false,
  },
  /**
   * The owner's alert about an urgent call whose caller's name, job or
   * address did not come through, so there is no customer or job to name.
   */
  urgent_alert_details_missing: {
    to: 'owner',
    service: null,
    history: 'passed_to_owner',
    gaps: ['summary', 'number'],
    linkRequired: false,
    quietHours: false,
    switchable: false,
  },
  /**
   * The owner's text when the voice agent books a visit on a call, with a
   * link to the job once this copy has an address for the app. Every owner
   * gets it. Quiet hours hold it until 8am, unlike an urgent alert (Greg,
   * 14 Oct 2026).
   */
  visit_booked: {
    to: 'owner',
    service: null,
    history: null,
    gaps: ['customer', 'day', 'time', 'place', 'link'],
    linkRequired: false,
    quietHours: true,
    switchable: false,
  },
  /**
   * The link that logs the owner in, sent to the owner's own mobile when they
   * ask for it. The login is recorded when the link is used, so no history
   * entry is written when the text goes; the text itself is kept.
   */
  login_link: { to: 'owner', service: null, history: null, gaps: ['link'], linkRequired: true, quietHours: false, switchable: false },
  /**
   * Task 5 of docs/autopilot.md: three texts to customers, built and
   * switched off. Each goes only on a copy whose TEXTS_ON setting names it,
   * which no copy does, and only in wording the owner agreed, as every text.
   * Their draft wording is to agree (docs/texts-to-agree.md).
   *
   * The visit moved: its new day and time. Only to a customer whose
   * confirmation went, since one still waiting gives the new time itself.
   */
  visit_moved_notice: {
    to: 'customer',
    service: 'calls',
    history: 'moved_notice_sent',
    gaps: ['customer', 'firm', 'owner', 'day', 'time'],
    linkRequired: false,
    quietHours: true,
    switchable: true,
  },
  /** The visit cancelled. Only to a customer whose confirmation went. */
  visit_cancelled_notice: {
    to: 'customer',
    service: 'calls',
    history: 'cancelled_notice_sent',
    gaps: ['customer', 'firm', 'day', 'time'],
    linkRequired: false,
    quietHours: true,
    switchable: true,
  },
  /** The morning after a quote visit: thanks, and that the firm will be in touch with the price. */
  visit_followup: {
    to: 'customer',
    service: 'calls',
    history: 'followup_sent',
    gaps: ['customer', 'firm', 'owner'],
    linkRequired: false,
    quietHours: true,
    switchable: true,
  },
} as const satisfies Record<
  string,
  {
    to: 'customer' | 'owner';
    service: Service | null;
    history: HistoryKind | null;
    gaps: readonly string[];
    linkRequired: boolean;
    quietHours: boolean;
    /** Whether it goes only on a copy whose TEXTS_ON setting names it. False for every text of Release 1. */
    switchable: boolean;
  }
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
  // A text that carries a link, when this copy has no address for links yet.
  'no_link_address',
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

/**
 * What a row in the due list does: send a text, or, from slice H, keep and
 * delete what is held:
 * - move_recording: move a call's recording from the inbox into the file
 *   store that keeps it
 * - delete_recording: delete a call's recording at the end of its period,
 *   keeping the call
 * - sweep: the firm's daily run that deletes whatever else has run past its
 *   period (src/record/keeping.ts)
 * - make_firm_export: build the file of a firm's records that staff asked for
 * - delete_firm: delete a leaving firm at the end of its 30 days
 */
export const DUE_ACTIONS = [
  'alert_owner',
  'tell_owner_booked',
  'send_reminder',
  'send_confirmation',
  'send_login_link',
  'move_recording',
  'delete_recording',
  'sweep',
  'make_firm_export',
  'delete_firm',
  // The firm's voice agent in Vapi: put the record's settings on it after a
  // change was saved (src/agent-push.ts).
  'push_agent',
  // Task 5's texts to customers, written only while the copy switches them on.
  'send_visit_moved',
  'send_visit_cancelled',
  'send_visit_followup',
] as const;
export type DueAction = (typeof DUE_ACTIONS)[number];

export const DUE_STATES = ['waiting', 'claimed', 'done', 'skipped', 'cancelled'] as const;
export type DueState = (typeof DUE_STATES)[number];

/**
 * How a row ended. Done: its texts were sent, not sent, or failed (each text
 * says why), or there was nothing to do because what it was about changed.
 * Skipped: it was past its latest time.
 */
export const DUE_OUTCOMES = [
  'sent',
  'not_sent',
  'failed',
  'nobody_to_tell',
  'visit_changed',
  'too_late',
  'cancelled',
  // Keeping and deleting (slice H): a recording kept or deleted, a sweep
  // run, an export made, a firm deleted, or nothing left to do.
  'kept',
  'deleted',
  'swept',
  'made',
  'nothing_to_do',
  // The firm's agent: in step with the record after the row, or not, for
  // the reason its push says (agent_pushes).
  'pushed',
  'not_pushed',
  // A text of task 5 whose row ran after the copy switched it off.
  'switched_off',
] as const;
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
export const LINE_GAPS = ['customer', 'customer’s', 'visit', 'Visit', 'short visit', 'when', 'caller', 'message', 'words', 'number'] as const;

/** The firm's words in use: for each key, the newest. */
export type FirmWording = Partial<Record<WordingKey, { id: WordingId; words: string }>>;

/**
 * How an owner agreed the wording for a text (rule 2 in CLAUDE.md): they
 * said yes to a member of staff on the phone or in person, or in writing.
 * The build's reading of question 1 of the slice H2 plan, waiting for Greg.
 */
export const AGREED_HOW = ['phone', 'in_person', 'in_writing'] as const;
export type AgreedHow = (typeof AGREED_HOW)[number];

/** Who agreed a version of the words for a text, and how. When is the moment it is recorded. */
export interface Agreement {
  owner: OwnerId;
  how: AgreedHow;
}

/** One version of the firm's words for a key, as kept: never edited. */
export interface WordingVersion {
  id: WordingId;
  words: string;
  at: Instant;
  /** Who recorded it: a member of staff, Front-line (the demo firm), or the owner. */
  by: Actor;
  /** For a member of staff: the email Access vouched for, to show to staff. */
  staffEmail: string | null;
  /** For a text: the owner who agreed these exact words, how, and when. */
  agreed: { owner: { id: OwnerId; name: string }; how: AgreedHow; at: Instant } | null;
}

/**
 * Where a call's recording is: none (a call from before slice H, or one Vapi
 * gave no recording for), waiting in the inbox to be moved, kept, not kept
 * (it never reached the inbox, or could not be moved in time: staff are
 * shown it), or deleted at the end of its period.
 */
export const RECORDING_STATES = ['none', 'waiting', 'kept', 'not_kept', 'deleted'] as const;
export type RecordingState = (typeof RECORDING_STATES)[number];

/** A call's recording, as the record holds it. */
export interface CallRecording {
  state: RecordingState;
  /** The inbox's name for it, while it is on its way. */
  from: string | null;
  /** The kept file's name, while it is kept. */
  key: string | null;
  /** When it is due to be deleted. */
  until: Instant | null;
  /** When it was deleted. */
  goneAt: Instant | null;
}

/** A member of Front-line's own staff. Not part of any firm. */
export interface Staff {
  id: StaffId;
  /** The email Cloudflare Access vouched for. Never logged (rule 11). */
  email: string;
  createdAt: Instant;
}

/**
 * What a member of staff viewed or did in the control room, as the staff log
 * keeps it (rule 15). Each names the firm, apart from viewing the list of
 * firms, and some the customer.
 */
export const STAFF_ACTIONS = [
  // Views.
  'viewed_firms',
  'viewed_firm',
  'searched_customers',
  'viewed_customer',
  'viewed_delete',
  // A call's report, for staff checking what happened on it (scripts/last-call.js).
  'viewed_call_report',
  // Actions on a firm.
  'service_on',
  'service_off',
  'stop_on',
  'stop_off',
  // Actions on a customer.
  'exported_customer',
  'deleted_customer',
  // Keeping and deleting (slice H): exporting a firm, a firm leaving and
  // being deleted, and putting deletions right after a restore.
  'asked_firm_export',
  'downloaded_firm_export',
  'viewed_leaving',
  'marked_leaving',
  'cancelled_leaving',
  'viewed_firm_delete',
  'deleted_firm',
  'viewed_after_restore',
  'replayed_deletions',
  // Setting up a firm (slice H2): the views, then the changes. Each change
  // is written in the same step as the change itself.
  'viewed_add_firm',
  'viewed_set_up_owner',
  'viewed_set_up_number',
  'viewed_set_up_urgent',
  'viewed_set_up_diary',
  'viewed_set_up_trade',
  'viewed_set_up_services',
  'viewed_onboarding',
  'viewed_wording',
  'checked_wording',
  'added_firm',
  'added_owner',
  'changed_owner_mobile',
  'set_number',
  'set_urgent_list',
  'set_diary_rules',
  'set_trade',
  'chose_services',
  // Asking a provider to make something for the firm (task 3 of queue 2):
  // its number bought in Twilio, its voice agent made in Vapi.
  'asked_for_number',
  'asked_for_agent',
  'agreed_wording',
  // The firm's voice agent in Vapi (task 3 of docs/autopilot.md).
  'viewed_set_up_agent',
  'set_agent',
  'checked_agent',
  'overwrote_agent',
  // Practice and this machine only: the demo firm.
  'loaded_example',
  'moved_clock',
  'reset_example',
] as const;
export type StaffAction = (typeof STAFF_ACTIONS)[number];

/** A row of the staff log, as read back. */
export interface StaffLogEntry {
  id: StaffLogId;
  firm: FirmId | null;
  staff: StaffId;
  at: Instant;
  what: StaffAction;
  customer: CustomerId | null;
  service: Service | null;
  /** The owner a change was about, such as their mobile (slice H2). */
  owner: OwnerId | null;
  /** The kind of text whose wording was viewed or agreed (slice H2). */
  messageKind: MessageKind | null;
}

/**
 * Where a firm's voice agent in Vapi stands against the record:
 * - unchecked: set, and not yet read from Vapi
 * - in_step: the last read-back matched the record
 * - behind: a change waits to go, or Vapi could not be reached
 * - differs: Vapi holds something other than what Front-line last confirmed,
 *   such as a change made in Vapi's dashboard, or the first check found it
 *   different; staff choose whether to put the record's settings on it
 * - stuck: it cannot be pushed as things are: no Vapi key for this copy, the
 *   firm not ready, the agent not found, refused, or not this firm's own
 */
export const AGENT_STATES = ['unchecked', 'in_step', 'behind', 'differs', 'stuck'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/**
 * What one push or check came to:
 * - in_step: nothing needed sending
 * - changed: the settings that differed were sent, and the read-back matched
 * - differs: not sent, because Vapi was changed since Front-line last
 *   confirmed it, or the read-back did not match
 * - unreachable: Vapi could not be reached; the row tries again
 * - not_connected: this copy has no Vapi key
 * - not_ready: the firm has no urgent list, or the copy no address or
 *   credential for the agent
 * - not_found: Vapi has no agent with that id
 * - refused: Vapi refused the settings
 * - not_this_firms: the agent's recording path is not this firm's own, so
 *   nothing is changed on it
 */
export const AGENT_OUTCOMES = ['in_step', 'changed', 'differs', 'unreachable', 'not_connected', 'not_ready', 'not_found', 'refused', 'not_this_firms'] as const;
export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

/** A firm's voice agent in Vapi, as the record holds it. */
export interface Agent {
  assistantId: string;
  state: AgentState;
  /** A fingerprint of the settings last confirmed on Vapi, or null if none yet. */
  confirmed: string | null;
  checkedAt: Instant | null;
  /** The settings that differ, by name, when it is not in step. */
  differing: string[];
  setAt: Instant;
}

/** One push or check of a firm's agent, as the log of them holds it. Never edited. */
export interface AgentPush {
  id: AgentPushId;
  assistantId: string;
  at: Instant;
  by: { kind: 'frontline' } | { kind: 'staff'; staff: StaffId };
  due: DueId | null;
  outcome: AgentOutcome;
  settings: string[];
}

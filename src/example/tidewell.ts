// The demo firm: Tidewell Heating, owner Tom, and the sixteen customers and
// jobs in seed() in reference/example-app/src.html. Stored as records and
// history, never as sentences.
//
// Only what Release 1 can produce goes in: the customers, the jobs, their
// visits, the calls, and history of the kinds Release 1 writes (a call
// answered, the details taken, a message taken, a visit booked, a
// confirmation, a reminder, an urgent call passed on). Quotes, invoices,
// nudges, reviews, voice notes, photos, paperwork, website enquiries and
// running late wait for their releases.
// Where one of the example's lines mixes the two, only the Release 1 part is
// here. Jobs whose state in the example comes from a quote or an invoice get
// that state back when their release adds quotes and invoices to the demo.
//
// The people are invented. Their mobiles, and the firm's number, are from the
// range Ofcom keeps for drama, which never reaches a real phone.
//
// Every time is UK time with its offset. +01:00 is summer time, which runs to
// Sunday 25 October 2026.

import type { DiaryRules, VisitKind } from '../record/types';

export const EXAMPLE_FIRM = 'Tidewell Heating';
export const EXAMPLE_OWNER = 'Tom';
/** Tom's mobile, for his alerts. */
export const EXAMPLE_OWNER_MOBILE = '07700 900101';
/** The number Tidewell Heating's customers ring and text. */
export const EXAMPLE_NUMBER = '07700 900100';
/** What counts as urgent: "Anything urgent, like a leak, comes straight to you." */
export const EXAMPLE_URGENT_LIST = ['a leak'];

/**
 * When quote visits can be booked: "Quote visits go in Monday to Friday, 8am
 * to 4pm", from the example's rules, read as the first starting at 8am and
 * the last ending by 4pm. An hour each, on the hour, up to two weeks ahead:
 * the slice E build's answer to open question 4, at Greg's request.
 */
export const EXAMPLE_DIARY_RULES: DiaryRules = {
  days: [1, 2, 3, 4, 5],
  opens: 8 * 60,
  closes: 16 * 60,
  every: 60,
  lengths: { quote_visit: 60 },
  daysAhead: 14,
};

/** When the firm was set up, before anything in the example happened. */
export const EXAMPLE_SET_UP = '2026-09-01T09:00:00+01:00';

/** The example's "today": Thursday 15 October 2026, after the last thing that happened. */
export const EXAMPLE_NOW = '2026-10-15T16:00:00+01:00';

interface ExampleCustomer {
  name: string;
  mobile: string;
  /** What the job is about. */
  about: string;
  /** Where. */
  place: string;
}

/** The customers, each with one job, in the example's order. */
export const CUSTOMERS = {
  patel: { name: 'Mrs Patel', mobile: '07700 900001', about: 'New boiler', place: '14 Mill Lane' },
  hughes: { name: 'Mr Hughes', mobile: '07700 900002', about: 'Radiator swap', place: '3 Orchard Close' },
  ahmed: { name: 'Mrs Ahmed', mobile: '07700 900003', about: 'Boiler replacement', place: '27 Station Road' },
  evans: { name: 'Mr Evans', mobile: '07700 900004', about: 'New boiler and two radiators', place: '8 Church Street' },
  clarke: { name: 'Mr Clarke', mobile: '07700 900005', about: 'Bathroom radiator', place: '41 Park Road' },
  davies: { name: 'Mr Davies', mobile: '07700 900006', about: 'Boiler service', place: '19 Elm Grove' },
  wood: { name: 'Mr Wood', mobile: '07700 900007', about: 'Cylinder replacement', place: '5 High Street' },
  lewis: { name: 'Mrs Lewis', mobile: '07700 900008', about: 'Boiler replacement', place: '62 Queens Road' },
  kaur: { name: 'Mrs Kaur', mobile: '07700 900009', about: 'Boiler replacement', place: '11 Victoria Road' },
  turner: { name: 'Mr Turner', mobile: '07700 900010', about: 'Unvented cylinder', place: '2 Manor Way' },
  bell: { name: 'Ms Bell', mobile: '07700 900011', about: 'Boiler replacement', place: '30 Green Lane' },
  shah: { name: 'Mr Shah', mobile: '07700 900012', about: 'Three radiators', place: '77 London Road' },
  khan: { name: 'Mr Khan', mobile: '07700 900013', about: 'New boiler', place: '9 Mill Road' },
  reid: { name: 'Mrs Reid', mobile: '07700 900014', about: 'Boiler service, a year on', place: '16 West Street' },
  green: { name: 'Mrs Green', mobile: '07700 900015', about: 'No hot water', place: '24 Beech Avenue' },
  price: { name: 'Mr Price', mobile: '07700 900016', about: 'Leak under the sink', place: '6 Bridge Street' },
} as const satisfies Record<string, ExampleCustomer>;

export type CustomerKey = keyof typeof CUSTOMERS;

interface ExampleVisit {
  customer: CustomerKey;
  kind: VisitKind;
  startsAt: string;
}

/**
 * Every visit the example mentions. Six of the times are not in the example
 * and were filled in: Mr Hughes's, Mr Evans's and Mr Khan's quote visits, Mr
 * Khan's and Mrs Ahmed's installs, and Mr Davies's service.
 */
export const VISITS = {
  'khan-quote': { customer: 'khan', kind: 'quote_visit', startsAt: '2026-09-17T14:00:00+01:00' },
  'khan-install': { customer: 'khan', kind: 'install', startsAt: '2026-09-30T08:30:00+01:00' },
  'ahmed-quote': { customer: 'ahmed', kind: 'quote_visit', startsAt: '2026-10-01T15:00:00+01:00' },
  'reid-service': { customer: 'reid', kind: 'service', startsAt: '2026-10-21T14:00:00+01:00' },
  'ahmed-install': { customer: 'ahmed', kind: 'install', startsAt: '2026-10-15T08:30:00+01:00' },
  'hughes-quote': { customer: 'hughes', kind: 'quote_visit', startsAt: '2026-10-07T10:00:00+01:00' },
  'evans-quote': { customer: 'evans', kind: 'quote_visit', startsAt: '2026-10-12T14:00:00+01:00' },
  'patel-quote': { customer: 'patel', kind: 'quote_visit', startsAt: '2026-10-15T13:00:00+01:00' },
  'davies-service': { customer: 'davies', kind: 'service', startsAt: '2026-10-15T10:30:00+01:00' },
  'green-quote': { customer: 'green', kind: 'quote_visit', startsAt: '2026-10-19T09:00:00+01:00' },
  'clarke-quote': { customer: 'clarke', kind: 'quote_visit', startsAt: '2026-10-16T10:00:00+01:00' },
  'evans-install': { customer: 'evans', kind: 'install', startsAt: '2026-10-20T08:30:00+01:00' },
} as const satisfies Record<string, ExampleVisit>;

export type VisitKey = keyof typeof VISITS;

/** One thing that happened, in the order it happened. */
export type Step =
  | { at: string; add: 'customer'; customer: CustomerKey }
  /**
   * A new customer rings: the call, their customer and job, the call
   * answered and their details taken. `urgent` is the item on the urgent
   * list it matched.
   */
  | { at: string; add: 'call'; customer: CustomerKey; summary: string | null; urgent: string | null }
  /** Someone who is not a customer rings, and a message is taken. */
  | { at: string; add: 'message'; caller: string; mobile: string; summary: string }
  | { at: string; add: 'visit'; visit: VisitKey }
  /** The customer's call is marked as the one the visit was booked on. */
  | { at: string; add: 'call_booked'; visit: VisitKey }
  | { at: string; add: 'passed_to_owner'; job: CustomerKey }
  | { at: string; add: 'visit_booked' | 'confirmation_sent' | 'reminder_sent'; visit: VisitKey };

/** A new customer rings, with the example's line about their call when it has one. */
function call(at: string, customer: CustomerKey, summary: string | null = null): Step {
  return { at, add: 'call', customer, summary, urgent: null };
}

/** A visit put in the diary, and the history that says so. */
function booked(at: string, visit: VisitKey): Step[] {
  return [
    { at, add: 'visit', visit },
    { at, add: 'visit_booked', visit },
  ];
}

/** A visit booked on the customer's call. */
function bookedOnCall(at: string, visit: VisitKey): Step[] {
  return [...booked(at, visit), { at, add: 'call_booked', visit }];
}

/** A customer and their job, for those the example shows nothing of from Release 1. */
function customer(at: string, key: CustomerKey): Step {
  return { at, add: 'customer', customer: key };
}

export const TIMELINE: readonly Step[] = [
  // Mr Khan: "Answered his call. Quote visit booked for Thursday."
  call('2026-09-14T08:50:00+01:00', 'khan'),
  ...bookedOnCall('2026-09-14T08:50:00+01:00', 'khan-quote'),
  // His install went in when he accepted the quote, which is Release 3.
  { at: '2026-09-20T19:12:00+01:00', add: 'visit', visit: 'khan-install' },
  customer('2026-09-24T12:10:00+01:00', 'wood'),
  // Mrs Ahmed, step 1 of the acceptance story: "Answered her call. The
  // boiler keeps cutting out. Quote visit booked for Thursday, 3pm."
  call('2026-09-28T11:15:00+01:00', 'ahmed', 'The boiler keeps cutting out.'),
  ...bookedOnCall('2026-09-28T11:15:00+01:00', 'ahmed-quote'),
  { at: '2026-09-28T11:16:00+01:00', add: 'confirmation_sent', visit: 'ahmed-quote' },
  { at: '2026-09-29T13:00:00+01:00', add: 'reminder_sent', visit: 'khan-install' },
  { at: '2026-09-30T13:00:00+01:00', add: 'reminder_sent', visit: 'ahmed-quote' },
  // Mrs Reid: "Booked the service for Wednesday 21 October, 2pm."
  customer('2026-10-01T09:00:00+01:00', 'reid'),
  ...booked('2026-10-01T12:50:00+01:00', 'reid-service'),
  // Mrs Ahmed: "Stopped chasing. Install booked for 15 October."
  ...booked('2026-10-04T18:42:00+01:00', 'ahmed-install'),
  call('2026-10-06T10:40:00+01:00', 'hughes'),
  ...bookedOnCall('2026-10-06T10:40:00+01:00', 'hughes-quote'),
  call('2026-10-09T09:30:00+01:00', 'evans'),
  ...bookedOnCall('2026-10-09T09:30:00+01:00', 'evans-quote'),
  customer('2026-10-09T15:10:00+01:00', 'bell'),
  customer('2026-10-10T10:20:00+01:00', 'lewis'),
  customer('2026-10-10T11:30:00+01:00', 'shah'),
  // "Answered her call. The old boiler is leaking. Quote visit booked for Thursday, 1pm."
  call('2026-10-12T09:12:00+01:00', 'patel', 'The old boiler is leaking.'),
  ...bookedOnCall('2026-10-12T09:12:00+01:00', 'patel-quote'),
  { at: '2026-10-12T09:13:00+01:00', add: 'confirmation_sent', visit: 'patel-quote' },
  customer('2026-10-13T17:05:00+01:00', 'kaur'),
  // Yesterday at 13:00: "Reminded Mrs Patel, Mrs Ahmed and Mr Davies about today's visits."
  customer('2026-10-14T13:00:00+01:00', 'davies'),
  { at: '2026-10-14T13:00:00+01:00', add: 'visit', visit: 'davies-service' },
  { at: '2026-10-14T13:00:00+01:00', add: 'reminder_sent', visit: 'patel-quote' },
  { at: '2026-10-14T13:00:00+01:00', add: 'reminder_sent', visit: 'ahmed-install' },
  { at: '2026-10-14T13:00:00+01:00', add: 'reminder_sent', visit: 'davies-service' },
  customer('2026-10-14T16:20:00+01:00', 'turner'),
  // Today. Mrs Green, step 4 of the acceptance story, as Calls & bookings
  // shows her: "No hot water. Quote visit booked for Monday, 9am."
  call('2026-10-15T08:10:00+01:00', 'green', 'No hot water.'),
  ...bookedOnCall('2026-10-15T08:10:00+01:00', 'green-quote'),
  { at: '2026-10-15T08:11:00+01:00', add: 'confirmation_sent', visit: 'green-quote' },
  // A supplier, step 5: "Your order is ready to collect. Message taken."
  {
    at: '2026-10-15T08:26:00+01:00',
    add: 'message',
    caller: 'a supplier',
    mobile: '07700 900300',
    summary: 'Your order is ready to collect.',
  },
  // Mr Clarke came through the website, which is not Release 1. His visit is.
  customer('2026-10-15T08:33:00+01:00', 'clarke'),
  ...booked('2026-10-15T08:34:00+01:00', 'clarke-quote'),
  // Mr Price, step 6: "A leak under the kitchen sink. Passed straight to
  // you." Leaks are on the urgent list.
  {
    at: '2026-10-15T11:02:00+01:00',
    add: 'call',
    customer: 'price',
    summary: 'A leak under the kitchen sink.',
    urgent: 'a leak',
  },
  { at: '2026-10-15T11:02:00+01:00', add: 'passed_to_owner', job: 'price' },
  // Mr Evans: "Stopped chasing. Install booked for Tuesday 20 October."
  ...booked('2026-10-15T15:31:00+01:00', 'evans-install'),
];

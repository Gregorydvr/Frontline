// Labels the owner reads, taken from the example app (SVC, ST and WHO in
// reference/example-app/src.html). Kept as data, like the history lines.

import type { JobState } from './job-state';
import type { Actor, CallOutcome, Service, VisitKind } from './record/types';

export const SERVICE_WORDS: Readonly<Record<Service, string>> = {
  calls: 'Calls & bookings',
  quotes: 'Quotes',
  followups: 'Follow-ups',
  paperwork: 'Job paperwork',
  invoices: 'Invoices & reminders',
};

export const JOB_STATE_WORDS: Readonly<Record<JobState, string>> = {
  urgent: 'Passed to you',
  today: 'On today',
  booked: 'Booked',
};

/** Who did it, as a job page shows it. Staff act as Front-line. */
export const ACTOR_WORDS: Readonly<Record<Actor['kind'], string>> = {
  frontline: 'Front-line',
  staff: 'Front-line',
  owner: 'You',
  customer: 'Customer',
};

/**
 * The words on Calls & bookings, from the example's screen (sectionScreen in
 * reference/example-app/src.html). Four are new, listed in the pull request
 * for slice C: the count for one call, the words for a day with no calls, and
 * "Number withheld" and "Details missing." for a call whose details did not
 * come through. The example also says "None missed.", which waits until the
 * record can tell a missed call.
 */
export const CALLS_WORDS = {
  answeredOne: '1 call answered today.',
  answeredMany: '{count} calls answered today.',
  noneYet: 'No calls yet today.',
  todaysCalls: 'Today’s calls',
  comingUp: 'Coming up',
  withheld: 'Number withheld',
} as const;

/**
 * What came of a call, as the second line of its row says it, after the
 * line about the call. {Visit} and {when} are as in the history lines.
 */
export const CALL_OUTCOME_WORDS: Readonly<Record<CallOutcome | 'details_missing', string>> = {
  booked: '{Visit} booked for {when}.',
  urgent: 'Passed straight to you.',
  message: 'Message taken.',
  details_missing: 'Details missing.',
};

/**
 * A visit's kind as Coming up writes it, from the example's diary. These suit
 * a heating firm; a firm's own words come with its agreed wording in slice D.
 */
export const DIARY_WORDS: Readonly<Record<VisitKind, string>> = {
  quote_visit: 'Quote visit',
  install: 'Boiler install',
  service: 'Boiler service',
};

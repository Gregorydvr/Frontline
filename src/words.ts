// Labels the owner reads, taken from the example app (SVC, ST and WHO in
// reference/example-app/src.html). Kept as data, like the history lines.

import type { JobState } from './job-state';
import type { Actor, Service } from './record/types';

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

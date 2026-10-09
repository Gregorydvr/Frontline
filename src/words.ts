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

/**
 * A job's state as its chip shows it: the example's colour and icon for each
 * (ST in reference/example-app/src.html).
 */
export const JOB_STATE_CHIPS: Readonly<Record<JobState, { look: string; icon: string }>> = {
  urgent: { look: 'chip-ok', icon: 'i-alert' },
  today: { look: 'chip-plain', icon: 'i-clock' },
  booked: { look: 'chip-good', icon: 'i-cal' },
};

/** Each service's icon, from the example's SVC. */
export const SERVICE_ICONS: Readonly<Record<Service, string>> = {
  calls: 'i-calls',
  quotes: 'i-quote',
  followups: 'i-followup',
  paperwork: 'i-paperwork',
  invoices: 'i-invoice',
};

/**
 * The words on the owner's screens. Those marked "new" are not in the
 * example, and are listed in the pull request for slice F; the rest are the
 * example's own.
 */
export const APP_WORDS = {
  // Around every screen.
  menu: 'Menu',
  home: 'Home',
  back: 'Back',
  allJobs: 'All jobs',
  yourRules: 'Your rules',
  messageUs: 'Message us',
  find: 'Find',
  example: 'Example',
  // New: the example has no way to log out.
  logOut: 'Log out',
  // New: a page that is not there, or is another firm's.
  notFoundTitle: 'Not found',
  notFound: 'We can’t find that page.',
  // Home.
  needsYourOk: 'Needs your OK',
  nothingNeedsYou: 'Nothing needs you right now.',
  doneForYouToday: 'Done for you today',
  seeAll: 'See all {count}',
  yourServices: 'Your services',
  rulesRow: 'Prices, wording and times',
  callsAnswered: '{count} answered today',
  // New: Done for you with nothing in it yet.
  nothingYetToday: 'Nothing yet today.',
  // Done for you.
  doneForYou: 'Done for you',
  doneForYouMeta: 'Everything Front-line did in your name.',
  today: 'Today',
  yesterday: 'Yesterday',
  // New.
  nothingYesterday: 'Nothing yesterday.',
  // All jobs.
  findLabel: 'Find a job or a customer',
  findPlaceholder: 'Name, job or street',
  noMatch: 'No job or customer matches that.',
  // New: a firm with no jobs yet.
  noJobsYet: 'No jobs yet. Calls we answer for you show up here.',
  // A job's page.
  whatHappensNext: 'What happens next',
  everythingSoFar: 'Everything so far',
  nextUrgent: 'This one is with you. Tell us what happened and we take it from there.',
  // New: the example's "We remind her the day before the visit." without
  // the pronoun, as a job page has none.
  nextReminder: 'We send a reminder the day before the visit.',
  // Calls & bookings. New: nothing in the diary yet.
  nothingBooked: 'Nothing booked yet.',
  // Your rules.
  rulesMeta: 'We set these up with you. To change one, tell us.',
  rulesAnswer: 'We answer when you can’t pick up.',
  rulesVisits: '{Visits} go in {days}, {opens} to {closes}.',
  rulesUrgent: 'Anything urgent, like {list}, comes straight to you.',
  messagesToCustomers: 'Messages to customers',
  // New: in place of the example's WhatsApp lines, which are out of date
  // (section 6 of docs/build-brief.md). The second is Greg's quiet hours.
  rulesByText: 'They go by text from your own number, in your name.',
  rulesQuietHours: 'No texts go to customers between 8pm and 8am.',
  tellUsWhatToChange: 'Tell us what to change',
  // Message us.
  messageTitle: 'Message Sophie or Greg',
  messageLabel: 'What do you need?',
  messagePlaceholder: 'For example: put my day rate up to £320 from Monday.',
  messageSend: 'Send message',
  messageSentTitle: 'Sent',
  messageSent: 'Sophie or Greg will come back to you.',
  done: 'Done',
  close: 'Close',
  // New: Message us sent empty.
  messageMissing: 'Please write what you need.',
  // New: a button that is sending, so it cannot be tapped twice.
  sending: 'Sending…',
  loggingIn: 'Logging in…',
} as const;

/**
 * Lines on a job's page for a text that did not reach the customer. New in
 * slice F; flagged in its pull request. {text} is what the text was, from
 * TEXT_WORDS below.
 */
export const TEXT_PROBLEM_WORDS = {
  failed: 'The {text} did not reach them. We are looking into it.',
  notSent: 'The {text} did not go. We are looking into it.',
  optedOut: 'The {text} did not go: they asked for no more texts.',
  landline: 'No text can reach them: they rang from a landline.',
  withheld: 'No text can reach them: their number was withheld.',
} as const;

/** What each kind of text to a customer is, as the lines above name it. */
export const TEXT_WORDS = {
  visit_confirmation: 'confirmation',
  visit_confirmation_first: 'confirmation',
  visit_reminder: 'reminder',
} as const;

/**
 * The words on the pages for logging in. All new in slice F; flagged in its
 * pull request.
 */
export const LOGIN_WORDS = {
  title: 'Log in',
  intro: 'We text a link to your mobile.',
  mobile: 'Your mobile',
  send: 'Text me a link',
  badMobile: 'That doesn’t look like a UK mobile number. Please check it.',
  sentTitle: 'Check your texts',
  sent: 'If that mobile is on our list, a link is on its way. It works for 15 minutes.',
  sendAnother: 'Send another link',
  linkTitle: 'Log in to Front-line',
  link: 'Tap the button to log in on this phone or computer.',
  logIn: 'Log in',
  expiredTitle: 'This link has expired',
  expired: 'Each link works once, for 15 minutes.',
  newLink: 'Text me a new link',
} as const;

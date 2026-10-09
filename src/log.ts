// Logs carry ids only (rule 11 in CLAUDE.md): no names, phone numbers,
// addresses, message text or transcripts. An event comes from a fixed list,
// and each field is an id, a number, true or false, or the type of an error.
// Free text does not fit the types. This is the only file that writes to the
// console.

import type { Id } from './ids';

export type LogEvent =
  | 'unhandled_error'
  // A report from Vapi as a call ends (src/land-call.ts and src/app.ts).
  | 'call_report_refused'
  | 'call_report_unreadable'
  | 'call_for_unknown_number'
  | 'call_stored'
  | 'call_repeated'
  | 'urgent_not_on_list'
  | 'call_while_calls_off'
  // Texts going out (src/send.ts and src/providers/texts/).
  | 'text_sent'
  | 'text_held'
  | 'text_not_sent'
  | 'text_failed'
  | 'text_unclear'
  | 'text_already'
  | 'texts_not_set_up'
  // Requests from Twilio (src/app.ts).
  | 'twilio_refused'
  | 'twilio_too_large'
  | 'twilio_unreadable'
  | 'text_in_for_unknown_number'
  | 'text_in_stored'
  | 'text_in_repeated'
  | 'text_in_consent'
  | 'delivery_recorded'
  | 'delivery_for_unknown_text'
  // The clock and the due list (src/due.ts).
  | 'due_queued'
  | 'due_unreadable'
  | 'due_failed'
  | 'due_too_late'
  | 'due_claim_lost'
  | 'alert_nobody_to_tell'
  | 'reminder_visit_changed'
  | 'confirmation_visit_changed'
  // The voice agent asking for free times and booking one during a call
  // (src/app.ts and src/booking.ts).
  | 'tool_call_refused'
  | 'tool_call_unreadable'
  | 'tool_call_for_unknown_number'
  | 'free_times_given'
  | 'time_held'
  | 'time_taken'
  | 'time_not_offered'
  | 'booking_while_calls_off'
  // A call's held time, when the call ends (src/land-call.ts).
  | 'hold_filed'
  | 'hold_released'
  // A customer's link to confirm their details (src/app.ts).
  | 'link_not_found'
  | 'details_saved'
  | 'details_refused';

const ERROR_NAMES = [
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  // The record layer's refusal (src/record/db.ts).
  'Refused',
] as const;

/** The type of an error, taken from a fixed list. Never its message. */
export type ErrorName = (typeof ERROR_NAMES)[number];

export type LogValue = Id | number | boolean | ErrorName;

export function log(event: LogEvent, fields: Readonly<Record<string, LogValue>> = {}): void {
  console.log(JSON.stringify({ ...fields, event }));
}

/** The type of a thrown value, for a log line. Anything not on the fixed list is "Error". */
export function errorName(thrown: unknown): ErrorName {
  const name: unknown = thrown instanceof Error ? thrown.name : undefined;
  return ERROR_NAMES.find((known) => known === name) ?? 'Error';
}

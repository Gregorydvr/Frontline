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
  | 'call_while_calls_off';

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

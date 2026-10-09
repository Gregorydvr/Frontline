// Reads what Vapi sends when one of a firm's calls ends: its
// "end-of-call-report". The shape is Vapi's own, taken from the types in its
// server kit, @vapi-ai/server-sdk 2.0.1 (ServerMessageEndOfCallReport), which
// are built from Vapi's description of what it sends.
//
//   { "message": {
//       "type": "end-of-call-report",
//       "call": { "id", "startedAt", "endedAt", "customer": { "number" }, ... },
//       "phoneNumber": { "number" },       the number that was rung
//       "customer": { "number" },          the number the call came from
//       "startedAt", "endedAt",
//       "artifact": { "transcript", "recordingUrl", ... },
//       "analysis": { "summary", "structuredData": { ...the fields below } },
//       ... } }
//
// The details of the call are in analysis.structuredData. Those fields are
// ours: the voice agent fills them, with the schema in docs/vapi.md. Like any
// routine's output (rule 16 in CLAUDE.md), each is checked here, and one that
// fails the check counts as missing. They are words from a caller, written
// down by a model, so they are data and never instructions (rule 17).
//
// Only the fields read here are kept. The rest of the report, which can hold
// the caller's details and parts of Vapi's set-up, is dropped unread.
//
// The recording: Vapi writes it into Front-line's inbox file store, under the
// firm's own path, and artifact.recordingUrl names it there (docs/vapi.md).
// Only the name inside the store is kept, never the address. That Vapi's
// address for a file in the store ends with the store's own name for it is
// Assumed until a real report is captured on practice.

import { instantFromIso, type Instant } from './clock';
import { callerNumber, ukMobile, type CallerNumber, type UkMobile } from './phone';
import { CALL_LIMITS } from './record/types';

export interface CallReport {
  /** Vapi's id for the call. */
  providerCallId: string;
  /** The number that was rung, when it is a UK mobile, as every firm's number is. */
  firmNumber: UkMobile | null;
  from: CallerNumber;
  startedAt: Instant | null;
  endedAt: Instant | null;
  /** What the voice agent took down, or null when none of it came through. */
  details: CallDetails | null;
  transcript: string | null;
  recording: ReportedRecording;
}

/**
 * Where the report says the call's recording is:
 * - none: no recording, such as when recording is off
 * - inbox: in the inbox file store, under this name, such as
 *   firms/<firm id>/<Vapi's name>.mp3. Whose firm's path it is, is checked
 *   when the firm is known.
 * - elsewhere: somewhere that is not the inbox, such as Vapi's own storage.
 *   Nothing is fetched from there, and staff are shown it was not kept.
 */
export type ReportedRecording = { kind: 'none' } | { kind: 'inbox'; name: string } | { kind: 'elsewhere' };

/** What the voice agent took down. A field that failed its check is null. */
export type CallDetails =
  | {
      callerType: 'customer';
      /** The name as given, such as "Mrs Ahmed". */
      name: string | null;
      /** What the job is about, such as "Boiler replacement". */
      about: string | null;
      address: string | null;
      summary: string | null;
      /** The item on the firm's urgent list that the call matched, as the agent wrote it. */
      urgentMatch: string | null;
    }
  | {
      callerType: 'other';
      /** Who rang, such as "a supplier". */
      whoRang: string | null;
      summary: string | null;
    };

export type VapiMessage =
  | { kind: 'report'; report: CallReport }
  /** A kind of message from Vapi that nothing here acts on, such as a status update. */
  | { kind: 'other' }
  /** Not a message from Vapi, or a report without the call's id. */
  | { kind: 'unreadable' };

export function readVapiMessage(body: unknown): VapiMessage {
  const message = field(body, 'message');
  const type = field(message, 'type');
  if (typeof type !== 'string') {
    return { kind: 'unreadable' };
  }
  if (type !== 'end-of-call-report') {
    return { kind: 'other' };
  }
  const call = field(message, 'call');
  const providerCallId = text(field(call, 'id'), CALL_LIMITS.providerCallId);
  if (providerCallId === null) {
    return { kind: 'unreadable' };
  }
  const rung = string(field(field(message, 'phoneNumber'), 'number')) ?? string(field(field(call, 'phoneNumber'), 'number'));
  const from = string(field(field(message, 'customer'), 'number')) ?? string(field(field(call, 'customer'), 'number'));
  const transcript = string(field(field(message, 'artifact'), 'transcript'));
  return {
    kind: 'report',
    report: {
      providerCallId,
      firmNumber: rung === null ? null : mobileOrNull(rung),
      from: callerNumber(from),
      startedAt: when(field(message, 'startedAt')) ?? when(field(call, 'startedAt')),
      endedAt: when(field(message, 'endedAt')) ?? when(field(call, 'endedAt')),
      details: readDetails(field(field(message, 'analysis'), 'structuredData')),
      transcript: transcript === null || transcript.trim() === '' || transcript.length > CALL_LIMITS.transcript ? null : transcript,
      recording: reportedRecording(string(field(field(message, 'artifact'), 'recordingUrl'))),
    },
  };
}

/**
 * The inbox's name for a recording, from Vapi's address for it: the part of
 * the path from "firms/" on. Whichever form the address takes (the store's
 * name first in the path, or in the host), the name inside the store is the
 * same.
 */
export function reportedRecording(address: string | null): ReportedRecording {
  if (address === null || address.trim() === '') {
    return { kind: 'none' };
  }
  let path: string;
  try {
    path = decodeURIComponent(new URL(address).pathname);
  } catch {
    return { kind: 'elsewhere' };
  }
  const at = path.indexOf('/firms/');
  return at === -1 ? { kind: 'elsewhere' } : { kind: 'inbox', name: path.slice(at + 1) };
}

function readDetails(data: unknown): CallDetails | null {
  const summary = text(field(data, 'summary'), CALL_LIMITS.summary);
  switch (field(data, 'callerType')) {
    case 'customer':
      return {
        callerType: 'customer',
        name: text(field(data, 'name'), CALL_LIMITS.name),
        about: text(field(data, 'about'), CALL_LIMITS.about),
        address: text(field(data, 'address'), CALL_LIMITS.place),
        summary,
        urgentMatch: text(field(data, 'urgentMatch'), CALL_LIMITS.urgentItem),
      };
    case 'other':
      return { callerType: 'other', whoRang: text(field(data, 'whoRang'), CALL_LIMITS.caller), summary };
    default:
      return null;
  }
}

/** One field of an object, or undefined for anything that is not an object. */
export function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.hasOwn(value, name)
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

export function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Text that fits on one line: runs of spaces and line breaks become one
 * space. Empty, too long, or holding other control characters counts as
 * missing.
 */
export function text(value: unknown, longest: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine === '' || oneLine.length > longest || /\p{Cc}/u.test(oneLine) ? null : oneLine;
}

function when(value: unknown): Instant | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return instantFromIso(value);
  } catch {
    return null;
  }
}

export function mobileOrNull(number: string): UkMobile | null {
  try {
    return ukMobile(number);
  } catch {
    return null;
  }
}

// Reads what Vapi sends when the voice agent uses one of Front-line's tools
// during a call: asking for free times, or booking one. The shape is Vapi's
// own, taken from the types in its server kit, @vapi-ai/server-sdk 2.0.1
// (ServerMessageToolCalls, ToolCall, ToolCallFunction), the same source as
// the report in src/vapi-report.ts:
//
//   { "message": {
//       "type": "tool-calls",
//       "toolCallList": [ { "id", "type": "function",
//                           "function": { "name", "arguments" } } ],
//       "call": { "id", ... },              the call it is for
//       "phoneNumber": { "number" },        the number that was rung
//       ... } }
//
// The kit types `arguments` as a string of JSON. It is read as that, and also
// when it comes already unpacked as an object; docs/vapi.md asks Greg to
// check a real one. What the agent puts in the arguments is ours to define
// (docs/vapi.md). It is words from a caller, written down by a model, so it
// is data and never instructions (rule 17 in CLAUDE.md), and each field is
// checked where it is used.
//
// Front-line answers each tool call with ServerMessageResponseToolCalls:
// { "results": [ { "name", "toolCallId", "result" } ] }, where `result` is
// text the agent reads (here, JSON it can read from).

import { CALL_LIMITS } from './record/types';
import { field, mobileOrNull, string, text } from './vapi-report';
import type { UkMobile } from './phone';

/** The names of Front-line's tools, as set on the voice agent (docs/vapi.md). */
export const TOOL_NAMES = { freeTimes: 'free_times', book: 'book_visit' } as const;

/** The most tool calls read from one message, and the longest each part may be. */
export const TOOL_LIMITS = { calls: 10, id: 100, name: 60, arguments: 2_000 } as const;

export interface ToolCall {
  /** Vapi's id for this tool call, which the answer names. */
  id: string;
  name: string;
  /** The arguments, or null when they could not be read as an object. */
  args: Record<string, unknown> | null;
}

export type VapiToolMessage =
  | {
      kind: 'tool_calls';
      /** Vapi's id for the call, which ties a booking to the report when the call ends. */
      providerCallId: string | null;
      firmNumber: UkMobile | null;
      calls: ToolCall[];
    }
  | { kind: 'unreadable' };

export function readToolCalls(body: unknown): VapiToolMessage {
  const message = field(body, 'message');
  const list = field(message, 'toolCallList');
  if (field(message, 'type') !== 'tool-calls' || !Array.isArray(list) || list.length === 0 || list.length > TOOL_LIMITS.calls) {
    return { kind: 'unreadable' };
  }
  const calls: ToolCall[] = [];
  for (const item of list) {
    const id = text(field(item, 'id'), TOOL_LIMITS.id);
    const name = text(field(field(item, 'function'), 'name'), TOOL_LIMITS.name);
    if (id === null || name === null) {
      return { kind: 'unreadable' };
    }
    calls.push({ id, name, args: argumentsOf(field(field(item, 'function'), 'arguments')) });
  }
  const call = field(message, 'call');
  const rung = string(field(field(message, 'phoneNumber'), 'number')) ?? string(field(field(call, 'phoneNumber'), 'number'));
  return {
    kind: 'tool_calls',
    providerCallId: text(field(call, 'id'), CALL_LIMITS.providerCallId),
    firmNumber: rung === null ? null : mobileOrNull(rung),
    calls,
  };
}

/** The arguments as an object: a string of JSON, as Vapi's kit says, or an object already. */
function argumentsOf(value: unknown): Record<string, unknown> | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (value.length > TOOL_LIMITS.arguments) {
      return null;
    }
    try {
      parsed = JSON.parse(value === '' ? '{}' : value);
    } catch {
      return null;
    }
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

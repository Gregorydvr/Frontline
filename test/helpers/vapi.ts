// Sending Vapi's reports to the system in tests, the way Vapi does: a POST
// with the shared secret as a Bearer token. The reports are the example files
// in test/fixtures/vapi/, with invented people.

import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { AppEnv } from '../../src/app';
import { ukMobile } from '../../src/phone';
import { DRAFT_WORDING } from '../../src/messages';
import { EXAMPLE_DIARY_RULES } from '../../src/example/tidewell';
import { createFirm, createOwner, setDiaryRules, setFirmNumber, setService, setUrgentList, setWording } from '../../src/record';
import type { RecordDb } from '../../src/record/db';
import type { FirmId, MessageKind } from '../../src/record/types';
import book from '../fixtures/vapi/book.json';
import freeTimes from '../fixtures/vapi/free-times.json';
import hangUp from '../fixtures/vapi/hang-up.json';
import landlineCaller from '../fixtures/vapi/landline-caller.json';
import mrPriceLeak from '../fixtures/vapi/mr-price-leak.json';
import mrsAhmedBooked from '../fixtures/vapi/mrs-ahmed-booked.json';
import supplier from '../fixtures/vapi/supplier.json';
import withheldCaller from '../fixtures/vapi/withheld-caller.json';

export const REPORTS = {
  supplier,
  'mr-price-leak': mrPriceLeak,
  'landline-caller': landlineCaller,
  'withheld-caller': withheldCaller,
  'hang-up': hangUp,
  'mrs-ahmed-booked': mrsAhmedBooked,
} as const;

/** The example messages Vapi sends when the voice agent uses one of Front-line's tools during Mrs Ahmed's call. */
export const TOOL_CALLS = { 'free-times': freeTimes, book } as const;

export type ToolCallName = keyof typeof TOOL_CALLS;

export type ReportName = keyof typeof REPORTS;

export type Report = Record<string, unknown> & { message: Record<string, unknown> };

/**
 * A copy of an example report, to change without touching the file. `to` is
 * the number that was rung, so each test can have a firm of its own.
 *
 * The example reports name a recording in the inbox under the path of the
 * firm the call is for, "firms/{firm}/" (docs/vapi.md). Given the firm, the
 * copy names it there; without, the copy has no recording, as most tests
 * need none.
 */
export function report(name: ReportName, to?: string, recordingOf?: FirmId): Report {
  const copy = structuredClone(REPORTS[name]) as unknown as Report;
  if (to !== undefined) {
    (copy.message.phoneNumber as Record<string, unknown>).number = to;
  }
  const artifact = copy.message.artifact as Record<string, unknown> | undefined;
  if (artifact !== undefined && typeof artifact.recordingUrl === 'string') {
    if (recordingOf === undefined) {
      delete artifact.recordingUrl;
    } else {
      artifact.recordingUrl = artifact.recordingUrl.replace('{firm}', recordingOf);
    }
  }
  return copy;
}

/** The inbox's name for the recording an example report names, for the firm it is for. */
export function reportedRecording(name: ReportName, firm: FirmId): string {
  const artifact = REPORTS[name].message.artifact as { recordingUrl?: string };
  const address = artifact.recordingUrl;
  if (address === undefined) throw new Error('This example report has no recording');
  return new URL(address).pathname.slice(1).replace('%7Bfirm%7D', firm).replace('{firm}', firm);
}

/**
 * A copy of an example tool call, to change without touching the file: the
 * arguments the agent gave, and optionally the number that was rung and
 * Vapi's id for the call, so it can belong to another call or firm.
 */
export function toolCall(
  name: ToolCallName,
  args: Record<string, unknown> | string,
  options: { to?: string; callId?: string } = {},
): Report {
  const copy = structuredClone(TOOL_CALLS[name]) as unknown as Report;
  const [call] = copy.message.toolCallList as { function: { arguments: unknown } }[];
  if (call === undefined) throw new Error('No tool call');
  call.function.arguments = typeof args === 'string' ? args : JSON.stringify(args);
  if (options.to !== undefined) {
    (copy.message.phoneNumber as Record<string, unknown>).number = options.to;
  }
  if (options.callId !== undefined) {
    (copy.message.call as Record<string, unknown>).id = options.callId;
  }
  return copy;
}

/** Sends a tool call to one of the two addresses the voice agent uses during a call. */
export async function sendTool(
  app: Hono<AppEnv>,
  address: '/vapi/free-times' | '/vapi/book',
  body: unknown,
  headers: Record<string, string> = { Authorization: `Bearer ${env.VAPI_SECRET}` },
): Promise<Response> {
  return app.request(
    address,
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) },
    env,
  );
}

/** What Front-line answered the agent for its one tool call: the result, read as JSON. */
export async function toolAnswer(response: Response): Promise<Record<string, unknown>> {
  const body: { results: { result?: string; error?: string }[] } = await response.json();
  const [first] = body.results;
  if (first?.result === undefined) throw new Error('No result');
  return JSON.parse(first.result) as Record<string, unknown>;
}

/** The same report with Vapi's id for the call changed, so it is another call. */
export function asAnotherCall(body: Report, callId: string): Report {
  const copy = structuredClone(body);
  (copy.message.call as Record<string, unknown>).id = callId;
  return copy;
}

/** The same report with its structured data changed. */
export function withDetails(body: Report, change: (data: Record<string, unknown>) => unknown): Report {
  const copy = structuredClone(body);
  const analysis = copy.message.analysis as Record<string, unknown>;
  analysis.structuredData = change({ ...(analysis.structuredData as Record<string, unknown>) });
  return copy;
}

export async function send(
  app: Hono<AppEnv>,
  body: unknown,
  headers: Record<string, string> = { Authorization: `Bearer ${env.VAPI_SECRET}` },
  bindings: Env = env,
): Promise<Response> {
  return app.request(
    '/vapi/server',
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) },
    bindings,
  );
}

/** Tom's mobile, for his alerts. */
export const TOMS_MOBILE = '+447700900101';

/**
 * Tidewell Heating as it is set up for a real firm, with nothing in it yet:
 * its number, its urgent list, when quote visits can be booked, calls
 * switched on, owner Tom with his mobile, and its agreed wording: the drafts,
 * for every kind of text that has one, apart from any left out.
 */
export async function tidewell(db: RecordDb, number = '07700 900100', without: readonly MessageKind[] = []): Promise<FirmId> {
  const staff = { kind: 'frontline' } as const;
  const firm = await createFirm(db, { name: 'Tidewell Heating', isExample: false });
  await setFirmNumber(db, firm, ukMobile(number), staff);
  await setUrgentList(db, firm, ['a leak'], staff);
  await setDiaryRules(db, firm, EXAMPLE_DIARY_RULES, staff);
  await setService(db, firm, 'calls', true, staff);
  await createOwner(db, firm, { name: 'Tom', mobile: ukMobile(TOMS_MOBILE) });
  for (const [kind, words] of Object.entries(DRAFT_WORDING) as [MessageKind, string | null][]) {
    if (words !== null && !without.includes(kind)) {
      await setWording(db, firm, `text:${kind}`, words, staff);
    }
  }
  return firm;
}

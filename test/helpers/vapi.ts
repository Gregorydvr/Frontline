// Sending Vapi's reports to the system in tests, the way Vapi does: a POST
// with the shared secret as a Bearer token. The reports are the example files
// in test/fixtures/vapi/, with invented people.

import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { AppEnv } from '../../src/app';
import { ukMobile } from '../../src/phone';
import { DRAFT_WORDING } from '../../src/messages';
import { createFirm, createOwner, setFirmNumber, setService, setUrgentList, setWording } from '../../src/record';
import type { RecordDb } from '../../src/record/db';
import type { FirmId } from '../../src/record/types';
import hangUp from '../fixtures/vapi/hang-up.json';
import landlineCaller from '../fixtures/vapi/landline-caller.json';
import mrPriceLeak from '../fixtures/vapi/mr-price-leak.json';
import supplier from '../fixtures/vapi/supplier.json';
import withheldCaller from '../fixtures/vapi/withheld-caller.json';

export const REPORTS = {
  supplier,
  'mr-price-leak': mrPriceLeak,
  'landline-caller': landlineCaller,
  'withheld-caller': withheldCaller,
  'hang-up': hangUp,
} as const;

export type ReportName = keyof typeof REPORTS;

export type Report = Record<string, unknown> & { message: Record<string, unknown> };

/**
 * A copy of an example report, to change without touching the file. `to` is
 * the number that was rung, so each test can have a firm of its own.
 */
export function report(name: ReportName, to?: string): Report {
  const copy = structuredClone(REPORTS[name]) as unknown as Report;
  if (to !== undefined) {
    (copy.message.phoneNumber as Record<string, unknown>).number = to;
  }
  return copy;
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
 * Words for the owner's urgent alert, for the tests only. The real words wait
 * on open question 7 in docs/decisions.md.
 */
export const TEST_ALERT_WORDING = 'Test alert: urgent call from {customer}, {place}. {summary} Their number: {number}.';

/**
 * Tidewell Heating as it is set up for a real firm, with nothing in it yet:
 * its number, its urgent list, calls switched on, owner Tom with his mobile,
 * and its agreed wording: the reminder's draft, and the tests' words for the
 * urgent alert.
 */
export async function tidewell(db: RecordDb, number = '07700 900100'): Promise<FirmId> {
  const staff = { kind: 'frontline' } as const;
  const firm = await createFirm(db, { name: 'Tidewell Heating', isExample: false });
  await setFirmNumber(db, firm, ukMobile(number), staff);
  await setUrgentList(db, firm, ['a leak'], staff);
  await setService(db, firm, 'calls', true, staff);
  await createOwner(db, firm, { name: 'Tom', mobile: ukMobile(TOMS_MOBILE) });
  await setWording(db, firm, 'text:visit_reminder', DRAFT_WORDING.visit_reminder ?? '', staff);
  await setWording(db, firm, 'text:urgent_alert', TEST_ALERT_WORDING, staff);
  return firm;
}

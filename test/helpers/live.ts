// A firm taken all the way to live, as the control room does it: set up in
// full on its own number, a call through it, texts out and in, its agent in
// step, every tick, its test call, then switched to live by the stand-in
// member of staff the copy names. For tests of what going live starts, such
// as billing. The firm and people are invented, on numbers set aside for
// drama.

import { expect } from 'vitest';
import { createApp } from '../../src/app';
import type { Clock } from '../../src/clock';
import { instantFromIso } from '../../src/clock';
import { STAFF_TICKED_ITEMS } from '../../src/go-live';
import { findOrAddStaff, listMessagesBetween, recordAgentPush, setAgent, setServicesChosen } from '../../src/record';
import type { RecordDb } from '../../src/record/db';
import type { FirmId, Service } from '../../src/record/types';
import { controlForm, controlOpener } from './control';
import { testDeps, type TestDeps } from './deps';
import { postToTwilioRoute, pretendTwilio, twilioFields } from './twilio';
import { report, send, tidewell } from './vapi';

const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;

/** The system as tests open it: the app Vapi, Twilio and Stripe reach, and the control room as the stand-in member of staff. */
export function systemFor(clock: Clock, change: Partial<TestDeps> = {}) {
  const deps = { ...testDeps(clock), texts: pretendTwilio(), ...change } as TestDeps;
  const app = createApp(() => deps);
  const open = controlOpener(app);
  return {
    deps,
    app,
    open: async (path: string, init?: RequestInit) => {
      const answer = await open(path, init);
      return { status: answer.status, location: answer.headers.get('Location'), words: await answer.text() };
    },
  };
}

export type System = ReturnType<typeof systemFor>;

/** A firm on `number`, with every item on its go-live checklist met and the services given chosen. Not yet live. */
export async function readyFirm(db: RecordDb, system: System, number: string, services: readonly Service[]): Promise<FirmId> {
  const firm = await tidewell(db, number);
  const e164 = number.replace(/^0/, '+44').replace(/ /g, '');
  const call = report('mr-price-leak', e164);
  const vapiId = `live-${e164}`;
  (call.message.call as Record<string, unknown>).id = vapiId;
  expect((await send(system.app, call)).status).toBe(200);
  const [alert] = await listMessagesBetween(db, firm, ...allTime);
  if (alert?.providerId == null) throw new Error('No alert went');
  expect((await postToTwilioRoute(system.app, '/twilio/status', twilioFields('delivered', { MessageSid: alert.providerId, SmsSid: alert.providerId, From: e164 }))).status).toBe(200);
  const sid = `SM${e164.slice(-9).padStart(32, '7')}`;
  expect((await postToTwilioRoute(system.app, '/twilio/texts', twilioFields('text-in', { To: e164, MessageSid: sid, SmsSid: sid, SmsMessageSid: sid }))).status).toBe(200);
  const staff = (await findOrAddStaff(db, 'staff@example.com')).id;
  await setServicesChosen(db, firm, services, { kind: 'frontline' });
  const assistant = `00000000-0000-4000-8000-${e164.slice(-12).padStart(12, '0')}`;
  await setAgent(db, firm, assistant, staff);
  await recordAgentPush(db, firm, { assistantId: assistant, by: { kind: 'frontline' }, due: null, outcome: 'in_step', settings: [], state: 'in_step', differing: [] });
  expect((await system.open(`/control/firms/${firm}/go-live/ticks`, controlForm({ ticked: [...STAFF_TICKED_ITEMS] }))).status).toBe(303);
  expect((await system.open(`/control/firms/${firm}/go-live/test-call`, controlForm({ vapiId, passed: '1' }))).status).toBe(303);
  return firm;
}

/** A firm switched to live in the control room, with the services given. */
export async function liveFirm(db: RecordDb, system: System, number: string, services: readonly Service[] = ['calls']): Promise<FirmId> {
  const firm = await readyFirm(db, system, number, services);
  expect((await system.open(`/control/firms/${firm}/go-live`, controlForm({}))).location).toBe(`/control/firms/${firm}/go-live?done=live`);
  return firm;
}

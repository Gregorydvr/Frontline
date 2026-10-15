// A call's report in the control room (src/call-report.ts), as
// scripts/last-call.js reads it: ids, states and times for the call, its
// customer, job, visit, hold, due rows and texts, and where a booking's two
// texts stand, never a name, a number or words from the call. Read only,
// apart from the staff log (rule 15).

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instant, instantFromIso, pretendClock } from '../src/clock';
import { runDue } from '../src/due';
import { listCallsBetween, listDueForVisit, setStopButton } from '../src/record';
import { openRecord } from '../src/record/db';
import type { Due, DueAction, FirmId } from '../src/record/types';
import { firmRows } from './helpers/db';
import { controlOpener } from './helpers/control';
import { testDeps } from './helpers/deps';
import { asAnotherCall, report, send, sendTool, tidewell, toolCall } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-09-28T11:14:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const app = createApp(() => deps);
const open = controlOpener(app);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;

let firm: FirmId;
let number: string;
let numbers = 700;

beforeEach(async () => {
  clock.set(instantFromIso('2026-09-28T11:14:00+01:00'));
  numbers += 1;
  number = `+447700900${String(numbers)}`;
  firm = await tidewell(db, number);
});

/** Mrs Ahmed books Thursday 1 October at 3pm, her call ends, and her confirmation goes. Gives Vapi's id for the call. */
async function bookedCall(): Promise<string> {
  const vapiId = await bookedCallOnly('2026-09-28T11:15:12+01:00');
  await runDue(db, deps, firm, (await visitRow('send_confirmation')).id);
  return vapiId;
}

/** Mrs Ahmed books Thursday 1 October at 3pm, a minute before her call ends at `ended`, with nothing in the due list run yet. */
async function bookedCallOnly(ended: string): Promise<string> {
  const vapiId = `report-${String(numbers)}`;
  clock.set(instant(instantFromIso(ended) - 72_000));
  await sendTool(app, '/vapi/book', toolCall('book', { start: '2026-10-01T15:00' }, { to: number, callId: vapiId }));
  clock.set(instantFromIso(ended));
  expect((await send(app, asAnotherCall(report('mrs-ahmed-booked', number), vapiId))).status).toBe(200);
  return vapiId;
}

/** The booked visit's row in the due list with this action. */
async function visitRow(action: DueAction): Promise<Due> {
  const [call] = await listCallsBetween(db, firm, ...allTime);
  if (call?.visit === undefined || call.visit === null) throw new Error('Not booked');
  const row = (await listDueForVisit(db, firm, call.visit.id)).find((due) => due.action === action);
  if (row === undefined) throw new Error(`No ${action}`);
  return row;
}

describe('a call’s report', () => {
  it('gives a booked call’s customer, job, visit, hold, due rows and confirmation', async () => {
    const vapiId = await bookedCall();
    const [call] = await listCallsBetween(db, firm, ...allTime);
    const answer = await open(`/control/firms/${firm}/calls/vapi/${vapiId}`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    const body: Record<string, unknown> = await answer.json();
    expect(body).toMatchObject({
      call: { id: call?.id, vapiId, from: 'mobile', outcome: 'booked', urgentItem: null, hasSummary: true, hasTranscript: true, recording: 'none' },
      customer: { id: call?.customer?.id, newOnThisCall: true, hasMobile: true, detailsConfirmed: false },
      job: { id: call?.job, urgent: false },
      visit: { id: call?.visit?.id, kind: 'quote_visit', state: 'booked', startsAt: '2026-10-01T14:00:00.000Z', endsAt: '2026-10-01T15:00:00.000Z' },
      holds: [{ state: 'filed', visit: call?.visit?.id, startsAt: '2026-10-01T14:00:00.000Z' }],
      due: [
        { action: 'send_confirmation', state: 'done', runAt: '2026-09-28T10:15:12.000Z', latestAt: '2026-10-01T14:00:00.000Z' },
        { action: 'tell_owner_booked', state: 'waiting', runAt: '2026-09-28T10:15:12.000Z', latestAt: '2026-10-01T14:00:00.000Z' },
        { action: 'send_reminder', state: 'waiting', runAt: '2026-09-30T12:00:00.000Z' },
      ],
      booking: {
        customerText: { state: 'sent', until: null, reasons: [] },
        ownerText: { state: 'waiting', until: null, reasons: [] },
      },
      texts: [{ kind: 'visit_confirmation_first', to: 'customer', state: 'sent', reason: null }],
    });
  });

  it('says the owner’s text about the booking went, once its row has run', async () => {
    const vapiId = await bookedCall();
    const told = await visitRow('tell_owner_booked');
    await runDue(db, deps, firm, told.id);
    const body: Record<string, unknown> = await (await open(`/control/firms/${firm}/calls/vapi/${vapiId}`)).json();
    expect(body).toMatchObject({
      booking: {
        customerText: { state: 'sent', until: null, reasons: [] },
        ownerText: { due: told.id, state: 'sent', until: null, reasons: [] },
      },
    });
    expect(body.texts).toContainEqual(expect.objectContaining({ kind: 'visit_booked', to: 'owner', state: 'sent' }));
  });

  it('says both texts are held for quiet hours after a call at night, and when they go', async () => {
    const vapiId = await bookedCallOnly('2026-09-28T21:31:12+01:00');
    await runDue(db, deps, firm, (await visitRow('send_confirmation')).id);
    await runDue(db, deps, firm, (await visitRow('tell_owner_booked')).id);
    const body: Record<string, unknown> = await (await open(`/control/firms/${firm}/calls/vapi/${vapiId}`)).json();
    expect(body).toMatchObject({
      booking: {
        customerText: { state: 'quiet_hours', until: '2026-09-29T07:00:00.000Z', reasons: [] },
        ownerText: { state: 'quiet_hours', until: '2026-09-29T07:00:00.000Z', reasons: [] },
      },
      texts: [],
    });
  });

  it('tells a confirmation held by the stop button, which waits, from one held for quiet hours', async () => {
    const vapiId = await bookedCallOnly('2026-09-28T11:15:12+01:00');
    await setStopButton(db, firm, true, { kind: 'frontline' });
    await runDue(db, deps, firm, (await visitRow('send_confirmation')).id);
    await runDue(db, deps, firm, (await visitRow('tell_owner_booked')).id);
    const body: Record<string, unknown> = await (await open(`/control/firms/${firm}/calls/vapi/${vapiId}`)).json();
    expect(body).toMatchObject({
      booking: {
        customerText: { state: 'waiting', until: null, reasons: [] },
        ownerText: { state: 'sent', until: null, reasons: [] },
      },
    });
  });

  it('gives an urgent call’s alert to the owner, and no visit or hold', async () => {
    const vapiId = `urgent-${String(numbers)}`;
    expect((await send(app, asAnotherCall(report('mr-price-leak', number), vapiId))).status).toBe(200);
    const body: Record<string, unknown> = await (await open(`/control/firms/${firm}/calls/vapi/${vapiId}`)).json();
    expect(body).toMatchObject({
      call: { outcome: 'urgent', urgentItem: 'a leak' },
      visit: null,
      holds: [],
      due: [{ action: 'alert_owner', state: 'done' }],
      booking: { customerText: null, ownerText: null },
      texts: [{ kind: 'urgent_alert', to: 'owner', state: 'sent' }],
    });
  });

  it('holds no name, number, address or words from the call', async () => {
    const vapiId = await bookedCall();
    const words = await (await open(`/control/firms/${firm}/calls/vapi/${vapiId}`)).text();
    for (const personal of ['Mrs Ahmed', 'Ahmed', '+447700900003', '07700 900003', 'Station Road', 'ZZ1', 'boiler', 'cutting out', 'Tidewell', 'Tom', number]) {
      expect(words).not.toContain(personal);
    }
  });

  it('records the view in the staff log, and changes nothing else', async () => {
    const vapiId = await bookedCall();
    const before = await firmRows(env.DB, firm);
    expect((await open(`/control/firms/${firm}/calls/vapi/${vapiId}`)).status).toBe(200);
    const after = await firmRows(env.DB, firm);
    const { staff_log: logBefore = [], ...restBefore } = before;
    const { staff_log: logAfter = [], ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
    expect(logAfter.slice(0, logBefore.length)).toEqual(logBefore);
    expect(logAfter.slice(logBefore.length)).toMatchObject([{ what: 'viewed_call_report', firm_id: firm }]);
  });

  it('is not found for a call the firm does not have, or an id far too long, and records nothing', async () => {
    const before = await firmRows(env.DB, firm);
    expect((await open(`/control/firms/${firm}/calls/vapi/no-such-call`)).status).toBe(404);
    expect((await open(`/control/firms/${firm}/calls/vapi/${'x'.repeat(201)}`)).status).toBe(404);
    expect(await firmRows(env.DB, firm)).toEqual(before);
  });
});

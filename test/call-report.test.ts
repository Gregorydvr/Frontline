// A call's report in the control room (src/call-report.ts), as
// scripts/last-call.js reads it: ids, states and times for the call, its
// customer, job, visit, hold, due rows and texts, never a name, a number or
// words from the call. Read only, apart from the staff log (rule 15).

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { runDue } from '../src/due';
import { listCallsBetween, listDueForVisit } from '../src/record';
import { openRecord } from '../src/record/db';
import type { FirmId } from '../src/record/types';
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
  const vapiId = `report-${String(numbers)}`;
  await sendTool(app, '/vapi/book', toolCall('book', { start: '2026-10-01T15:00' }, { to: number, callId: vapiId }));
  clock.set(instantFromIso('2026-09-28T11:15:12+01:00'));
  expect((await send(app, asAnotherCall(report('mrs-ahmed-booked', number), vapiId))).status).toBe(200);
  const [call] = await listCallsBetween(db, firm, ...allTime);
  if (call?.visit === undefined || call.visit === null) throw new Error('Not booked');
  const confirmation = (await listDueForVisit(db, firm, call.visit.id)).find((due) => due.action === 'send_confirmation');
  if (confirmation === undefined) throw new Error('No confirmation');
  await runDue(db, deps, firm, confirmation.id);
  return vapiId;
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
        { action: 'send_reminder', state: 'waiting', runAt: '2026-09-30T12:00:00.000Z' },
      ],
      texts: [{ kind: 'visit_confirmation_first', to: 'customer', state: 'sent', reason: null }],
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

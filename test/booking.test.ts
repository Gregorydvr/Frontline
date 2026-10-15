// Booking during a call (slice E). The voice agent asks for free times and
// books one through the two addresses it calls during a call, as Vapi sends
// them (test/fixtures/vapi/free-times.json and book.json). The time is held
// under the call's id, and filed as a visit on the call's job when the
// report comes as the call ends.

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { runDue } from '../src/due';
import { instant, instantFromIso, pretendClock } from '../src/clock';
import { ownDiary } from '../src/diary/own';
import {
  createCustomer,
  createJob,
  createOwner,
  createVisit,
  getCall,
  getFirm,
  historyForJob,
  listCallsBetween,
  listCustomers,
  listDueForVisit,
  listJobs,
  listMessagesBetween,
  listTakenTimes,
  listVisitsForJob,
  optOut,
  optOutNumber,
  setDiaryRules,
  setService,
  setStopButton,
} from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import { HOLD_LASTS } from '../src/record/holds';
import type { FirmId } from '../src/record/types';
import { EXAMPLE_DIARY_RULES } from '../src/example/tidewell';
import { ukMobile } from '../src/phone';
import { historyLine } from '../src/history-lines';
import { readToolCalls } from '../src/vapi-tools';
import { APP_ADDRESS, testDeps } from './helpers/deps';
import { asAnotherCall, report, send, sendTool, tidewell, TOMS_MOBILE, toolAnswer, toolCall, withDetails, type Report } from './helpers/vapi';

// Monday 28 September 2026, 11:14, during Mrs Ahmed's call.
const duringTheCall = instantFromIso('2026-09-28T11:14:00+01:00');
const clock = pretendClock(duringTheCall);
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const app = createApp(() => deps);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const frontline = { kind: 'frontline' } as const;

// Each test has a firm of its own, on a number of its own, and its own calls.
let firm: FirmId;
let number: string;
let numbers = 600;

beforeEach(async () => {
  clock.set(duringTheCall);
  numbers += 1;
  number = `+447700900${String(numbers)}`;
  firm = await tidewell(db, number);
});

/** Vapi's id for one of this test's calls. */
function callId(which = 'ahmed'): string {
  return `${which}-${String(numbers)}`;
}

async function freeTimes(args: Record<string, unknown> = {}, call = callId()): Promise<{ start: string; say: string }[]> {
  const answer = await toolAnswer(await sendTool(app, '/vapi/free-times', toolCall('free-times', args, { to: number, callId: call })));
  return answer.times as { start: string; say: string }[];
}

async function book(start: string, call = callId()): Promise<Record<string, unknown>> {
  return toolAnswer(await sendTool(app, '/vapi/book', toolCall('book', { start }, { to: number, callId: call })));
}

/** Mrs Ahmed's report as her call ends, rung to this test's firm. */
function mrsAhmedsReport(call = callId()): Report {
  return asAnotherCall(report('mrs-ahmed-booked', number), call);
}

describe('free times', () => {
  it('offers three times spread across the day asked about: the earliest, midday and the latest', async () => {
    expect(await freeTimes({ day: '2026-10-01' })).toEqual([
      { start: '2026-10-01T08:00', say: 'Thursday 1 October at 8am' },
      { start: '2026-10-01T12:00', say: 'Thursday 1 October at midday' },
      { start: '2026-10-01T15:00', say: 'Thursday 1 October at 3pm' },
    ]);
  });

  it('with no day asked about, offers the first free time on each of the next three working days, the first from noon', async () => {
    // Monday 28 September, 11:14: Tuesday from noon, then Wednesday and Thursday from 8am.
    expect(await freeTimes()).toEqual([
      { start: '2026-09-29T12:00', say: 'Tuesday 29 September at midday' },
      { start: '2026-09-30T08:00', say: 'Wednesday 30 September at 8am' },
      { start: '2026-10-01T08:00', say: 'Thursday 1 October at 8am' },
    ]);
  });

  it('offers nothing today, and nothing at the weekend: from Friday evening, Monday from noon', async () => {
    clock.set(instantFromIso('2026-10-02T17:00:00+01:00'));
    expect((await freeTimes())[0]).toEqual({ start: '2026-10-05T12:00', say: 'Monday 5 October at midday' });
    clock.set(instantFromIso('2026-09-29T07:00:00+01:00'));
    expect((await freeTimes({ day: '2026-09-29' }))[0]?.start).toBe('2026-09-30T12:00');
  });

  it('will not book before noon on the next working day', async () => {
    clock.set(instantFromIso('2026-09-28T20:20:00+01:00'));
    expect(await book('2026-09-29T09:00')).toEqual({ booked: false, why: 'not_offered' });
    expect(await book('2026-09-29T12:00')).toMatchObject({ booked: true });
  });

  it('ends each day with the visit that ends by 4pm, at 3pm', async () => {
    const all = (await ownDiary(db).freeTimes(firm, 'quote_visit', { from: { year: 2026, month: 10, day: 1 }, count: 20, call: null })).slice(0, 8);
    expect(all).toHaveLength(8);
    const thursday = all.filter((time) => time.startsAt < instantFromIso('2026-10-02T00:00:00+01:00'));
    expect(thursday.map((time) => time.startsAt)).toEqual(
      [8, 9, 10, 11, 12, 13, 14, 15].map((hour) => instantFromIso(`2026-10-01T${String(hour).padStart(2, '0')}:00:00+01:00`)),
    );
  });

  it('leaves out a time another call holds, and one a visit has, but offers a call its own', async () => {
    expect(await book('2026-10-01T08:00', callId('other'))).toMatchObject({ booked: true });
    const [mrsAhmed] = await listCustomers(db, firm);
    expect(mrsAhmed).toBeUndefined();
    const customer = await createCustomer(db, firm, { name: 'Mr Khan', mobile: ukMobile('07700 900013') });
    const job = await createJob(db, firm, { customer, about: 'New boiler', place: '9 Mill Road', urgent: false });
    // A visit from before slice E, with no end, counts as an hour.
    await createVisit(db, firm, { job, startsAt: instantFromIso('2026-10-01T09:00:00+01:00'), kind: 'quote_visit' });
    expect((await freeTimes({ day: '2026-10-01' })).map((time) => time.start)).toEqual([
      '2026-10-01T10:00',
      '2026-10-01T12:00',
      '2026-10-01T15:00',
    ]);
    expect((await freeTimes({ day: '2026-10-01' }, callId('other'))).map((time) => time.start)[0]).toBe('2026-10-01T08:00');
  });

  it('offers nothing when the firm has no rules for its diary, or its calls are switched off', async () => {
    await setDiaryRules(db, firm, null, frontline);
    expect(await freeTimes()).toEqual([]);
    await setDiaryRules(db, firm, EXAMPLE_DIARY_RULES, frontline);
    await setService(db, firm, 'calls', false, frontline);
    expect(await freeTimes()).toEqual([]);
  });

  it('reads a day it cannot make sense of as no day', async () => {
    expect((await freeTimes({ day: 'Thursday' }))[0]?.start).toBe('2026-09-29T12:00');
    expect((await freeTimes({ day: '2026-09-31' }))[0]?.start).toBe('2026-09-29T12:00');
  });
});

describe('booking a time', () => {
  it('holds it for the call, and booking twice with the same details holds it once', async () => {
    expect(await book('2026-10-01T15:00')).toEqual({ booked: true, start: '2026-10-01T15:00', say: 'Thursday 1 October at 3pm', text: true });
    expect(await book('2026-10-01T15:00')).toMatchObject({ booked: true });
    expect(await listTakenTimes(db, firm, ...allTime)).toEqual([
      { startsAt: instantFromIso('2026-10-01T15:00:00+01:00'), endsAt: instantFromIso('2026-10-01T16:00:00+01:00') },
    ]);
  });

  it('moves the hold when the same call books another time', async () => {
    await book('2026-10-01T15:00');
    await book('2026-10-02T09:00');
    expect((await listTakenTimes(db, firm, ...allTime)).map((time) => time.startsAt)).toEqual([instantFromIso('2026-10-02T09:00:00+01:00')]);
  });

  it('gives a time to only one of two calls booking it at the same moment', async () => {
    const answers = await Promise.all([book('2026-10-01T15:00', callId('one')), book('2026-10-01T15:00', callId('two'))]);
    expect(answers.map((answer) => answer.booked).sort()).toEqual([false, true]);
    expect(answers).toContainEqual({ booked: false, why: 'taken' });
    expect(await listTakenTimes(db, firm, ...allTime)).toHaveLength(1);
  });

  it.each([
    ['ending after 4pm', '2026-10-01T16:00'],
    ['not on the hour', '2026-10-01T15:30'],
    ['on a Saturday', '2026-10-03T10:00'],
    ['today', '2026-09-28T15:00'],
    ['in the past', '2026-09-25T10:00'],
    ['more than two weeks ahead', '2026-10-30T10:00'],
  ])('refuses a time %s', async (_, start) => {
    expect(await book(start)).toEqual({ booked: false, why: 'not_offered' });
    expect(await listTakenTimes(db, firm, ...allTime)).toEqual([]);
  });

  it('refuses a start it cannot read, and holds nothing', async () => {
    for (const start of ['Thursday at 3pm', '2026-10-01T15:00:00Z', '2026-02-30T10:00']) {
      expect(await book(start)).toEqual({ booked: false, why: 'unreadable' });
    }
    const noArgs = toolCall('book', 'not json', { to: number, callId: callId() });
    expect(await toolAnswer(await sendTool(app, '/vapi/book', noArgs))).toEqual({ booked: false, why: 'unreadable' });
    expect(await listTakenTimes(db, firm, ...allTime)).toEqual([]);
  });

  it('reads the arguments when they come already unpacked, as well as a string of JSON', async () => {
    const body = toolCall('book', {}, { to: number, callId: callId() });
    const [call] = body.message.toolCallList as { function: { arguments: unknown } }[];
    if (call === undefined) throw new Error('No tool call');
    call.function.arguments = { start: '2026-10-01T15:00' };
    expect(await toolAnswer(await sendTool(app, '/vapi/book', body))).toMatchObject({ booked: true });
  });

  it('frees a held time after an hour if the call is never filed', async () => {
    await book('2026-10-01T15:00', callId('lost'));
    expect(await book('2026-10-01T15:00')).toEqual({ booked: false, why: 'taken' });
    clock.advance(HOLD_LASTS + 1);
    expect(await book('2026-10-01T15:00')).toMatchObject({ booked: true });
  });

  it('refuses while the firm’s calls are switched off', async () => {
    await setService(db, firm, 'calls', false, frontline);
    expect(await book('2026-10-01T15:00')).toEqual({ booked: false, why: 'not_offered' });
  });

  it('answers each tool call by its id, and tells a tool call meant for the other address so', async () => {
    const body = toolCall('book', { start: '2026-10-01T15:00' }, { to: number, callId: callId() });
    const answer = await sendTool(app, '/vapi/free-times', body);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      results: [{ name: 'book_visit', toolCallId: 'call_Hm4sJ8cV2nB6xP9qT1wK5rE3', error: 'This tool is not answered here.' }],
    });
    expect(await listTakenTimes(db, firm, ...allTime)).toEqual([]);
  });

  it('refuses a wrong secret, a number no firm has, and a message it cannot read', async () => {
    for (const address of ['/vapi/free-times', '/vapi/book'] as const) {
      const body = toolCall(address === '/vapi/book' ? 'book' : 'free-times', { start: '2026-10-01T15:00' }, { to: number, callId: callId() });
      expect((await sendTool(app, address, body, { Authorization: 'Bearer wrong' })).status).toBe(401);
      expect((await sendTool(app, address, body, {})).status).toBe(401);
      expect((await sendTool(app, address, toolCall('book', {}, { to: '+447700900999' }))).status).toBe(404);
      expect((await sendTool(app, address, { message: { type: 'tool-calls', toolCallList: [] } })).status).toBe(400);
      expect((await sendTool(app, address, report('supplier', number))).status).toBe(400);
    }
    expect(await listTakenTimes(db, firm, ...allTime)).toEqual([]);
  });
});

describe('whether a text will confirm the booking', () => {
  const MOBILE = '+447700900003';
  /** Firms of their own, by number, for the cases that need one set up another way. */
  const others = new Map<string, FirmId>();
  const firmOn = (to: string): FirmId => others.get(to) ?? firm;

  /** A tool call or report as it comes from this caller: a number, or none when it is withheld. */
  function fromCaller(body: Report, caller: string | null): Report {
    const copy = structuredClone(body);
    const customer = caller === null ? {} : { number: caller };
    copy.message.customer = customer;
    (copy.message.call as Record<string, unknown>).customer = customer;
    return copy;
  }

  async function bookFrom(caller: string | null, start: string, to: string, call: string, theApp = app): Promise<Record<string, unknown>> {
    return toolAnswer(await sendTool(theApp, '/vapi/book', fromCaller(toolCall('book', { start }, { to, callId: call }), caller)));
  }

  /** Another firm set up as Tidewell Heating is, on a number of its own. */
  async function anotherFirm(without: Parameters<typeof tidewell>[2] = []): Promise<{ to: string; own: FirmId }> {
    numbers += 1;
    const to = `+447700900${String(numbers)}`;
    const own = await tidewell(db, to, without);
    others.set(to, own);
    return { to, own };
  }

  /**
   * Books a time on a call from this caller, files the call as it ends, then
   * runs its confirmation: at once, and again at 8am the next morning in case
   * quiet hours held it. Gives what the agent was told, and whether a
   * confirmation went to the caller.
   */
  async function bookAndFile(
    caller: string | null,
    start = '2026-10-01T15:00',
    options: { to?: string; app?: typeof app; deps?: typeof deps } = {},
  ): Promise<{ text: unknown; sent: boolean }> {
    const to = options.to ?? number;
    const theApp = options.app ?? app;
    const theDeps = options.deps ?? deps;
    const call = callId(`text-${String(caller)}`);
    const answer = await bookFrom(caller, start, to, call, theApp);
    expect(answer).toMatchObject({ booked: true, start });
    const sentBefore = theDeps.texts.sent.length;
    clock.set(instant(clock.now() + 60_000));
    expect((await send(theApp, fromCaller(asAnotherCall(report('mrs-ahmed-booked', to), call), caller))).status).toBe(200);
    const [filed] = await listCallsBetween(db, firmOn(to), ...allTime);
    const visit = filed?.visit?.id;
    if (visit === undefined) throw new Error('No visit');
    const confirmation = (await listDueForVisit(db, firmOn(to), visit)).find((due) => due.action === 'send_confirmation');
    if (confirmation === undefined) throw new Error('No confirmation');
    await runDue(db, theDeps, firmOn(to), confirmation.id);
    const morning = instantFromIso('2026-09-29T08:00:00+01:00');
    if (clock.now() < morning) {
      clock.set(morning);
      await runDue(db, theDeps, firmOn(to), confirmation.id);
    }
    const sent = theDeps.texts.sent.slice(sentBefore).some((text) => caller === null || text.to === caller);
    return { text: answer.text, sent };
  }

  it('is promised to a caller on a mobile, and goes', async () => {
    expect(await bookAndFile(MOBILE)).toEqual({ text: true, sent: true });
  });

  it('is not promised to a caller on a landline, and none goes', async () => {
    expect(await bookAndFile('+441632960123')).toEqual({ text: false, sent: false });
  });

  it('is not promised to a caller whose number is withheld, and none goes', async () => {
    expect(await bookAndFile(null)).toEqual({ text: false, sent: false });
  });

  it('is not promised to a number that texted STOP, and none goes', async () => {
    await optOutNumber(db, firm, ukMobile(MOBILE));
    expect(await bookAndFile(MOBILE)).toEqual({ text: false, sent: false });
  });

  it('is not promised when the customer on the number asked for no texts, and none goes', async () => {
    const customer = await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile(MOBILE) });
    await optOut(db, firm, customer, 'every', { kind: 'customer' });
    expect(await bookAndFile(MOBILE)).toEqual({ text: false, sent: false });
  });

  it('is not promised when anyone on the number opted out of either confirmation: the safe side, since the caller is matched only as the call ends', async () => {
    for (const kind of ['visit_confirmation', 'visit_confirmation_first'] as const) {
      const { to, own } = await anotherFirm();
      const customer = await createCustomer(db, own, { name: 'Someone Else', mobile: ukMobile(MOBILE) });
      await optOut(db, own, customer, kind, { kind: 'customer' });
      expect(await bookFrom(MOBILE, '2026-10-01T15:00', to, callId(kind))).toMatchObject({ booked: true, text: false });
    }
  });

  it('is not promised while the stop button is on, and none goes', async () => {
    await setStopButton(db, firm, true, frontline);
    expect(await bookAndFile(MOBILE)).toEqual({ text: false, sent: false });
  });

  it('is not promised when either confirmation has no agreed wording', async () => {
    for (const without of ['visit_confirmation', 'visit_confirmation_first'] as const) {
      const { to } = await anotherFirm([without]);
      expect(await bookFrom(MOBILE, '2026-10-01T15:00', to, callId(without))).toMatchObject({ booked: true, text: false });
    }
  });

  it('is not promised to a new customer when the first text has no agreed wording, and none goes', async () => {
    const { to } = await anotherFirm(['visit_confirmation_first']);
    expect(await bookAndFile(MOBILE, '2026-10-01T15:00', { to })).toEqual({ text: false, sent: false });
  });

  it('is not promised while this copy has no address for customers’ links, and none goes', async () => {
    const noLinks = { ...testDeps(clock), linkAddress: null };
    expect(await bookAndFile(MOBILE, '2026-10-01T15:00', { app: createApp(() => noLinks), deps: noLinks })).toEqual({ text: false, sent: false });
  });

  it('is promised between 8pm and 8am, and goes at 8am', async () => {
    clock.set(instantFromIso('2026-09-28T21:00:00+01:00'));
    expect(await bookAndFile(MOBILE, '2026-09-30T15:00')).toEqual({ text: true, sent: true });
  });

  it('is not promised between 8pm and 8am for a visit that starts before 8am, and none goes', async () => {
    // A firm that starts at 7am and needs no notice on the next working day.
    await setDiaryRules(db, firm, { ...EXAMPLE_DIARY_RULES, opens: 7 * 60, nextDayFrom: 0 }, frontline);
    clock.set(instantFromIso('2026-09-28T21:00:00+01:00'));
    expect(await bookAndFile(MOBILE, '2026-09-29T07:00')).toEqual({ text: false, sent: false });
  });
});

describe('reading a tool call', () => {
  function callerOf(customer: unknown, callCustomer: unknown) {
    const body = toolCall('book', { start: '2026-10-01T15:00' });
    body.message.customer = customer;
    (body.message.call as Record<string, unknown>).customer = callCustomer;
    const read = readToolCalls(body);
    return read.kind === 'tool_calls' ? read.from : null;
  }

  it('reads the number the call came from, from the message or else from the call', () => {
    expect(callerOf({ number: '+447700900003' }, undefined)).toEqual({ kind: 'mobile', number: '+447700900003' });
    expect(callerOf(undefined, { number: '07700 900003' })).toEqual({ kind: 'mobile', number: '+447700900003' });
    expect(callerOf({ number: '+441632960123' }, undefined)).toEqual({ kind: 'landline', number: '+441632960123' });
    expect(callerOf({}, {})).toEqual({ kind: 'withheld' });
    expect(callerOf(undefined, undefined)).toEqual({ kind: 'withheld' });
    expect(callerOf({ number: 'anonymous' }, undefined)).toEqual({ kind: 'withheld' });
  });
});

describe('when the call ends', () => {
  it('files the held time as a visit on the job the call opened, with its confirmation and reminder', async () => {
    await book('2026-10-01T15:00');
    clock.set(instantFromIso('2026-09-28T11:15:12+01:00'));
    expect((await send(app, mrsAhmedsReport())).status).toBe(200);

    const [customer] = await listCustomers(db, firm);
    const [job] = await listJobs(db, firm);
    if (customer === undefined || job === undefined) throw new Error('Not filed');
    expect(customer).toMatchObject({ name: 'Mrs Ahmed', mobile: '+447700900003', address: '27 Station Road, ZZ1 4AB' });
    expect(job.place).toBe('27 Station Road, ZZ1 4AB');
    const [visit] = await listVisitsForJob(db, firm, job.id);
    expect(visit).toMatchObject({
      startsAt: instantFromIso('2026-10-01T15:00:00+01:00'),
      endsAt: instantFromIso('2026-10-01T16:00:00+01:00'),
      kind: 'quote_visit',
      state: 'booked',
    });
    if (visit === undefined) throw new Error('No visit');
    const [call] = await listCallsBetween(db, firm, ...allTime);
    expect(call).toMatchObject({ outcome: 'booked', visit: { id: visit.id }, customer: { id: customer.id }, job: job.id });

    expect((await historyForJob(db, firm, job.id)).map((entry) => historyLine(entry, 'job'))).toEqual([
      'Answered the call.',
      'Quote visit booked for Thursday, 3pm.',
    ]);
    expect(await listDueForVisit(db, firm, visit.id)).toMatchObject([
      { action: 'send_confirmation', runAt: clock.now(), latestAt: visit.startsAt, state: 'waiting' },
      {
        action: 'send_reminder',
        runAt: instantFromIso('2026-09-30T13:00:00+01:00'),
        latestAt: instantFromIso('2026-10-01T00:00:00+01:00'),
        state: 'waiting',
      },
      { action: 'tell_owner_booked', runAt: clock.now(), latestAt: visit.startsAt, state: 'waiting' },
    ]);
    // The time is the visit's now, not a hold's.
    expect(await listTakenTimes(db, firm, ...allTime)).toHaveLength(1);
    expect(await book('2026-10-01T15:00', callId('later'))).toEqual({ booked: false, why: 'taken' });
  });

  it('files nothing more when the same report comes again', async () => {
    await book('2026-10-01T15:00');
    await send(app, mrsAhmedsReport());
    await send(app, mrsAhmedsReport());
    const [job] = await listJobs(db, firm);
    expect(await listJobs(db, firm)).toHaveLength(1);
    if (job === undefined) throw new Error('No job');
    expect(await listVisitsForJob(db, firm, job.id)).toHaveLength(1);
  });

  it('writes no reminder for a visit booked after 1pm the day before', async () => {
    clock.set(instantFromIso('2026-09-30T13:30:00+01:00'));
    await book('2026-10-01T15:00');
    await send(app, mrsAhmedsReport());
    const [job] = await listJobs(db, firm);
    const [visit] = job === undefined ? [] : await listVisitsForJob(db, firm, job.id);
    if (visit === undefined) throw new Error('No visit');
    expect((await listDueForVisit(db, firm, visit.id)).map((due) => due.action)).toEqual(['send_confirmation', 'tell_owner_booked']);
  });

  it('lets the time go when the call turns out urgent, and files no visit', async () => {
    await book('2026-10-01T15:00');
    await send(app, withDetails(mrsAhmedsReport(), (data) => ({ ...data, urgentMatch: 'a leak' })));
    const [job] = await listJobs(db, firm);
    if (job === undefined) throw new Error('No job');
    expect(job.urgent).toBe(true);
    expect(await listVisitsForJob(db, firm, job.id)).toEqual([]);
    expect(await listTakenTimes(db, firm, ...allTime)).toEqual([]);
    const [call] = await listCallsBetween(db, firm, ...allTime);
    expect(call?.outcome).toBe('urgent');
  });

  it('lets the time go when the call’s details did not come through', async () => {
    await book('2026-10-01T15:00');
    await send(app, withDetails(mrsAhmedsReport(), (data) => ({ ...data, address: '' })));
    expect(await listJobs(db, firm)).toEqual([]);
    expect(await listTakenTimes(db, firm, ...allTime)).toEqual([]);
    const [call] = await listCallsBetween(db, firm, ...allTime);
    if (call === undefined) throw new Error('No call');
    expect((await getCall(db, firm, call.id))?.outcome).toBe('message');
  });

  it('files a returning customer’s booking on the new job their call opens', async () => {
    const mrsAhmed = await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
    await book('2026-10-01T15:00');
    await send(app, mrsAhmedsReport());
    const jobs = await listJobs(db, firm);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.customer).toBe(mrsAhmed);
    expect(await listVisitsForJob(db, firm, jobs[0]?.id ?? ('' as never))).toHaveLength(1);
  });

  it('does not file a hold of another firm’s on the same call id', async () => {
    const other = await tidewell(db, `+447700901${String(numbers)}`);
    await sendTool(app, '/vapi/book', toolCall('book', { start: '2026-10-01T15:00' }, { to: `+447700901${String(numbers)}`, callId: callId() }));
    expect((await send(app, mrsAhmedsReport())).status).toBe(200);
    const [job] = await listJobs(db, firm);
    if (job === undefined) throw new Error('The call was not filed');
    expect(await listVisitsForJob(db, firm, job.id)).toEqual([]);
    expect((await listCallsBetween(db, firm, ...allTime))[0]?.outcome).toBe('message');
    expect(await listTakenTimes(db, other, ...allTime)).toHaveLength(1);
  });
});

describe('the owner hears of a booking', () => {
  /** Books Thursday 1 October at 3pm on Mrs Ahmed's call, files it as the call ends, and gives the owner's row and the job. */
  async function bookedAndFiled(options: { app?: typeof app } = {}) {
    const theApp = options.app ?? app;
    await toolAnswer(await sendTool(theApp, '/vapi/book', toolCall('book', { start: '2026-10-01T15:00' }, { to: number, callId: callId() })));
    clock.set(instant(clock.now() + 60_000));
    expect((await send(theApp, mrsAhmedsReport())).status).toBe(200);
    const [job] = await listJobs(db, firm);
    const [visit] = job === undefined ? [] : await listVisitsForJob(db, firm, job.id);
    const row = visit === undefined ? undefined : (await listDueForVisit(db, firm, visit.id)).find((due) => due.action === 'tell_owner_booked');
    if (job === undefined || visit === undefined || row === undefined) throw new Error('Not booked');
    return { job, visit, row };
  }

  const textsTo = (mobile: string) => deps.texts.sent.filter((text) => text.to === mobile).map((text) => text.body);

  it('texts the owner what was booked, for whom, where, and a link to the job, in the words the owner agreed', async () => {
    const before = textsTo(TOMS_MOBILE).length;
    const { job, row } = await bookedAndFiled();
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(textsTo(TOMS_MOBILE).slice(before)).toEqual([
      `Front-line: Mrs Ahmed booked a quote visit for Thursday 1 October at 3pm, 27 Station Road, ZZ1 4AB. ${APP_ADDRESS}/jobs/${job.id}`,
    ]);
  });

  it('waits until 8am after a booking between 8pm and 8am, unlike an urgent alert', async () => {
    clock.set(instantFromIso('2026-09-28T20:30:00+01:00'));
    const before = textsTo(TOMS_MOBILE).length;
    const { visit, row } = await bookedAndFiled();
    await runDue(db, deps, firm, row.id);
    expect(textsTo(TOMS_MOBILE).slice(before)).toEqual([]);
    expect((await listDueForVisit(db, firm, visit.id)).find((due) => due.id === row.id)).toMatchObject({
      state: 'waiting',
      runAt: instantFromIso('2026-09-29T08:00:00+01:00'),
    });
    clock.set(instantFromIso('2026-09-29T08:00:00+01:00'));
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(textsTo(TOMS_MOBILE).slice(before)).toHaveLength(1);
  });

  it('goes while the stop button is on, which holds only texts to customers', async () => {
    const before = textsTo(TOMS_MOBILE).length;
    const { row } = await bookedAndFiled();
    await setStopButton(db, firm, true, frontline);
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(textsTo(TOMS_MOBILE).slice(before)).toHaveLength(1);
  });

  it('goes to every owner', async () => {
    await createOwner(db, firm, { name: 'Sam', mobile: ukMobile('07700 900111') });
    const { row } = await bookedAndFiled();
    await runDue(db, deps, firm, row.id);
    expect(textsTo(TOMS_MOBILE).at(-1)).toMatch(/^Front-line: Mrs Ahmed booked a quote visit/);
    expect(textsTo('+447700900111')).toHaveLength(1);
  });

  it('goes without its link while this copy has no address for the app', async () => {
    const noApp = { ...testDeps(clock), appAddress: null };
    const { row } = await bookedAndFiled({ app: createApp(() => noApp) });
    expect(await runDue(db, noApp, firm, row.id)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(noApp.texts.sent.map((text) => text.body)).toContain('Front-line: Mrs Ahmed booked a quote visit for Thursday 1 October at 3pm, 27 Station Road, ZZ1 4AB.');
  });

  it('does not go without wording the owner agreed for it', async () => {
    numbers += 1;
    number = `+447700900${String(numbers)}`;
    firm = await tidewell(db, number, ['visit_booked']);
    const before = textsTo(TOMS_MOBILE).length;
    const { row } = await bookedAndFiled();
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'not_sent' });
    expect(textsTo(TOMS_MOBILE).slice(before)).toEqual([]);
    expect((await listMessagesBetween(db, firm, ...allTime)).filter((text) => text.kind === 'visit_booked')).toMatchObject([{ state: 'not_sent', reason: 'no_wording' }]);
  });

  it('does not go once the visit is cancelled', async () => {
    const before = textsTo(TOMS_MOBILE).length;
    const { visit, row } = await bookedAndFiled();
    clock.set(instantFromIso('2026-09-28T20:30:00+01:00'));
    await runDue(db, deps, firm, row.id);
    expect(await ownDiary(db).cancel(firm, visit.id, frontline)).toBe(true);
    clock.set(instantFromIso('2026-09-29T08:00:00+01:00'));
    await runDue(db, deps, firm, row.id);
    expect(textsTo(TOMS_MOBILE).slice(before)).toEqual([]);
    expect((await listDueForVisit(db, firm, visit.id)).find((due) => due.id === row.id)?.state).toBe('cancelled');
  });
});

describe('moving and cancelling a visit', () => {
  async function bookedVisit() {
    await book('2026-10-01T15:00');
    await send(app, mrsAhmedsReport());
    const [job] = await listJobs(db, firm);
    const [visit] = job === undefined ? [] : await listVisitsForJob(db, firm, job.id);
    if (job === undefined || visit === undefined) throw new Error('No visit');
    return { job, visit };
  }

  it('moves it, cancelling its reminder and writing one for the new day, and keeping its confirmation', async () => {
    const { job, visit } = await bookedVisit();
    expect(await ownDiary(db).move(firm, visit.id, instantFromIso('2026-10-05T10:00:00+01:00'), frontline)).toBe('moved');
    const dues = await listDueForVisit(db, firm, visit.id);
    expect(dues.map((due) => [due.action, due.state])).toEqual([
      ['send_confirmation', 'waiting'],
      ['send_reminder', 'cancelled'],
      ['tell_owner_booked', 'waiting'],
      ['send_reminder', 'waiting'],
    ]);
    // The confirmation and the owner's text, still waiting, may go until the new start.
    expect(dues[0]?.latestAt).toBe(instantFromIso('2026-10-05T10:00:00+01:00'));
    expect(dues[2]?.latestAt).toBe(instantFromIso('2026-10-05T10:00:00+01:00'));
    expect(dues[3]).toMatchObject({ runAt: instantFromIso('2026-10-04T13:00:00+01:00'), latestAt: instantFromIso('2026-10-05T00:00:00+01:00') });
    expect((await listVisitsForJob(db, firm, job.id))[0]).toMatchObject({
      startsAt: instantFromIso('2026-10-05T10:00:00+01:00'),
      endsAt: instantFromIso('2026-10-05T11:00:00+01:00'),
    });
    expect((await historyForJob(db, firm, job.id)).map((entry) => historyLine(entry, 'job')).at(-1)).toBe('Quote visit moved to Monday 5 October, 10am.');
  });

  it('refuses a time that is taken or not offered, or the time it already has, and changes nothing', async () => {
    const { job, visit } = await bookedVisit();
    await book('2026-10-05T10:00', callId('other'));
    const diary = ownDiary(db);
    expect(await diary.move(firm, visit.id, instantFromIso('2026-10-05T10:00:00+01:00'), frontline)).toBe('taken');
    expect(await diary.move(firm, visit.id, instantFromIso('2026-10-03T10:00:00+01:00'), frontline)).toBe('not_offered');
    expect(await diary.move(firm, visit.id, visit.startsAt, frontline)).toBe('not_offered');
    expect((await listDueForVisit(db, firm, visit.id)).map((due) => due.state)).toEqual(['waiting', 'waiting', 'waiting']);
    expect((await historyForJob(db, firm, job.id)).map((entry) => entry.kind)).not.toContain('visit_moved');
  });

  it('cancels it, with every row still waiting, once', async () => {
    const { job, visit } = await bookedVisit();
    const diary = ownDiary(db);
    expect(await diary.cancel(firm, visit.id, frontline)).toBe(true);
    expect(await diary.cancel(firm, visit.id, frontline)).toBe(false);
    expect((await listDueForVisit(db, firm, visit.id)).map((due) => due.state)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect((await historyForJob(db, firm, job.id)).map((entry) => historyLine(entry, 'job')).at(-1)).toBe('Quote visit cancelled.');
    expect(await listTakenTimes(db, firm, ...allTime)).toEqual([]);
    expect(await diary.move(firm, visit.id, instantFromIso('2026-10-05T10:00:00+01:00'), frontline)).toBe('not_booked');
  });
});

describe('the firm’s rules for its diary', () => {
  it.each([
    ['no days', { ...EXAMPLE_DIARY_RULES, days: [] }],
    ['a day that is not one', { ...EXAMPLE_DIARY_RULES, days: [7] }],
    ['closing before opening', { ...EXAMPLE_DIARY_RULES, opens: 960, closes: 480 }],
    ['a visit longer than the day', { ...EXAMPLE_DIARY_RULES, lengths: { quote_visit: 600 } }],
    ['a kind of visit that is not one', { ...EXAMPLE_DIARY_RULES, lengths: { survey: 60 } }],
    ['no days ahead', { ...EXAMPLE_DIARY_RULES, daysAhead: 0 }],
    ['a notice that is not a time of day', { ...EXAMPLE_DIARY_RULES, nextDayFrom: 25 * 60 }],
    ['a notice that is not a number', { ...EXAMPLE_DIARY_RULES, nextDayFrom: 'noon' }],
  ])('refuses rules with %s', async (_, rules) => {
    await expect(setDiaryRules(db, firm, rules as typeof EXAMPLE_DIARY_RULES, frontline)).rejects.toThrow(Refused);
  });

  it('keeps the firm’s own notice, and gives none back when it set none, which means noon', async () => {
    await setDiaryRules(db, firm, { ...EXAMPLE_DIARY_RULES, nextDayFrom: 9 * 60 }, frontline);
    expect((await getFirm(db, firm))?.diaryRules?.nextDayFrom).toBe(9 * 60);
    await setDiaryRules(db, firm, EXAMPLE_DIARY_RULES, frontline);
    expect((await getFirm(db, firm))?.diaryRules).toEqual(EXAMPLE_DIARY_RULES);
  });
});

describe('the notice, the weekend and the clocks, through the agent’s tools', () => {
  const MIDDAY_MONDAY = ['Monday 5 October at midday', 'Tuesday 6 October at 8am', 'Wednesday 7 October at 8am'];

  it.each([
    // When the call is (UK time), what is offered with no day named, a time refused, and the first time that books.
    ['a weekday, late in the evening', '2026-09-29T22:45:00+01:00', ['Wednesday 30 September at midday', 'Thursday 1 October at 8am', 'Friday 2 October at 8am'], '2026-09-30T11:00', '2026-09-30T12:00'],
    ['a Friday morning', '2026-10-02T09:00:00+01:00', MIDDAY_MONDAY, '2026-10-05T11:00', '2026-10-05T12:00'],
    ['a Friday, for the Saturday', '2026-10-02T09:00:00+01:00', MIDDAY_MONDAY, '2026-10-03T12:00', '2026-10-05T12:00'],
    ['a Saturday', '2026-10-03T10:00:00+01:00', MIDDAY_MONDAY, '2026-10-05T08:00', '2026-10-05T12:00'],
    ['a Sunday evening', '2026-10-04T21:00:00+01:00', MIDDAY_MONDAY, '2026-10-05T11:00', '2026-10-05T12:00'],
  ])('offers and books nothing before noon on the next working day, on %s', async (_, now, offered, refused, first) => {
    clock.set(instantFromIso(now));
    expect((await freeTimes()).map((time) => time.say)).toEqual(offered);
    expect(await book(refused)).toEqual({ booked: false, why: 'not_offered' });
    expect(await book(first)).toMatchObject({ booked: true, start: first });
  });

  it('offers UK times either side of the clocks going back on Sunday 25 October 2026, and keeps each visit at its right instant', async () => {
    clock.set(instantFromIso('2026-10-21T10:00:00+01:00'));
    expect(await freeTimes({ day: '2026-10-23' }, callId('friday'))).toEqual([
      { start: '2026-10-23T08:00', say: 'Friday 23 October at 8am' },
      { start: '2026-10-23T12:00', say: 'Friday 23 October at midday' },
      { start: '2026-10-23T15:00', say: 'Friday 23 October at 3pm' },
    ]);
    expect(await freeTimes({ day: '2026-10-26' }, callId('monday'))).toEqual([
      { start: '2026-10-26T08:00', say: 'Monday 26 October at 8am' },
      { start: '2026-10-26T12:00', say: 'Monday 26 October at midday' },
      { start: '2026-10-26T15:00', say: 'Monday 26 October at 3pm' },
    ]);
    expect(await book('2026-10-23T08:00', callId('friday'))).toMatchObject({ booked: true });
    expect(await book('2026-10-26T08:00', callId('monday'))).toMatchObject({ booked: true });
    for (const call of [callId('friday'), callId('monday')]) {
      clock.set(instant(clock.now() + 60_000));
      expect((await send(app, mrsAhmedsReport(call))).status).toBe(200);
    }

    const visits = [];
    for (const job of await listJobs(db, firm)) visits.push(...(await listVisitsForJob(db, firm, job.id)));
    visits.sort((one, other) => one.startsAt - other.startsAt);
    const [friday, monday] = visits;
    if (friday === undefined || monday === undefined) throw new Error('Not filed');
    // 8am on Friday 23 October is 7am UTC (summer time); 8am on Monday 26 October is 8am UTC.
    expect(friday.startsAt).toBe(instantFromIso('2026-10-23T07:00:00Z'));
    expect(monday.startsAt).toBe(instantFromIso('2026-10-26T08:00:00Z'));
    const reminder = async (visit: typeof friday) => (await listDueForVisit(db, firm, visit.id)).find((due) => due.action === 'send_reminder');
    // Each reminder at 1pm UK time the day before, until midnight UK time.
    expect(await reminder(friday)).toMatchObject({ runAt: instantFromIso('2026-10-22T12:00:00Z'), latestAt: instantFromIso('2026-10-22T23:00:00Z') });
    expect(await reminder(monday)).toMatchObject({ runAt: instantFromIso('2026-10-25T13:00:00Z'), latestAt: instantFromIso('2026-10-26T00:00:00Z') });
  });
});

describe('the owner’s booking text either side of quiet hours', () => {
  /** Books a time on Mrs Ahmed's call at this UK time, files the call, and gives the owner's row. */
  async function bookedAt(now: string, start: string) {
    clock.set(instantFromIso(now));
    expect(await book(start)).toMatchObject({ booked: true });
    expect((await send(app, mrsAhmedsReport())).status).toBe(200);
    const [job] = await listJobs(db, firm);
    const [visit] = job === undefined ? [] : await listVisitsForJob(db, firm, job.id);
    const row = visit === undefined ? undefined : (await listDueForVisit(db, firm, visit.id)).find((due) => due.action === 'tell_owner_booked');
    if (visit === undefined || row === undefined) throw new Error('Not booked');
    return { visit, row };
  }

  const textsToTom = () => deps.texts.sent.filter((text) => text.to === TOMS_MOBILE).map((text) => text.body);
  const waiting = async (visit: { id: Parameters<typeof listDueForVisit>[2] }, row: { id: string }) =>
    (await listDueForVisit(db, firm, visit.id)).find((due) => due.id === row.id);

  it('goes at once at 7:59pm', async () => {
    const before = textsToTom().length;
    const { row } = await bookedAt('2026-09-28T19:59:00+01:00', '2026-10-01T15:00');
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(textsToTom().slice(before)).toHaveLength(1);
  });

  it('waits from 8pm, and still at 7:59am, then goes at 8am', async () => {
    const before = textsToTom().length;
    const { visit, row } = await bookedAt('2026-09-28T20:00:00+01:00', '2026-10-01T15:00');
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'held' });
    expect(await waiting(visit, row)).toMatchObject({ state: 'waiting', runAt: instantFromIso('2026-09-29T08:00:00+01:00') });
    clock.set(instantFromIso('2026-09-29T07:59:00+01:00'));
    await runDue(db, deps, firm, row.id);
    expect(textsToTom().slice(before)).toEqual([]);
    clock.set(instantFromIso('2026-09-29T08:00:00+01:00'));
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(textsToTom().slice(before)).toHaveLength(1);
  });

  it('waits on the night the clocks go back until 8am UK time, which is 8am UTC', async () => {
    const before = textsToTom().length;
    const { visit, row } = await bookedAt('2026-10-24T23:30:00+01:00', '2026-10-26T12:00');
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'held' });
    expect(await waiting(visit, row)).toMatchObject({ state: 'waiting', runAt: instantFromIso('2026-10-25T08:00:00Z') });
    clock.set(instantFromIso('2026-10-25T08:00:00Z'));
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(textsToTom().slice(before)).toEqual([expect.stringMatching(/^Front-line: Mrs Ahmed booked a quote visit for Monday 26 October at midday, /)]);
  });
});

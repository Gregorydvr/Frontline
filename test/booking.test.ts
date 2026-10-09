// Booking during a call (slice E). The voice agent asks for free times and
// books one through the two addresses it calls during a call, as Vapi sends
// them (test/fixtures/vapi/free-times.json and book.json). The time is held
// under the call's id, and filed as a visit on the call's job when the
// report comes as the call ends.

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { ownDiary } from '../src/diary/own';
import {
  createCustomer,
  createJob,
  createVisit,
  getCall,
  historyForJob,
  listCallsBetween,
  listCustomers,
  listDueForVisit,
  listJobs,
  listTakenTimes,
  listVisitsForJob,
  setDiaryRules,
  setService,
} from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import { HOLD_LASTS } from '../src/record/holds';
import type { FirmId } from '../src/record/types';
import { EXAMPLE_DIARY_RULES } from '../src/example/tidewell';
import { ukMobile } from '../src/phone';
import { historyLine } from '../src/history-lines';
import { testDeps } from './helpers/deps';
import { asAnotherCall, report, send, sendTool, tidewell, toolAnswer, toolCall, withDetails, type Report } from './helpers/vapi';

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
  it('offers the first three from the day asked about: on the hour, from 8am', async () => {
    expect(await freeTimes({ day: '2026-10-01' })).toEqual([
      { start: '2026-10-01T08:00', say: 'Thursday 1 October at 8am' },
      { start: '2026-10-01T09:00', say: 'Thursday 1 October at 9am' },
      { start: '2026-10-01T10:00', say: 'Thursday 1 October at 10am' },
    ]);
  });

  it('offers nothing today, and nothing at the weekend: from Friday evening, Monday at 8am', async () => {
    clock.set(instantFromIso('2026-10-02T17:00:00+01:00'));
    expect((await freeTimes())[0]).toEqual({ start: '2026-10-05T08:00', say: 'Monday 5 October at 8am' });
    clock.set(instantFromIso('2026-09-29T07:00:00+01:00'));
    expect((await freeTimes({ day: '2026-09-29' }))[0]?.start).toBe('2026-09-30T08:00');
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
      '2026-10-01T11:00',
      '2026-10-01T12:00',
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
    expect((await freeTimes({ day: 'Thursday' }))[0]?.start).toBe('2026-09-29T08:00');
    expect((await freeTimes({ day: '2026-09-31' }))[0]?.start).toBe('2026-09-29T08:00');
  });
});

describe('booking a time', () => {
  it('holds it for the call, and booking twice with the same details holds it once', async () => {
    expect(await book('2026-10-01T15:00')).toEqual({ booked: true, start: '2026-10-01T15:00', say: 'Thursday 1 October at 3pm' });
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

describe('when the call ends', () => {
  it('files the held time as a visit on the job the call opened, with its confirmation and reminder', async () => {
    await book('2026-10-01T15:00');
    clock.set(instantFromIso('2026-09-28T11:15:12+01:00'));
    expect((await send(app, mrsAhmedsReport())).status).toBe(200);

    const [customer] = await listCustomers(db, firm);
    const [job] = await listJobs(db, firm);
    if (customer === undefined || job === undefined) throw new Error('Not filed');
    expect(customer).toMatchObject({ name: 'Mrs Ahmed', mobile: '+447700900003', address: '27 Station Road' });
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
    expect((await listDueForVisit(db, firm, visit.id)).map((due) => due.action)).toEqual(['send_confirmation']);
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
      ['send_reminder', 'waiting'],
    ]);
    expect(dues[0]?.latestAt).toBe(instantFromIso('2026-10-05T10:00:00+01:00'));
    expect(dues[2]).toMatchObject({ runAt: instantFromIso('2026-10-04T13:00:00+01:00'), latestAt: instantFromIso('2026-10-05T00:00:00+01:00') });
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
    expect((await listDueForVisit(db, firm, visit.id)).map((due) => due.state)).toEqual(['waiting', 'waiting']);
    expect((await historyForJob(db, firm, job.id)).map((entry) => entry.kind)).not.toContain('visit_moved');
  });

  it('cancels it, with every row still waiting, once', async () => {
    const { job, visit } = await bookedVisit();
    const diary = ownDiary(db);
    expect(await diary.cancel(firm, visit.id, frontline)).toBe(true);
    expect(await diary.cancel(firm, visit.id, frontline)).toBe(false);
    expect((await listDueForVisit(db, firm, visit.id)).map((due) => due.state)).toEqual(['cancelled', 'cancelled']);
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
  ])('refuses rules with %s', async (_, rules) => {
    await expect(setDiaryRules(db, firm, rules as typeof EXAMPLE_DIARY_RULES, frontline)).rejects.toThrow(Refused);
  });
});

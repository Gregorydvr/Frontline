// Steps 1 to 4, 7 and 8 of the acceptance story (section 7 of
// docs/build-brief.md), through the real addresses, as Vapi sends to them,
// with a pretend clock and the stand-in for texts. The clock's minute is
// played by everyMinute(), and the queue's worker by runDue().

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock, type Instant } from '../src/clock';
import { everyMinute, runDue } from '../src/due';
import { historyLine } from '../src/history-lines';
import {
  historyForJob,
  listCustomers,
  listDueForVisit,
  listJobsForCustomer,
  listMessagesBetween,
  listVisitsForJob,
  setStopButton,
} from '../src/record';
import { openRecord } from '../src/record/db';
import type { Customer, FirmId, Job, Visit } from '../src/record/types';
import { LINK_ADDRESS, testDeps } from './helpers/deps';
import { asAnotherCall, report, send, sendTool, tidewell, toolAnswer, toolCall, withDetails, type Report } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-09-28T11:14:00+01:00'));
const deps = testDeps(clock);
// With the file stores, as the queue's worker has them, since the daily
// sweep comes due as the story's days go by.
const db = openRecord(env.DB, clock, deps.files);
const app = createApp(() => deps);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const frontline = { kind: 'frontline' } as const;

/** The clock's minute at `at`: the rows due for this firm go on the queue, and the worker runs each. */
async function minute(firm: FirmId, at: Instant): Promise<void> {
  clock.set(at);
  const before = deps.queue.bodies.length;
  await everyMinute(env.DB, deps);
  for (const body of deps.queue.bodies.slice(before)) {
    if (body.firm === firm) {
      await runDue(db, deps, body.firm, body.due);
    }
  }
}

/** The texts the stand-in took to one number, in order. */
function textsTo(number: string): string[] {
  return deps.texts.sent.filter((text) => text.to === number).map((text) => text.body);
}

interface Caller {
  name: string;
  mobile: string;
  about: string;
  address: string;
  summary: string;
}

/**
 * A call to the firm's number that books a quote visit: the agent asks for
 * free times on the day, books `start`, and the report comes as the call
 * ends, a minute later.
 */
async function bookingCall(firmNumber: string, caller: Caller, callId: string, at: Instant, start: string): Promise<Record<string, unknown>> {
  clock.set(at);
  const day = start.slice(0, 10);
  const times = await toolAnswer(await sendTool(app, '/vapi/free-times', toolCall('free-times', { day }, { to: firmNumber, callId })));
  // The caller hears the first free times that day, and asks for a later one.
  expect((times.times as { start: string }[])[0]?.start.slice(0, 10)).toBe(day);
  const booked = await toolAnswer(await sendTool(app, '/vapi/book', toolCall('book', { start }, { to: firmNumber, callId })));
  clock.set((at + 60_000) as Instant);
  const body: Report = withDetails(asAnotherCall(report('mrs-ahmed-booked', firmNumber), callId), (data) => ({
    ...data,
    name: caller.name,
    about: caller.about,
    address: caller.address,
    summary: caller.summary,
  }));
  body.message.customer = { number: caller.mobile };
  body.message.startedAt = new Date(at).toISOString();
  body.message.endedAt = new Date(at + 60_000).toISOString();
  expect((await send(app, body)).status).toBe(200);
  return booked;
}

async function filed(firm: FirmId, name: string): Promise<{ customer: Customer; job: Job; visit: Visit }> {
  const customer = (await listCustomers(db, firm)).find((one) => one.name === name);
  const [job] = customer === undefined ? [] : await listJobsForCustomer(db, firm, customer.id);
  const [visit] = job === undefined ? [] : await listVisitsForJob(db, firm, job.id);
  if (customer === undefined || job === undefined || visit === undefined) throw new Error(`${name} has no visit`);
  return { customer, job, visit };
}

const MRS_AHMED: Caller = {
  name: 'Mrs Ahmed',
  mobile: '+447700900003',
  about: 'Boiler replacement',
  address: '27 Station Road',
  summary: 'The boiler keeps cutting out.',
};
const MRS_GREEN: Caller = {
  name: 'Mrs Green',
  mobile: '+447700900015',
  about: 'No hot water',
  address: '24 Beech Avenue',
  summary: 'No hot water since last night.',
};

describe('the acceptance story, steps 1 to 4', () => {
  const number = '+447700900100';
  let firm: FirmId;

  it('1. Monday 28 September, 11:15: Mrs Ahmed’s call ends with a quote visit booked for Thursday 1 October at 3pm', async () => {
    firm = await tidewell(db, number);
    const booked = await bookingCall(number, MRS_AHMED, 'ahmed-28-sep', instantFromIso('2026-09-28T11:14:00+01:00'), '2026-10-01T15:00');
    expect(booked).toEqual({ booked: true, start: '2026-10-01T15:00', say: 'Thursday 1 October at 3pm' });

    expect(await listCustomers(db, firm)).toHaveLength(1);
    const { customer, job, visit } = await filed(firm, 'Mrs Ahmed');
    expect(await listJobsForCustomer(db, firm, customer.id)).toHaveLength(1);
    expect(await listVisitsForJob(db, firm, job.id)).toHaveLength(1);
    expect(visit).toMatchObject({ startsAt: instantFromIso('2026-10-01T15:00:00+01:00'), kind: 'quote_visit', state: 'booked' });
    expect((await historyForJob(db, firm, job.id)).map((entry) => entry.kind)).toEqual(['call_answered', 'visit_booked']);
    // Her details taken is on the customer, not shown to the owner.
    expect((await historyForJob(db, firm, job.id)).map((entry) => historyLine(entry, 'feed'))).toEqual([
      'Call from Mrs Ahmed answered.',
      'Booked Mrs Ahmed’s quote visit for Thursday, 3pm.',
    ]);
  });

  it('2. 11:16: the confirmation goes to her, once, as her first text, with her link and how to opt out', async () => {
    await minute(firm, instantFromIso('2026-09-28T11:16:00+01:00'));
    const texts = textsTo(MRS_AHMED.mobile);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(
      new RegExp(
        "^Hi Mrs Ahmed, it's Tidewell Heating\\. Tom will be with you on Thursday 1 October at 3pm to look at the job and price it\\. " +
          'Need to change it\\? Just reply here\\. Check your details: https://links\\.example/d/[0-9a-z]{26} Reply STOP to stop these texts\\.$',
      ),
    );
    expect(LINK_ADDRESS).toBe('https://links.example');
    const { job } = await filed(firm, 'Mrs Ahmed');
    const entries = await historyForJob(db, firm, job.id);
    expect(entries.at(-1)).toMatchObject({ kind: 'confirmation_sent', at: instantFromIso('2026-09-28T11:16:00+01:00') });

    await minute(firm, instantFromIso('2026-09-28T11:17:00+01:00'));
    await minute(firm, instantFromIso('2026-09-28T11:30:00+01:00'));
    expect(textsTo(MRS_AHMED.mobile)).toHaveLength(1);
  });

  it('3. Wednesday 30 September, 13:00: the reminder goes to her once, even with the worker run twice at once', async () => {
    await minute(firm, instantFromIso('2026-09-30T12:59:00+01:00'));
    expect(textsTo(MRS_AHMED.mobile)).toHaveLength(1);

    clock.set(instantFromIso('2026-09-30T13:00:00+01:00'));
    const before = deps.queue.bodies.length;
    await everyMinute(env.DB, deps);
    const rows = deps.queue.bodies.slice(before).filter((body) => body.firm === firm);
    expect(rows).toHaveLength(1);
    await Promise.all(rows.flatMap((row) => [runDue(db, deps, firm, row.due), runDue(db, deps, firm, row.due)]));
    await minute(firm, instantFromIso('2026-09-30T13:00:30+01:00'));

    const texts = textsTo(MRS_AHMED.mobile);
    expect(texts).toEqual([texts[0], "Reminder: Tom's visit is tomorrow, Thursday, at 3pm. See you then."]);
  });

  it('4. Thursday 15 October, 08:10: Mrs Green books Monday 19 October at 9am; her confirmation goes at 08:11, her reminder Sunday at 13:00', async () => {
    await bookingCall(number, MRS_GREEN, 'green-15-oct', instantFromIso('2026-10-15T08:09:00+01:00'), '2026-10-19T09:00');
    const { visit } = await filed(firm, 'Mrs Green');
    const reminder = (await listDueForVisit(db, firm, visit.id)).find((due) => due.action === 'send_reminder');
    // 13:00 UK time, still summer time: 12:00 UTC.
    expect(reminder?.runAt).toBe(instantFromIso('2026-10-18T12:00:00Z'));

    await minute(firm, instantFromIso('2026-10-15T08:11:00+01:00'));
    expect(textsTo(MRS_GREEN.mobile)).toEqual([
      expect.stringMatching(/^Hi Mrs Green, it's Tidewell Heating\. Tom will be with you on Monday 19 October at 9am to look at the job and price it\./),
    ]);
    expect(textsTo(MRS_GREEN.mobile)[0]).toContain('Check your details: https://links.example/d/');

    await minute(firm, instantFromIso('2026-10-18T12:59:00+01:00'));
    expect(textsTo(MRS_GREEN.mobile)).toHaveLength(1);
    await minute(firm, instantFromIso('2026-10-18T13:00:00+01:00'));
    expect(textsTo(MRS_GREEN.mobile)[1]).toBe("Reminder: Tom's visit is tomorrow, Monday, at 9am. See you then.");
  });

  it('a later confirmation to the same customer carries no link', async () => {
    await bookingCall(number, MRS_AHMED, 'ahmed-20-oct', instantFromIso('2026-10-20T10:00:00+01:00'), '2026-10-22T11:00');
    await minute(firm, instantFromIso('2026-10-20T10:02:00+01:00'));
    const last = textsTo(MRS_AHMED.mobile).at(-1);
    expect(last).toBe("Hi Mrs Ahmed, it's Tidewell Heating. Tom will be with you on Thursday 22 October at 11am to look at the job and price it. Need to change it? Just reply here.");
  });
});

describe('the acceptance story, step 7: the clocks', () => {
  const number = '+447700900107';

  it('reminds on Sunday 25 October at 13:00 UK time, which is 13:00 UTC, for a visit on Monday 26 October at 9am', async () => {
    const firm = await tidewell(db, number);
    const caller = { ...MRS_GREEN, name: 'Mr Hughes', mobile: '+447700900002' };
    await bookingCall(number, caller, 'hughes-20-oct', instantFromIso('2026-10-20T10:00:00+01:00'), '2026-10-26T09:00');
    const { visit } = await filed(firm, 'Mr Hughes');
    const reminder = (await listDueForVisit(db, firm, visit.id)).find((due) => due.action === 'send_reminder');
    expect(reminder?.runAt).toBe(instantFromIso('2026-10-25T13:00:00Z'));

    await minute(firm, instantFromIso('2026-10-25T12:59:00Z'));
    expect(textsTo(caller.mobile)).toHaveLength(1);
    await minute(firm, instantFromIso('2026-10-25T13:00:00Z'));
    expect(textsTo(caller.mobile).at(-1)).toBe("Reminder: Tom's visit is tomorrow, Monday, at 9am. See you then.");
  });

  it('reminds on Sunday 28 March 2027 at 13:00 UK time, which is 12:00 UTC, for a visit the day after the clocks go forward', async () => {
    const firm = await tidewell(db, '+447700900108');
    const caller = { ...MRS_GREEN, name: 'Mr Evans', mobile: '+447700900004' };
    await bookingCall('+447700900108', caller, 'evans-22-mar', instantFromIso('2027-03-22T10:00:00Z'), '2027-03-29T09:00');
    const { visit } = await filed(firm, 'Mr Evans');
    expect(visit.startsAt).toBe(instantFromIso('2027-03-29T08:00:00Z'));
    const reminder = (await listDueForVisit(db, firm, visit.id)).find((due) => due.action === 'send_reminder');
    expect(reminder?.runAt).toBe(instantFromIso('2027-03-28T12:00:00Z'));

    await minute(firm, instantFromIso('2027-03-28T12:00:00Z'));
    expect(textsTo(caller.mobile).at(-1)).toBe("Reminder: Tom's visit is tomorrow, Monday, at 9am. See you then.");
  });
});

describe('the acceptance story, step 8: the stop button', () => {
  const number = '+447700900109';

  it('holds both texts while it is on, and once it is off after Thursday 1 October, skips both and records it', async () => {
    const firm = await tidewell(db, number);
    const caller = { ...MRS_AHMED, mobile: '+447700900030' };
    await bookingCall(number, caller, 'ahmed-stopped', instantFromIso('2026-09-28T11:14:00+01:00'), '2026-10-01T15:00');
    await setStopButton(db, firm, true, frontline);

    await minute(firm, instantFromIso('2026-09-28T11:16:00+01:00'));
    await minute(firm, instantFromIso('2026-09-30T13:00:00+01:00'));
    await minute(firm, instantFromIso('2026-10-01T14:00:00+01:00'));
    expect(textsTo(caller.mobile)).toEqual([]);

    clock.set(instantFromIso('2026-10-02T09:00:00+01:00'));
    await setStopButton(db, firm, false, frontline);
    await minute(firm, instantFromIso('2026-10-02T09:00:00+01:00'));
    await minute(firm, instantFromIso('2026-10-02T09:10:00+01:00'));
    expect(textsTo(caller.mobile)).toEqual([]);

    const { visit } = await filed(firm, 'Mrs Ahmed');
    expect((await listDueForVisit(db, firm, visit.id)).map((due) => [due.action, due.state, due.outcome])).toEqual([
      ['send_confirmation', 'skipped', 'too_late'],
      ['send_reminder', 'skipped', 'too_late'],
    ]);
    expect(await listMessagesBetween(db, firm, ...allTime)).toEqual([]);
  });
});

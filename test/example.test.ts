import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { ensureExample, loadExample } from '../src/example/load';
import { CUSTOMERS, EXAMPLE_NOW } from '../src/example/tidewell';
import { historyLine } from '../src/history-lines';
import { jobState } from '../src/job-state';
import { clock24, inLondon } from '../src/london';
import {
  exampleFirms,
  getFirm,
  historyBetween,
  historyForJob,
  listCallsBetween,
  listCustomers,
  listJobs,
  listOwners,
  listVisitsForJob,
} from '../src/record';
import { openRecord } from '../src/record/db';
import type { Customer, FirmId, Job } from '../src/record/types';
import { historyKinds } from './helpers/db';

const now = instantFromIso(EXAMPLE_NOW);
const db = openRecord(env.DB, pretendClock(now));

let firm: FirmId;
let customers: Customer[];
let jobs: Job[];

beforeAll(async () => {
  firm = await ensureExample(env.DB);
  customers = await listCustomers(db, firm);
  jobs = await listJobs(db, firm);
});

function jobOf(name: string): Job {
  const customer = customers.find((one) => one.name === name);
  const job = jobs.find((one) => one.customer === customer?.id);
  if (job === undefined) throw new Error(`No job for ${name}`);
  return job;
}

async function jobPage(name: string): Promise<string[]> {
  const entries = await historyForJob(db, firm, jobOf(name).id);
  return entries.flatMap((entry) => {
    const line = historyLine(entry, 'job');
    const { day, month, hour, minute } = inLondon(entry.at);
    const when = `${String(day)}/${String(month)} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return line === null ? [] : [`${when} ${line}`];
  });
}

describe('the demo firm', () => {
  it('is Tidewell Heating, marked as an example, with owner Tom and all five services on', async () => {
    expect(await exampleFirms(db)).toEqual([firm]);
    const tidewell = await getFirm(db, firm);
    expect(tidewell).toMatchObject({
      name: 'Tidewell Heating',
      isExample: true,
      stopped: false,
      services: { calls: true, quotes: true, followups: true, paperwork: true, invoices: true },
      phoneNumber: '+447700900100',
      urgentList: ['a leak'],
    });
    expect((await listOwners(db, firm)).map((owner) => owner.name)).toEqual(['Tom']);
  });

  it('holds the example’s eight calls, each with what came of it', async () => {
    const calls = await listCallsBetween(
      db,
      firm,
      instantFromIso('2026-09-01T00:00:00+01:00'),
      instantFromIso('2026-10-16T00:00:00+01:00'),
    );
    expect(
      calls.map((call) => [
        clock24(call.startedAt),
        call.customer?.name ?? call.caller,
        call.outcome,
        call.visit?.kind ?? call.urgentItem,
        call.summary,
      ]),
    ).toEqual([
      ['08:50', 'Mr Khan', 'booked', 'quote_visit', null],
      ['11:15', 'Mrs Ahmed', 'booked', 'quote_visit', 'The boiler keeps cutting out.'],
      ['10:40', 'Mr Hughes', 'booked', 'quote_visit', null],
      ['09:30', 'Mr Evans', 'booked', 'quote_visit', null],
      ['09:12', 'Mrs Patel', 'booked', 'quote_visit', 'The old boiler is leaking.'],
      ['08:10', 'Mrs Green', 'booked', 'quote_visit', 'No hot water.'],
      ['08:26', 'a supplier', 'message', null, 'Your order is ready to collect.'],
      ['11:02', 'Mr Price', 'urgent', 'a leak', 'A leak under the kitchen sink.'],
    ]);
    // Every call came from a mobile in Ofcom's range for drama.
    for (const call of calls) {
      expect(call.from).toMatch(/^\+447700900\d{3}$/);
    }
  });

  it('has the example’s sixteen customers, each with one job, and invented mobiles', () => {
    expect(customers.map((customer) => customer.name).sort()).toEqual(
      Object.values(CUSTOMERS)
        .map((customer) => customer.name)
        .sort(),
    );
    expect(jobs).toHaveLength(16);
    expect(new Set(jobs.map((job) => job.customer)).size).toBe(16);
    // Ofcom's range for drama: 07700 900000 to 07700 900999.
    for (const customer of customers) {
      expect(customer.mobile).toMatch(/^\+447700900\d{3}$/);
    }
    expect(jobOf('Mrs Green')).toMatchObject({ about: 'No hot water', place: '24 Beech Avenue', urgent: false });
    expect(jobOf('Mr Price')).toMatchObject({ about: 'Leak under the sink', urgent: true });
  });

  it('holds twelve visits and only the kinds of history Release 1 writes', async () => {
    let visits = 0;
    for (const job of jobs) {
      visits += (await listVisitsForJob(db, firm, job.id)).length;
    }
    expect(visits).toBe(12);
    expect(await historyKinds(env.DB, firm)).toEqual({
      call_answered: 7,
      confirmation_sent: 3,
      details_taken: 7,
      message_taken: 1,
      number_set: 1,
      passed_to_owner: 1,
      reminder_sent: 5,
      service_on: 5,
      urgent_list_set: 1,
      visit_booked: 10,
    });
  });

  it('gives Mrs Green’s job page in the example’s words, without the pronouns', async () => {
    expect(await jobPage('Mrs Green')).toEqual([
      '15/10 08:10 Answered the call.',
      '15/10 08:10 Quote visit booked for Monday, 9am.',
      '15/10 08:11 Sent a confirmation.',
    ]);
  });

  it('gives Mrs Ahmed’s job page up to her install', async () => {
    expect(await jobPage('Mrs Ahmed')).toEqual([
      '28/9 11:15 Answered the call.',
      '28/9 11:15 Quote visit booked for Thursday, 3pm.',
      '28/9 11:16 Sent a confirmation.',
      '30/9 13:00 Sent a reminder about the visit.',
      '4/10 18:42 Install booked for Thursday 15 October, 8:30am.',
      '14/10 13:00 Sent a reminder about the install.',
    ]);
  });

  it('gives Mr Price’s job page: answered and passed straight on', async () => {
    expect(await jobPage('Mr Price')).toEqual([
      '15/10 11:02 Answered the call.',
      '15/10 11:02 Passed straight to you.',
    ]);
  });

  it('gives Done for you on Thursday 15 October, latest first', async () => {
    const today = await historyBetween(
      db,
      firm,
      instantFromIso('2026-10-15T00:00:00+01:00'),
      instantFromIso('2026-10-16T00:00:00+01:00'),
    );
    const feed = today
      .reverse()
      .map((entry) => historyLine(entry, 'feed'))
      .filter((line) => line !== null);
    expect(feed).toEqual([
      'Booked Mr Evans’s install for Tuesday, 8:30am.',
      'Call from Mr Price. Passed straight to you.',
      'Call from Mr Price answered.',
      'Booked Mr Clarke’s quote visit for Friday, 10am.',
      'Call from a supplier. Your order is ready to collect.',
      'Sent Mrs Green a confirmation.',
      'Booked Mrs Green’s quote visit for Monday, 9am.',
      'Call from Mrs Green answered.',
    ]);
  });

  it('works out each job’s state on the example’s today from its records', async () => {
    const states: Record<string, string | null> = {};
    for (const customer of customers) {
      const job = jobOf(customer.name);
      states[customer.name] = jobState(job, await listVisitsForJob(db, firm, job.id), now);
    }
    expect(states).toEqual({
      'Mrs Ahmed': 'today',
      'Mr Davies': 'today',
      'Mrs Patel': 'today',
      'Mr Clarke': 'booked',
      'Mrs Green': 'booked',
      'Mrs Reid': 'booked',
      'Mr Evans': 'booked',
      'Mr Price': 'urgent',
      // These ten wait on a quote or an invoice in the example. The eight
      // without a visit to come have no state in Release 1.
      'Mr Hughes': null,
      'Mr Wood': null,
      'Mrs Lewis': null,
      'Mrs Kaur': null,
      'Mr Turner': null,
      'Ms Bell': null,
      'Mr Shah': null,
      'Mr Khan': null,
    });
  });

  it('is not loaded twice', async () => {
    expect(await ensureExample(env.DB)).toBe(firm);
    expect(await exampleFirms(db)).toEqual([firm]);
    expect(await listCustomers(db, firm)).toHaveLength(16);
  });

  it('can be loaded again under another name, as a separate firm of the same shape', async () => {
    const twin = await loadExample(env.DB, { name: 'Second Example Firm', isExample: false, number: '07700 900200' });
    expect(twin).not.toBe(firm);
    expect(await exampleFirms(db)).toEqual([firm]);
    expect(await historyKinds(env.DB, twin)).toEqual(await historyKinds(env.DB, firm));
    expect((await listCustomers(db, twin)).map((customer) => customer.name)).toEqual(
      customers.map((customer) => customer.name),
    );
  });
});

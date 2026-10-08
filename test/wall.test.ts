// The wall between firms (rules 8 and 9 in CLAUDE.md, and step 9 of the
// acceptance story). Two firms with data of the same shape: Tidewell Heating
// and a copy of it under another name, so every customer has a twin with the
// same name and mobile in the other firm. Every record function is called as
// the second firm with the first firm's ids. It must find nothing or refuse,
// and leave the first firm exactly as it was.

import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { loadExample } from '../src/example/load';
import { ukMobile } from '../src/phone';
import * as record from '../src/record';
import { openRecord, Refused, type RecordDb } from '../src/record/db';
import type { Customer, FirmId, HistoryId, Job, OwnerId, VisitId } from '../src/record/types';
import { firmRows } from './helpers/db';

const clock = pretendClock(instantFromIso('2026-10-15T16:00:00+01:00'));
const db = openRecord(env.DB, clock);
const frontline = { kind: 'frontline' } as const;
const mrsAhmedsMobile = ukMobile('07700 900003');

/** The first firm and everything in it. */
let a: FirmId;
let ofA: {
  owners: OwnerId[];
  customers: Customer[];
  jobs: Job[];
  visits: VisitId[];
  entries: HistoryId[];
  /** Every id of the first firm's, to look for in what the second firm is given. */
  ids: string[];
};
/** The second firm, of the same shape. */
let b: FirmId;
let jobOfB: Job;

beforeAll(async () => {
  a = await loadExample(env.DB);
  b = await loadExample(env.DB, { name: 'Second Example Firm', isExample: false });

  const owners = (await record.listOwners(db, a)).map((owner) => owner.id);
  const customers = await record.listCustomers(db, a);
  const jobs = await record.listJobs(db, a);
  const visits: VisitId[] = [];
  for (const job of jobs) {
    visits.push(...(await record.listVisitsForJob(db, a, job.id)).map((visit) => visit.id));
  }
  const far = instantFromIso('2100-01-01T00:00:00Z');
  const entries = (await record.historyBetween(db, a, instantFromIso('2000-01-01T00:00:00Z'), far)).map(
    (entry) => entry.id,
  );
  ofA = {
    owners,
    customers,
    jobs,
    visits,
    entries,
    ids: [a, ...owners, ...customers.map((c) => c.id), ...jobs.map((j) => j.id), ...visits, ...entries],
  };
  const [first] = await record.listJobs(db, b);
  if (first === undefined) throw new Error('The second firm has no jobs');
  jobOfB = first;
});

/** Fails if anything of the first firm's is in what the second firm was given. */
function nothingOfA(given: unknown): void {
  const text = JSON.stringify(given);
  for (const id of ofA.ids) {
    expect(text).not.toContain(id);
  }
}

async function refused(attempt: Promise<unknown>): Promise<void> {
  await expect(attempt).rejects.toThrow(Refused);
}

const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;

// One case for every record function. The type makes this list fail to build
// when a record function is added without its case.
const cases: { [Name in keyof typeof record]: () => Promise<void> } = {
  // The two that work on firms themselves.
  async createFirm() {
    const made = await record.createFirm(db, { name: 'Tidewell Heating', isExample: false });
    expect(await record.listCustomers(db, made)).toEqual([]);
    expect(await record.listJobs(db, made)).toEqual([]);
  },
  async exampleFirms() {
    const found = await record.exampleFirms(db);
    expect(found).toContain(a);
    expect(found).not.toContain(b);
  },

  async getFirm() {
    const firm = await record.getFirm(db, b);
    expect(firm).toMatchObject({ id: b, name: 'Second Example Firm' });
    nothingOfA(firm);
  },
  async setService() {
    await record.setService(db, b, 'calls', false, frontline);
    expect((await record.getFirm(db, b))?.services.calls).toBe(false);
    await record.setService(db, b, 'calls', true, frontline);
    for (const owner of ofA.owners) {
      await refused(record.setService(db, b, 'calls', false, { kind: 'owner', owner }));
    }
  },
  async setStopButton() {
    await record.setStopButton(db, b, true, frontline);
    expect((await record.getFirm(db, b))?.stopped).toBe(true);
    await record.setStopButton(db, b, false, frontline);
    for (const owner of ofA.owners) {
      await refused(record.setStopButton(db, b, true, { kind: 'owner', owner }));
    }
  },

  async createOwner() {
    const owner = await record.createOwner(db, b, { name: 'Tom' });
    expect((await record.listOwners(db, b)).map((one) => one.id)).toContain(owner);
  },
  async getOwner() {
    for (const owner of ofA.owners) {
      expect(await record.getOwner(db, b, owner)).toBeNull();
    }
  },
  async listOwners() {
    const owners = await record.listOwners(db, b);
    expect(owners.length).toBeGreaterThan(0);
    nothingOfA(owners);
  },

  async createCustomer() {
    const twin = await record.createCustomer(db, b, { name: 'Mrs Ahmed', mobile: mrsAhmedsMobile });
    expect(await record.getCustomer(db, b, twin)).toMatchObject({ name: 'Mrs Ahmed' });
  },
  async getCustomer() {
    for (const customer of ofA.customers) {
      expect(await record.getCustomer(db, b, customer.id)).toBeNull();
    }
  },
  async listCustomers() {
    const customers = await record.listCustomers(db, b);
    expect(customers.length).toBeGreaterThanOrEqual(16);
    nothingOfA(customers);
  },
  async findCustomersByMobile() {
    // Step 9: a customer of each firm on Mrs Ahmed's mobile.
    expect((await record.findCustomersByMobile(db, a, mrsAhmedsMobile)).length).toBeGreaterThan(0);
    const found = await record.findCustomersByMobile(db, b, mrsAhmedsMobile);
    expect(found.length).toBeGreaterThan(0);
    nothingOfA(found);
  },

  async createJob() {
    for (const customer of ofA.customers) {
      await refused(
        record.createJob(db, b, { customer: customer.id, about: 'No hot water', place: '24 Beech Avenue', urgent: false }),
      );
    }
  },
  async getJob() {
    for (const job of ofA.jobs) {
      expect(await record.getJob(db, b, job.id)).toBeNull();
    }
  },
  async listJobs() {
    const jobs = await record.listJobs(db, b);
    expect(jobs).toHaveLength(16);
    nothingOfA(jobs);
  },
  async listJobsForCustomer() {
    for (const customer of ofA.customers) {
      expect(await record.listJobsForCustomer(db, b, customer.id)).toEqual([]);
    }
  },

  async createVisit() {
    for (const job of ofA.jobs) {
      await refused(record.createVisit(db, b, { job: job.id, startsAt: clock.now(), kind: 'quote_visit' }));
    }
  },
  async getVisit() {
    for (const visit of ofA.visits) {
      expect(await record.getVisit(db, b, visit)).toBeNull();
    }
  },
  async listVisitsForJob() {
    for (const job of ofA.jobs) {
      expect(await record.listVisitsForJob(db, b, job.id)).toEqual([]);
    }
  },

  async addHistory() {
    for (const visit of ofA.visits) {
      await refused(record.addHistory(db, b, { kind: 'reminder_sent', by: frontline, visit }));
    }
    for (const job of ofA.jobs) {
      await refused(record.addHistory(db, b, { kind: 'call_answered', by: frontline, job: job.id }));
    }
    for (const customer of ofA.customers) {
      await refused(record.addHistory(db, b, { kind: 'details_taken', by: frontline, customer: customer.id }));
    }
    // The second firm's own job, said to be done by the first firm's owner.
    for (const owner of ofA.owners) {
      await refused(
        record.addHistory(db, b, { kind: 'call_answered', by: { kind: 'owner', owner }, job: jobOfB.id }),
      );
    }
  },
  async historyForJob() {
    for (const job of ofA.jobs) {
      expect(await record.historyForJob(db, b, job.id)).toEqual([]);
    }
  },
  async historyForCustomer() {
    for (const customer of ofA.customers) {
      expect(await record.historyForCustomer(db, b, customer.id)).toEqual([]);
    }
  },
  async historyBetween() {
    const entries = await record.historyBetween(db, b, ...allTime);
    expect(entries.length).toBeGreaterThan(0);
    nothingOfA(entries);
  },
};

describe('the wall between firms', () => {
  it('has a case for every record function', () => {
    expect(Object.keys(cases).sort()).toEqual(Object.keys(record).sort());
  });

  it('has every record function take the firm, apart from the two that work on firms themselves', () => {
    type NotTakingTheFirm = {
      [Name in keyof typeof record]: Parameters<(typeof record)[Name]> extends [RecordDb, FirmId, ...unknown[]]
        ? never
        : Name;
    }[keyof typeof record];
    expectTypeOf<NotTakingTheFirm>().toEqualTypeOf<'createFirm' | 'exampleFirms'>();
  });

  it.each(Object.keys(cases) as (keyof typeof record)[])(
    '%s, used as another firm, finds nothing of this firm and changes nothing',
    async (name) => {
      const before = await firmRows(env.DB, a);
      await cases[name]();
      expect(await firmRows(env.DB, a)).toEqual(before);
    },
  );

  it('keeps the two firms the same shape, with nothing shared', async () => {
    const customersOfB = await record.listCustomers(db, b);
    expect(customersOfB.map((customer) => customer.name)).toEqual(
      expect.arrayContaining(ofA.customers.map((customer) => customer.name)),
    );
    expect(customersOfB.map((customer) => customer.mobile)).toEqual(
      expect.arrayContaining(ofA.customers.map((customer) => customer.mobile)),
    );
    nothingOfA(customersOfB);
  });
});

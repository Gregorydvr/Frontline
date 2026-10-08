import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock, type PretendClock } from '../src/clock';
import { idFromBytes } from '../src/ids';
import { ukMobile } from '../src/phone';
import {
  addHistory,
  createCustomer,
  createFirm,
  createJob,
  createOwner,
  createVisit,
  exampleFirms,
  findCustomersByMobile,
  getCustomer,
  getFirm,
  getJob,
  getOwner,
  getVisit,
  historyBetween,
  historyForCustomer,
  historyForJob,
  listCustomers,
  listJobs,
  listJobsForCustomer,
  listOwners,
  listVisitsForJob,
  setService,
  setStopButton,
} from '../src/record';
import { openRecord, Refused, type RecordDb } from '../src/record/db';
import type { FirmId, HistoryKind, JobId, VisitKind } from '../src/record/types';
import { historyKinds, tryToEditHistory } from './helpers/db';

let clock: PretendClock;
let db: RecordDb;
let firm: FirmId;

beforeEach(async () => {
  clock = pretendClock(instantFromIso('2026-10-15T08:10:00+01:00'));
  db = openRecord(env.DB, clock);
  firm = await createFirm(db, { name: 'Tidewell Heating', isExample: true });
});

const frontline = { kind: 'frontline' } as const;

describe('firms', () => {
  it('starts a new firm with every service off and the stop button off', async () => {
    const plain = await createFirm(db, { name: 'Tidewell Heating', isExample: false });
    expect(await getFirm(db, plain)).toEqual({
      id: plain,
      name: 'Tidewell Heating',
      isExample: false,
      services: { calls: false, quotes: false, followups: false, paperwork: false, invoices: false },
      stopped: false,
      createdAt: instantFromIso('2026-10-15T08:10:00+01:00'),
    });
  });

  it('finds the firms marked as an example', async () => {
    const plain = await createFirm(db, { name: 'Tidewell Heating', isExample: false });
    const found = await exampleFirms(db);
    expect(found).toContain(firm);
    expect(found).not.toContain(plain);
  });

  it('switches a service and records who did it, with the time', async () => {
    const owner = await createOwner(db, firm, { name: 'Tom' });
    clock.advance(60_000);
    await setService(db, firm, 'calls', true, frontline);
    await setService(db, firm, 'quotes', true, { kind: 'owner', owner });
    await setService(db, firm, 'quotes', false, frontline);

    expect((await getFirm(db, firm))?.services).toEqual({
      calls: true,
      quotes: false,
      followups: false,
      paperwork: false,
      invoices: false,
    });
    const entries = await historyBetween(db, firm, clock.now(), instantFromIso('2027-01-01T00:00:00Z'));
    expect(entries.map((entry) => [entry.kind, entry.service, entry.by])).toEqual([
      ['service_on', 'calls', frontline],
      ['service_on', 'quotes', { kind: 'owner', owner }],
      ['service_off', 'quotes', frontline],
    ]);
    expect(entries.every((entry) => entry.at === instantFromIso('2026-10-15T08:11:00+01:00'))).toBe(true);
  });

  it('turns the stop button on and off and records each', async () => {
    await setStopButton(db, firm, true, frontline);
    expect((await getFirm(db, firm))?.stopped).toBe(true);
    await setStopButton(db, firm, false, frontline);
    expect((await getFirm(db, firm))?.stopped).toBe(false);
    expect(await historyKinds(env.DB, firm)).toEqual({ stop_off: 1, stop_on: 1 });
  });

  it('refuses a service that is not one of the five, and changes nothing', async () => {
    await expect(setService(db, firm, 'whatsapp' as 'calls', true, frontline)).rejects.toThrow(Refused);
    expect(await historyKinds(env.DB, firm)).toEqual({});
  });

  it('refuses a switch for a firm that does not exist, and writes no history', async () => {
    const missing = idFromBytes(new Uint8Array(16).fill(7)) as FirmId;
    await expect(setStopButton(db, missing, true, frontline)).rejects.toThrow(Refused);
    await expect(setService(db, missing, 'calls', true, frontline)).rejects.toThrow(Refused);
    expect(await historyKinds(env.DB, missing)).toEqual({});
  });

  it('refuses an empty name', async () => {
    await expect(createFirm(db, { name: ' ', isExample: false })).rejects.toThrow(Refused);
  });

  it('gives nothing for a firm that does not exist', async () => {
    expect(await getFirm(db, idFromBytes(new Uint8Array(16).fill(9)) as FirmId)).toBeNull();
  });
});

describe('owners', () => {
  it('stores and reads back the owner', async () => {
    const owner = await createOwner(db, firm, { name: 'Tom' });
    const expected = { id: owner, name: 'Tom', createdAt: clock.now() };
    expect(await getOwner(db, firm, owner)).toEqual(expected);
    expect(await listOwners(db, firm)).toEqual([expected]);
  });
});

describe('customers', () => {
  it('stores and reads back a customer, with or without a mobile', async () => {
    const green = await createCustomer(db, firm, { name: 'Mrs Green', mobile: ukMobile('07700 900015') });
    clock.advance(1);
    const price = await createCustomer(db, firm, { name: 'Mr Price', mobile: null });

    expect(await getCustomer(db, firm, green)).toEqual({
      id: green,
      name: 'Mrs Green',
      mobile: '+447700900015',
      createdAt: instantFromIso('2026-10-15T08:10:00+01:00'),
    });
    expect((await listCustomers(db, firm)).map((customer) => customer.id)).toEqual([green, price]);
    expect((await getCustomer(db, firm, price))?.mobile).toBeNull();
  });

  it('finds a customer by mobile, however the number was written', async () => {
    const green = await createCustomer(db, firm, { name: 'Mrs Green', mobile: ukMobile('+44 7700 900015') });
    const found = await findCustomersByMobile(db, firm, ukMobile('07700900015'));
    expect(found.map((customer) => customer.id)).toEqual([green]);
    expect(await findCustomersByMobile(db, firm, ukMobile('07700 900016'))).toEqual([]);
  });

  it('refuses a mobile that was not read by ukMobile(), even one forced past the types', async () => {
    await expect(
      createCustomer(db, firm, { name: 'Mrs Green', mobile: '07700 900015' as ReturnType<typeof ukMobile> }),
    ).rejects.toThrow(Refused);
  });
});

describe('jobs', () => {
  it('stores and reads back a job for a customer', async () => {
    const price = await createCustomer(db, firm, { name: 'Mr Price', mobile: ukMobile('07700 900016') });
    const job = await createJob(db, firm, {
      customer: price,
      about: 'Leak under the sink',
      place: '6 Bridge Street',
      urgent: true,
    });
    const expected = {
      id: job,
      customer: price,
      about: 'Leak under the sink',
      place: '6 Bridge Street',
      urgent: true,
      createdAt: clock.now(),
    };
    expect(await getJob(db, firm, job)).toEqual(expected);
    expect(await listJobs(db, firm)).toEqual([expected]);
    expect(await listJobsForCustomer(db, firm, price)).toEqual([expected]);
  });

  it('refuses a job for a customer that does not exist', async () => {
    await expect(
      createJob(db, firm, {
        customer: idFromBytes(new Uint8Array(16).fill(3)) as never,
        about: 'Leak under the sink',
        place: '6 Bridge Street',
        urgent: false,
      }),
    ).rejects.toThrow(Refused);
  });
});

describe('visits', () => {
  it('books visits for a job and lists them earliest first', async () => {
    const job = await greenJob();
    const later = await createVisit(db, firm, {
      job,
      startsAt: instantFromIso('2026-10-26T09:00:00Z'),
      kind: 'install',
    });
    const sooner = await createVisit(db, firm, {
      job,
      startsAt: instantFromIso('2026-10-19T09:00:00+01:00'),
      kind: 'quote_visit',
    });
    expect(await getVisit(db, firm, sooner)).toEqual({
      id: sooner,
      job,
      startsAt: instantFromIso('2026-10-19T08:00:00Z'),
      kind: 'quote_visit',
      state: 'booked',
      createdAt: clock.now(),
    });
    expect((await listVisitsForJob(db, firm, job)).map((visit) => visit.id)).toEqual([sooner, later]);
  });

  it('refuses a kind of visit that is not on the list', async () => {
    const job = await greenJob();
    await expect(
      createVisit(db, firm, { job, startsAt: clock.now(), kind: 'survey' as VisitKind }),
    ).rejects.toThrow(Refused);
  });
});

describe('history', () => {
  it('records what happened on a call, in the order it happened, with what a line needs', async () => {
    const job = await greenJob();
    const visit = await createVisit(db, firm, {
      job,
      startsAt: instantFromIso('2026-10-19T09:00:00+01:00'),
      kind: 'quote_visit',
    });
    const customer = (await getJob(db, firm, job))?.customer;
    if (customer === undefined) throw new Error('The job has no customer');

    await addHistory(db, firm, { kind: 'call_answered', by: frontline, job });
    await addHistory(db, firm, { kind: 'details_taken', by: frontline, customer });
    await addHistory(db, firm, { kind: 'visit_booked', by: frontline, visit });
    clock.advance(60_000);
    await addHistory(db, firm, { kind: 'confirmation_sent', by: frontline, visit });

    const forJob = await historyForJob(db, firm, job);
    expect(forJob.map((entry) => entry.kind)).toEqual(['call_answered', 'visit_booked', 'confirmation_sent']);
    expect(forJob[1]).toEqual({
      id: forJob[1]?.id,
      at: instantFromIso('2026-10-15T08:10:00+01:00'),
      by: frontline,
      kind: 'visit_booked',
      customer: { id: customer, name: 'Mrs Green' },
      job,
      visit: { id: visit, kind: 'quote_visit', startsAt: instantFromIso('2026-10-19T09:00:00+01:00') },
      service: null,
    });

    const forCustomer = await historyForCustomer(db, firm, customer);
    expect(forCustomer.map((entry) => entry.kind)).toEqual([
      'call_answered',
      'details_taken',
      'visit_booked',
      'confirmation_sent',
    ]);
    expect(forCustomer[1]?.job).toBeNull();

    const sinceTheConfirmation = await historyBetween(
      db,
      firm,
      instantFromIso('2026-10-15T08:11:00+01:00'),
      instantFromIso('2026-10-15T08:12:00+01:00'),
    );
    expect(sinceTheConfirmation.map((entry) => entry.kind)).toEqual(['confirmation_sent']);
  });

  it('records an entry by the customer', async () => {
    const job = await greenJob();
    await addHistory(db, firm, { kind: 'call_answered', by: { kind: 'customer' }, job });
    expect((await historyForJob(db, firm, job))[0]?.by).toEqual({ kind: 'customer' });
  });

  it('refuses a kind that is not on the list, or that does not fit what it is about', async () => {
    const job = await greenJob();
    await expect(
      addHistory(db, firm, { kind: 'quote_sent' as 'call_answered', by: frontline, job }),
    ).rejects.toThrow(Refused);
    await expect(
      addHistory(db, firm, { kind: 'visit_booked', by: frontline, job } as never),
    ).rejects.toThrow(Refused);
    await expect(
      addHistory(db, firm, { kind: 'stop_on' as 'call_answered', by: frontline, job }),
    ).rejects.toThrow(Refused);
    expect(await historyForJob(db, firm, job)).toEqual([]);
  });

  it('refuses an entry about something that does not exist', async () => {
    const nothing = idFromBytes(new Uint8Array(16).fill(5));
    const kinds: [HistoryKind, string][] = [
      ['call_answered', 'job'],
      ['details_taken', 'customer'],
      ['visit_booked', 'visit'],
    ];
    for (const [kind, about] of kinds) {
      await expect(addHistory(db, firm, { kind, by: frontline, [about]: nothing } as never)).rejects.toThrow(
        Refused,
      );
    }
  });

  it('is never edited: the database refuses a change', async () => {
    const job = await greenJob();
    const id = await addHistory(db, firm, { kind: 'call_answered', by: frontline, job });
    await expect(tryToEditHistory(env.DB, id)).rejects.toThrow(/History is never edited/);
    expect((await historyForJob(db, firm, job)).map((entry) => entry.kind)).toEqual(['call_answered']);
  });
});

async function greenJob(): Promise<JobId> {
  const customer = await createCustomer(db, firm, { name: 'Mrs Green', mobile: ukMobile('07700 900015') });
  return createJob(db, firm, { customer, about: 'No hot water', place: '24 Beech Avenue', urgent: false });
}

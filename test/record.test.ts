import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock, type PretendClock } from '../src/clock';
import { idFromBytes } from '../src/ids';
import { ukLandline, ukMobile, type UkLandline } from '../src/phone';
import {
  addHistory,
  createCustomer,
  createFirm,
  createJob,
  createOwner,
  createVisit,
  exampleFirms,
  findCallByProviderId,
  findCustomersByLandline,
  findCustomersByMobile,
  findFirmByNumber,
  getCall,
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
  listCallsBetween,
  listVisitsForJob,
  listVisitsFrom,
  markCallBooked,
  recordCall,
  setFirmNumber,
  setService,
  setStopButton,
  setUrgentList,
} from '../src/record';
import { openRecord, Refused, type RecordDb } from '../src/record/db';
import type { CallFor, FirmId, HistoryKind, JobId, NewCall, VisitKind } from '../src/record/types';
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
      phoneNumber: null,
      urgentList: [],
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

  it('gives the firm its number, finds the firm by it, and records who did it', async () => {
    await setFirmNumber(db, firm, ukMobile('07700 900100'), frontline);
    expect((await getFirm(db, firm))?.phoneNumber).toBe('+447700900100');
    expect(await findFirmByNumber(db, ukMobile('+44 7700 900100'))).toBe(firm);
    expect(await findFirmByNumber(db, ukMobile('07700 900101'))).toBeNull();
    expect(await historyKinds(env.DB, firm)).toEqual({ number_set: 1 });
  });

  it('refuses a number another firm has, or one that is not a stored mobile, and changes nothing', async () => {
    const other = await createFirm(db, { name: 'Second Example Firm', isExample: false });
    await setFirmNumber(db, other, ukMobile('07700 900200'), frontline);
    await expect(setFirmNumber(db, firm, ukMobile('07700 900200'), frontline)).rejects.toThrow(Refused);
    await expect(setFirmNumber(db, firm, '07700 900100' as never, frontline)).rejects.toThrow(Refused);
    await expect(findFirmByNumber(db, '07700 900200' as never)).rejects.toThrow(Refused);
    expect((await getFirm(db, firm))?.phoneNumber).toBeNull();
    expect(await historyKinds(env.DB, firm)).toEqual({});
  });

  it('sets what counts as urgent, and records who did it', async () => {
    await setUrgentList(db, firm, ['a leak', 'no heating for someone elderly'], frontline);
    expect((await getFirm(db, firm))?.urgentList).toEqual(['a leak', 'no heating for someone elderly']);
    await setUrgentList(db, firm, [], frontline);
    expect((await getFirm(db, firm))?.urgentList).toEqual([]);
    expect(await historyKinds(env.DB, firm)).toEqual({ urgent_list_set: 2 });
  });

  it.each([
    ['an empty item', ['']],
    ['an item on two lines', ['a leak\nor a drip']],
    ['an item too long', ['x'.repeat(61)]],
    ['the same item twice', ['a leak', 'A leak']],
    ['too many items', Array.from({ length: 21 }, (_, i) => `item ${String(i)}`)],
  ])('refuses an urgent list with %s', async (_, items) => {
    await expect(setUrgentList(db, firm, items, frontline)).rejects.toThrow(Refused);
    expect((await getFirm(db, firm))?.urgentList).toEqual([]);
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
    const price = await createCustomer(db, firm, { name: 'Mr Price', mobile: null, noText: 'withheld' });

    expect(await getCustomer(db, firm, green)).toEqual({
      id: green,
      name: 'Mrs Green',
      mobile: '+447700900015',
      landline: null,
      noText: null,
      createdAt: instantFromIso('2026-10-15T08:10:00+01:00'),
    });
    expect((await listCustomers(db, firm)).map((customer) => customer.id)).toEqual([green, price]);
    expect(await getCustomer(db, firm, price)).toMatchObject({ mobile: null, noText: 'withheld' });
  });

  it('keeps a landline, and finds a customer by it', async () => {
    const hall = await createCustomer(db, firm, {
      name: 'Mrs Hall',
      mobile: null,
      landline: ukLandline('01632 960001'),
      noText: 'landline',
    });
    expect(await getCustomer(db, firm, hall)).toMatchObject({ landline: '+441632960001', noText: 'landline' });
    const found = await findCustomersByLandline(db, firm, ukLandline('+44 1632 960001'));
    expect(found.map((customer) => customer.id)).toEqual([hall]);
    expect(await findCustomersByLandline(db, firm, ukLandline('01632 960002'))).toEqual([]);
  });

  it('marks why no text can reach a customer without a mobile, and only then', async () => {
    const mobile = ukMobile('07700 900015');
    for (const input of [
      { name: 'Mr Price', mobile: null },
      { name: 'Mr Price', mobile, noText: 'withheld' as const },
      { name: 'Mr Price', mobile: null, noText: 'busy' as 'withheld' },
      { name: 'Mr Price', mobile: null, landline: '01632 960001' as UkLandline, noText: 'landline' as const },
    ]) {
      await expect(createCustomer(db, firm, input)).rejects.toThrow(Refused);
    }
    await expect(findCustomersByLandline(db, firm, '01632 960001' as UkLandline)).rejects.toThrow(Refused);
    expect(await listCustomers(db, firm)).toEqual([]);
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
      call: null,
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

describe('calls', () => {
  const at = instantFromIso('2026-10-15T08:10:00+01:00');
  let calls = 0;

  function call(forWhom: CallFor, more: Partial<NewCall> = {}): NewCall {
    calls += 1;
    return {
      provider: 'vapi',
      providerCallId: `call-${String(calls)}`,
      startedAt: at,
      endedAt: instantFromIso('2026-10-15T08:12:00+01:00'),
      from: ukMobile('07700 900015'),
      for: forWhom,
      urgentItem: null,
      summary: 'No hot water.',
      transcript: 'AI: Hello.\nUser: No hot water.',
      ...more,
    };
  }

  const green: CallFor = {
    kind: 'new_customer',
    name: 'Mrs Green',
    mobile: ukMobile('07700 900015'),
    landline: null,
    noText: null,
    about: 'No hot water',
    place: '24 Beech Avenue',
  };

  it('records a new caller’s call: the customer, the job, the call and its history, in one step', async () => {
    const made = await recordCall(db, firm, call(green));
    expect(await getCall(db, firm, made.call)).toEqual({
      id: made.call,
      provider: 'vapi',
      providerCallId: `call-${String(calls)}`,
      startedAt: at,
      endedAt: instantFromIso('2026-10-15T08:12:00+01:00'),
      from: '+447700900015',
      customer: { id: made.customer, name: 'Mrs Green' },
      job: made.job,
      visit: null,
      outcome: 'message',
      urgentItem: null,
      caller: null,
      summary: 'No hot water.',
      transcript: 'AI: Hello.\nUser: No hot water.',
      createdAt: clock.now(),
    });
    expect(await getJob(db, firm, made.job as JobId)).toMatchObject({ about: 'No hot water', urgent: false });
    const entries = await historyForCustomer(db, firm, made.customer as never);
    expect(entries.map((entry) => [entry.kind, entry.call?.id ?? null])).toEqual([
      ['call_answered', made.call],
      ['details_taken', null],
    ]);
    expect(await findCallByProviderId(db, firm, 'vapi', `call-${String(calls)}`)).toBe(made.call);
    expect(await findCallByProviderId(db, firm, 'vapi', 'call-none')).toBeNull();
  });

  it('opens a new job for one of the firm’s customers, and makes it urgent with an urgent item', async () => {
    const first = await recordCall(db, firm, call(green));
    const again = await recordCall(
      db,
      firm,
      call(
        { kind: 'customer', customer: first.customer as never, about: 'Leak under the sink', place: '24 Beech Avenue' },
        { urgentItem: 'a leak' },
      ),
    );
    expect(again.customer).toBe(first.customer);
    expect(again.job).not.toBe(first.job);
    expect(await getJob(db, firm, again.job as JobId)).toMatchObject({ urgent: true });
    expect(await getCall(db, firm, again.call)).toMatchObject({ outcome: 'urgent', urgentItem: 'a leak' });
    expect(await listCustomers(db, firm)).toHaveLength(1);
  });

  it('records a caller who is not a customer, and a call with its details missing, with no customer or job', async () => {
    const supplier = await recordCall(db, firm, call({ kind: 'not_customer', caller: 'a supplier' }));
    const unclear = await recordCall(db, firm, call({ kind: 'details_missing' }, { from: null, summary: null }));
    expect(supplier).toMatchObject({ customer: null, job: null });
    expect(await getCall(db, firm, supplier.call)).toMatchObject({ caller: 'a supplier', customer: null });
    expect(await getCall(db, firm, unclear.call)).toMatchObject({ caller: null, from: null, summary: null });
    expect(await listCustomers(db, firm)).toEqual([]);
    const entries = await historyBetween(db, firm, at, instantFromIso('2026-10-16T00:00:00+01:00'));
    expect(entries.map((entry) => [entry.kind, entry.call?.id, entry.call?.caller])).toEqual([
      ['message_taken', supplier.call, 'a supplier'],
      ['details_missing', unclear.call, null],
    ]);
  });

  it('holds a call only once: the same call again is refused, and nothing of it is written', async () => {
    const first = call(green);
    await recordCall(db, firm, first);
    await expect(recordCall(db, firm, { ...first, for: { ...green, name: 'Mrs Green again' } })).rejects.toThrow(
      Refused,
    );
    expect(await listCustomers(db, firm)).toHaveLength(1);
    expect(await listJobs(db, firm)).toHaveLength(1);
    expect(await historyKinds(env.DB, firm)).toEqual({ call_answered: 1, details_taken: 1 });
  });

  it.each([
    ['a provider it does not know', { provider: 'acme' as 'vapi' }],
    ['no id for the call', { providerCallId: '' }],
    ['a number not in its stored form', { from: '07700 900015' as never }],
    ['a summary on two lines', { summary: 'No hot water.\nSince last night.' }],
    ['an urgent item too long', { urgentItem: 'x'.repeat(61) }],
    ['a transcript far too long', { transcript: 'x'.repeat(100_001) }],
  ])('refuses a call with %s, and writes nothing', async (_, more) => {
    await expect(recordCall(db, firm, call(green, more))).rejects.toThrow(Refused);
    expect(await listCustomers(db, firm)).toEqual([]);
    expect(await historyKinds(env.DB, firm)).toEqual({});
  });

  it('marks a call booked with a visit for its own job, and nothing else', async () => {
    const made = await recordCall(db, firm, call(green));
    const job = made.job as JobId;
    const visit = await createVisit(db, firm, { job, startsAt: instantFromIso('2026-10-19T09:00:00+01:00'), kind: 'quote_visit' });

    const other = await recordCall(db, firm, call({ ...green, name: 'Mrs Green’s neighbour' }));
    await expect(markCallBooked(db, firm, other.call, visit)).rejects.toThrow(Refused);

    await markCallBooked(db, firm, made.call, visit);
    expect(await getCall(db, firm, made.call)).toMatchObject({
      outcome: 'booked',
      visit: { id: visit, kind: 'quote_visit', startsAt: instantFromIso('2026-10-19T09:00:00+01:00') },
    });
    // Once booked, it cannot be booked again.
    await expect(markCallBooked(db, firm, made.call, visit)).rejects.toThrow(Refused);
  });

  it('does not mark an urgent call as booked', async () => {
    const made = await recordCall(db, firm, call(green, { urgentItem: 'a leak' }));
    const visit = await createVisit(db, firm, { job: made.job as JobId, startsAt: at, kind: 'quote_visit' });
    await expect(markCallBooked(db, firm, made.call, visit)).rejects.toThrow(Refused);
    expect(await getCall(db, firm, made.call)).toMatchObject({ outcome: 'urgent', visit: null });
  });

  it('lists a day’s calls in the order they came in', async () => {
    const later = await recordCall(db, firm, call(green, { startedAt: instantFromIso('2026-10-15T11:02:00+01:00') }));
    const sooner = await recordCall(db, firm, call(green, { startedAt: instantFromIso('2026-10-15T08:26:00+01:00') }));
    await recordCall(db, firm, call(green, { startedAt: instantFromIso('2026-10-16T08:00:00+01:00') }));
    const thursday = await listCallsBetween(
      db,
      firm,
      instantFromIso('2026-10-15T00:00:00+01:00'),
      instantFromIso('2026-10-16T00:00:00+01:00'),
    );
    expect(thursday.map((one) => one.id)).toEqual([sooner.call, later.call]);
  });

  it('lists the booked visits still to come, earliest first, with their customers', async () => {
    const made = await recordCall(db, firm, call(green));
    const job = made.job as JobId;
    const monday = await createVisit(db, firm, { job, startsAt: instantFromIso('2026-10-19T09:00:00+01:00'), kind: 'quote_visit' });
    const friday = await createVisit(db, firm, { job, startsAt: instantFromIso('2026-10-16T10:00:00+01:00'), kind: 'install' });
    await createVisit(db, firm, { job, startsAt: instantFromIso('2026-10-14T10:00:00+01:00'), kind: 'service' });

    const coming = await listVisitsFrom(db, firm, instantFromIso('2026-10-15T16:00:00+01:00'));
    expect(coming.map((visit) => [visit.id, visit.customer.name])).toEqual([
      [friday, 'Mrs Green'],
      [monday, 'Mrs Green'],
    ]);
  });
});

async function greenJob(): Promise<JobId> {
  const customer = await createCustomer(db, firm, { name: 'Mrs Green', mobile: ukMobile('07700 900015') });
  return createJob(db, firm, { customer, about: 'No hot water', place: '24 Beech Avenue', urgent: false });
}

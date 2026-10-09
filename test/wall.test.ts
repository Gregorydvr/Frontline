// The wall between firms (rules 8 and 9 in CLAUDE.md, and step 9 of the
// acceptance story). Two firms with data of the same shape: Tidewell Heating
// and a copy of it under another name, so every customer has a twin with the
// same name and mobile in the other firm. Every record function is called as
// the second firm with the first firm's ids. It must find nothing or refuse,
// and leave the first firm exactly as it was.

import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { runDue } from '../src/due';
import { loadExample } from '../src/example/load';
import { EXAMPLE_DIARY_RULES } from '../src/example/tidewell';
import { newId, type Id } from '../src/ids';
import { ukLandline, ukMobile } from '../src/phone';
import * as record from '../src/record';
import { openRecord, Refused, type RecordDb } from '../src/record/db';
import type { SessionToken } from '../src/record/logins';
import { EXPORTED_TABLES } from '../src/record/firm-file';
import type {
  Call,
  CallId,
  Customer,
  DueId,
  FirmExportId,
  FirmId,
  HistoryId,
  HoldId,
  Job,
  LinkToken,
  LoginToken,
  Message,
  NewCall,
  OwnerId,
  TextIn,
  VisitId,
  WordingId,
} from '../src/record/types';
import { firmRows } from './helpers/db';
import { testDeps } from './helpers/deps';

const clock = pretendClock(instantFromIso('2026-10-15T16:00:00+01:00'));
const db = openRecord(env.DB, clock);
/** The record with the local file stores, for the functions that keep and delete files. */
const withFiles = openRecord(env.DB, clock, testDeps(clock).files);
const frontline = { kind: 'frontline' } as const;
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const far = instantFromIso('2099-01-01T00:00:00Z');
let calls = 0;

/** A call from Mrs Ahmed's mobile, as a report would bring it. */
function newCall(forWhom: NewCall['for']): NewCall {
  calls += 1;
  return {
    provider: 'vapi',
    providerCallId: `wall-${String(calls)}`,
    startedAt: clock.now(),
    endedAt: null,
    from: mrsAhmedsMobile,
    for: forWhom,
    urgentItem: null,
    summary: 'The boiler keeps cutting out.',
    transcript: null,
  };
}
const mrsAhmedsMobile = ukMobile('07700 900003');
const tidewellsNumber = ukMobile('07700 900100');
const secondFirmsNumber = ukMobile('07700 900200');
const mrsHallsLandline = ukLandline('01632 960001');

/** The first firm and everything in it. */
let a: FirmId;
let ofA: {
  owners: OwnerId[];
  customers: Customer[];
  jobs: Job[];
  visits: VisitId[];
  calls: Call[];
  entries: HistoryId[];
  wording: WordingId[];
  dues: DueId[];
  /** The first firm's row held by a worker's claim, with the claim. */
  held: { due: DueId; claim: Id };
  messages: Message[];
  textsIn: TextIn[];
  /** A time the first firm holds for a call still going, under this call id. */
  hold: { id: HoldId; providerCallId: string };
  /** The first firm's link for Mr Clarke. */
  link: LinkToken;
  /** A link to log the first firm's owner in, not yet used, and the cookie of a login they started. */
  login: LoginToken;
  cookie: SessionToken;
  /** The first firm's call with a recording kept, and its export, made. */
  recorded: CallId;
  export: FirmExportId;
  /** Every id of the first firm's, to look for in what the second firm is given. */
  ids: string[];
};
/** The second firm, of the same shape. */
let b: FirmId;
/** The second firm's own login link, not yet used, and login. */
let loginOfB: { login: LoginToken; cookie: SessionToken } | null = null;
let jobOfB: Job;

beforeAll(async () => {
  a = await loadExample(env.DB);
  b = await loadExample(env.DB, { name: 'Second Example Firm', isExample: false, number: '07700 900200' });
  // Each firm also has a customer on the same landline.
  for (const firm of [a, b]) {
    await record.createCustomer(db, firm, { name: 'Mrs Hall', mobile: null, landline: mrsHallsLandline, noText: 'landline' });
  }
  // And, in each firm, texts sent and come in, an opt-out, and rows in the
  // due list in every state another firm might try to change: one done, one
  // waiting until after the tests, and one held by a worker's claim, with a
  // text it is still handing over.
  const heldBy = new Map<FirmId, { due: DueId; claim: Id }>();
  const waitingBy = new Map<FirmId, DueId>();
  const holdBy = new Map<FirmId, HoldId>();
  const linkBy = new Map<FirmId, LinkToken>();
  const loginBy = new Map<FirmId, { login: LoginToken; cookie: SessionToken }>();
  const recordedBy = new Map<FirmId, CallId>();
  for (const firm of [a, b]) {
    const [clarke] = (await record.findCustomersByMobile(db, firm, ukMobile('07700 900005')));
    const [clarkesJob] = clarke === undefined ? [] : await record.listJobsForCustomer(db, firm, clarke.id);
    const [tomorrow] = clarkesJob === undefined ? [] : await record.listVisitsForJob(db, firm, clarkesJob.id);
    if (clarke?.mobile == null || clarkesJob === undefined || tomorrow === undefined) throw new Error('Mr Clarke has no visit');
    const reminder = await record.addDue(db, firm, { action: 'send_reminder', visit: tomorrow.id, runAt: clock.now(), latestAt: clock.now() });
    expect(await runDue(db, testDeps(clock), firm, reminder)).toEqual({ ran: 'done', outcome: 'sent' });
    waitingBy.set(firm, await record.addDue(db, firm, { action: 'send_reminder', visit: tomorrow.id, runAt: far, latestAt: far }));
    const held = await record.addDue(db, firm, { action: 'send_reminder', visit: tomorrow.id, runAt: clock.now(), latestAt: far });
    const claimed = await record.claimDue(db, firm, held);
    const wording = (await record.firmWording(db, firm))['text:visit_reminder'];
    const firmNumber = (await record.getFirm(db, firm))?.phoneNumber;
    if (claimed === null || wording === undefined || firmNumber == null) throw new Error('Not set up');
    heldBy.set(firm, { due: held, claim: claimed.claim });
    await record.claimMessage(db, firm, {
      due: held,
      kind: 'visit_reminder',
      to: { kind: 'customer', customer: clarke.id },
      about: { job: clarkesJob.id, visit: tomorrow.id, call: null },
      going: { toNumber: clarke.mobile, fromNumber: firmNumber, words: 'Reminder.', wording: wording.id },
      notSent: null,
    });
    await record.recordTextIn(db, firm, { provider: 'fake', providerId: `in-${newId()}`, from: '+447700900005', words: 'See you then.', consent: null });
    await record.optOut(db, firm, clarke.id, 'visit_reminder', frontline);
    // A time held during a call on the same call id in each firm, and a link
    // for Mr Clarke.
    const hold = await record.holdTime(db, firm, {
      provider: 'vapi',
      providerCallId: 'wall-hold',
      kind: 'quote_visit',
      startsAt: instantFromIso('2026-10-20T10:00:00+01:00'),
      endsAt: instantFromIso('2026-10-20T11:00:00+01:00'),
    });
    if (hold === null) throw new Error('Not held');
    holdBy.set(firm, hold);
    linkBy.set(firm, await record.linkForDue(db, firm, { due: reminder, customer: clarke.id, job: clarkesJob.id }));
    // A link to log the owner in, not yet used; a login the owner started
    // with another; and what the owner wrote in Message us.
    const [owner] = await record.listOwners(db, firm);
    if (owner === undefined) throw new Error('No owner');
    const unused = await record.createLoginLink(db, firm, { owner: owner.id, job: clarkesJob.id });
    const used = await record.createLoginLink(db, firm, { owner: owner.id, job: null });
    // Their texts are sent, as the login page sends them, so no row is left waiting.
    for (const due of [unused.due, used.due]) {
      expect(await runDue(db, testDeps(clock), firm, due)).toEqual({ ran: 'done', outcome: 'sent' });
    }
    const login = await record.logInWithLink(db, used.token);
    if (login === null) throw new Error('Not logged in');
    loginBy.set(firm, { login: unused.token, cookie: login.session });
    await record.recordOwnerMessage(db, firm, owner.id, 'Please put my day rate up.');
    // A call with its recording kept, and an export of the firm, made.
    const recording = `firms/${firm}/wall-recording.mp3`;
    await record.placeInInbox(withFiles, firm, recording, new TextEncoder().encode('Invented bytes.'));
    const recorded = await record.recordCall(db, firm, { ...newCall({ kind: 'not_customer', caller: 'a supplier' }), recording: { kind: 'waiting', from: recording } });
    expect(await record.moveRecording(withFiles, firm, recorded.call)).toBe('kept');
    recordedBy.set(firm, recorded.call);
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    await record.askFirmExport(db, firm, staff.id);
  }
  // The exports made by their rows in the due list, as the clock runs them.
  for (const { firm, due } of await record.findDue(db)) {
    if ((await record.getDue(db, firm, due))?.action === 'make_firm_export') {
      expect(await runDue(withFiles, testDeps(clock), firm, due)).toEqual({ ran: 'done', outcome: 'made' });
    }
  }
  // Each firm's daily sweep, as the clock gives it.
  await record.addMissingSweeps(db);
  // The first firm alone has Mrs Ahmed's number opted out: the second firm
  // must not see it.
  await record.optOutNumber(db, a, mrsAhmedsMobile);

  const owners = (await record.listOwners(db, a)).map((owner) => owner.id);
  const customers = await record.listCustomers(db, a);
  const jobs = await record.listJobs(db, a);
  const visits: VisitId[] = [];
  for (const job of jobs) {
    visits.push(...(await record.listVisitsForJob(db, a, job.id)).map((visit) => visit.id));
  }
  const calls = await record.listCallsBetween(db, a, ...allTime);
  const entries = (await record.historyBetween(db, a, instantFromIso('2000-01-01T00:00:00Z'), far)).map(
    (entry) => entry.id,
  );
  const wording = Object.values(await record.firmWording(db, a)).map((words) => words.id);
  const messages = await record.listMessagesBetween(db, a, ...allTime);
  const textsIn = await record.listTextsInBetween(db, a, ...allTime);
  const dues: DueId[] = [];
  for (const call of calls) {
    dues.push(...(await record.listDueForCall(db, a, call.id)).map((due) => due.id));
  }
  dues.push(...messages.map((message) => message.due));
  const held = heldBy.get(a);
  const waiting = waitingBy.get(a);
  const holdOfA = holdBy.get(a);
  const linkOfA = linkBy.get(a);
  const loginOfA = loginBy.get(a);
  if (held === undefined || waiting === undefined || holdOfA === undefined || linkOfA === undefined || loginOfA === undefined) {
    throw new Error('No held or waiting row');
  }
  loginOfB = loginBy.get(b) ?? null;
  const recordedOfA = recordedBy.get(a);
  const [exportOfA] = await record.listFirmExports(db, a);
  if (recordedOfA === undefined || exportOfA === undefined) throw new Error('No recording or export');
  dues.push(waiting, held.due);
  // Rows another firm could change if a query lost its firm: one waiting,
  // one held by a claim, and a text still being handed over.
  const states = await Promise.all([...new Set(dues)].map(async (due) => (await record.getDue(db, a, due))?.state));
  expect(states).toEqual(expect.arrayContaining(['waiting', 'claimed', 'done', 'cancelled']));
  expect(messages.map((message) => message.state)).toEqual(expect.arrayContaining(['sent', 'sending']));
  ofA = {
    owners,
    customers,
    jobs,
    visits,
    calls,
    entries,
    wording,
    dues: [...new Set(dues)],
    held,
    messages,
    textsIn,
    hold: { id: holdOfA, providerCallId: 'wall-hold' },
    link: linkOfA,
    login: loginOfA.login,
    cookie: loginOfA.cookie,
    recorded: recordedOfA,
    export: exportOfA.id,
    ids: [
      a,
      exportOfA.id,
      holdOfA,
      linkOfA,
      loginOfA.login,
      loginOfA.cookie,
      ...owners,
      ...customers.map((c) => c.id),
      ...jobs.map((j) => j.id),
      ...visits,
      ...calls.flatMap((call) => [call.id, call.providerCallId]),
      ...entries,
      ...wording,
      ...dues,
      ...messages.flatMap((message) => [message.id, message.providerId ?? message.id]),
      ...textsIn.flatMap((text) => [text.id, text.providerId]),
    ],
  };
  const [first] = await record.listJobs(db, b);
  if (first === undefined) throw new Error('The second firm has no jobs');
  jobOfB = first;
});

/** Every file the firm has, in both file stores. */
async function filesOf(firm: FirmId): Promise<string[]> {
  return [...(await record.listFiles(withFiles, firm, 'kept')), ...(await record.listFiles(withFiles, firm, 'inbox'))].map((file) => file.key);
}

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
  async findFirmByNumber() {
    // Each number finds its own firm, and only that one.
    expect(await record.findFirmByNumber(db, secondFirmsNumber)).toBe(b);
    expect(await record.findFirmByNumber(db, tidewellsNumber)).toBe(a);
    expect(await record.findFirmByNumber(db, mrsAhmedsMobile)).toBeNull();
  },

  async setDiaryRules() {
    await record.setDiaryRules(db, b, EXAMPLE_DIARY_RULES, frontline);
    expect((await record.getFirm(db, b))?.diaryRules).toEqual(EXAMPLE_DIARY_RULES);
    for (const owner of ofA.owners) {
      await refused(record.setDiaryRules(db, b, null, { kind: 'owner', owner }));
    }
  },
  async findLink() {
    // The fifth record function that takes no firm: the token finds it. It
    // gives the firm the link is for, with ids only.
    const found = await record.findLink(db, ofA.link);
    expect(found?.firm).toBe(a);
    expect(Object.keys(found ?? {}).sort()).toEqual(['customer', 'expiresAt', 'firm', 'job']);
    expect(await record.findLink(db, newId())).toBeNull();
  },

  // The four that find the firm when an owner logs in. Each gives only ids,
  // and is tried here only in ways that leave the first firm as it was.
  async findOwnersByMobile() {
    // Both firms' owners are on Tom's mobile: each found is the firm's own owner.
    const found = await record.findOwnersByMobile(db, ukMobile('07700 900101'));
    expect(found.map((one) => one.firm)).toEqual(expect.arrayContaining([a, b]));
    for (const { firm, owner } of found) {
      expect(await record.getOwner(db, firm, owner)).not.toBeNull();
    }
    expect(Object.keys(found[0] ?? {}).sort()).toEqual(['firm', 'owner']);
    expect(await record.findOwnersByMobile(db, ukMobile('07700 900999'))).toEqual([]);
  },
  async findLoginLink() {
    const found = await record.findLoginLink(db, ofA.login);
    expect(found?.firm).toBe(a);
    expect(Object.keys(found ?? {}).sort()).toEqual(['firm', 'job', 'owner']);
    expect(await record.findLoginLink(db, newId())).toBeNull();
  },
  async logInWithLink() {
    // The second firm's link logs in to the second firm only.
    if (loginOfB === null) throw new Error('No login link');
    const login = await record.logInWithLink(db, loginOfB.login);
    expect(login?.firm).toBe(b);
    nothingOfA(login);
    expect(await record.logInWithLink(db, newId())).toBeNull();
  },
  async findSession() {
    if (loginOfB === null) throw new Error('No login');
    const found = await record.findSession(db, loginOfB.cookie);
    expect(found?.firm).toBe(b);
    nothingOfA(found);
    expect(await record.findSession(db, newId())).toBeNull();
  },
  async endSession() {
    // The first firm's login cannot be ended as the second firm.
    expect(await record.endSession(db, b, ofA.cookie)).toBe(false);
  },
  async createLoginLink() {
    for (const owner of ofA.owners) {
      await refused(record.createLoginLink(db, b, { owner, job: null }));
    }
    const [ownerOfB] = await record.listOwners(db, b);
    if (ownerOfB === undefined) throw new Error('No owner');
    for (const job of ofA.jobs) {
      await refused(record.createLoginLink(db, b, { owner: ownerOfB.id, job: job.id }));
    }
  },
  async countLoginLinks() {
    for (const owner of ofA.owners) {
      expect(await record.countLoginLinks(db, b, owner, allTime[0])).toBe(0);
    }
  },
  async loginLinkForDue() {
    for (const due of ofA.dues) {
      expect(await record.loginLinkForDue(db, b, due)).toBeNull();
    }
  },
  async recordOwnerMessage() {
    for (const owner of ofA.owners) {
      await refused(record.recordOwnerMessage(db, b, owner, 'Hello.'));
    }
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
  async setFirmNumber() {
    await refused(record.setFirmNumber(db, b, tidewellsNumber, frontline));
    expect((await record.getFirm(db, b))?.phoneNumber).toBe(secondFirmsNumber);
    for (const owner of ofA.owners) {
      await refused(record.setFirmNumber(db, b, secondFirmsNumber, { kind: 'owner', owner }));
    }
  },
  async setUrgentList() {
    await record.setUrgentList(db, b, ['a leak', 'no heating'], frontline);
    expect((await record.getFirm(db, b))?.urgentList).toEqual(['a leak', 'no heating']);
    for (const owner of ofA.owners) {
      await refused(record.setUrgentList(db, b, ['a leak'], { kind: 'owner', owner }));
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
  async confirmCustomerDetails() {
    const details = { name: 'Mr Clarke', address: '41 Park Road', email: null };
    for (const customer of ofA.customers) {
      await refused(record.confirmCustomerDetails(db, b, customer.id, jobOfB.id, details));
    }
    for (const job of ofA.jobs) {
      await refused(record.confirmCustomerDetails(db, b, jobOfB.customer, job.id, details));
    }
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

  async findCustomersByLandline() {
    expect((await record.findCustomersByLandline(db, a, mrsHallsLandline)).length).toBeGreaterThan(0);
    const found = await record.findCustomersByLandline(db, b, mrsHallsLandline);
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

  async moveVisit() {
    const to = { startsAt: instantFromIso('2026-10-22T10:00:00+01:00'), endsAt: instantFromIso('2026-10-22T11:00:00+01:00') };
    for (const visit of ofA.visits) {
      expect(await record.moveVisit(db, b, visit, to, frontline, [])).toBe(false);
    }
  },
  async cancelVisit() {
    for (const visit of ofA.visits) {
      expect(await record.cancelVisit(db, b, visit, frontline)).toBe(false);
    }
  },

  async holdTime() {
    // The same call id, and the same time, held by the first firm: the
    // second firm holds its own, and the first firm's is left as it was.
    const held = await record.holdTime(db, b, {
      provider: 'vapi',
      providerCallId: ofA.hold.providerCallId,
      kind: 'quote_visit',
      startsAt: instantFromIso('2026-10-20T10:00:00+01:00'),
      endsAt: instantFromIso('2026-10-20T11:00:00+01:00'),
    });
    expect(held).not.toBeNull();
    expect(held).not.toBe(ofA.hold.id);
  },
  async findHoldForCall() {
    const found = await record.findHoldForCall(db, b, 'vapi', ofA.hold.providerCallId);
    expect(found?.id).not.toBe(ofA.hold.id);
    nothingOfA(found);
  },
  async releaseHold() {
    expect(await record.releaseHold(db, b, ofA.hold.id)).toBe(false);
  },
  async listTakenTimes() {
    const taken = await record.listTakenTimes(db, b, ...allTime);
    expect(taken.length).toBeGreaterThan(0);
    nothingOfA(taken);
  },

  async linkForDue() {
    const [customerOfB] = await record.listCustomers(db, b);
    const [dueOfB] = (await record.listMessagesBetween(db, b, ...allTime)).map((message) => message.due);
    if (customerOfB === undefined || dueOfB === undefined) throw new Error('The second firm has no customer or texts');
    for (const due of ofA.dues) {
      await refused(record.linkForDue(db, b, { due, customer: jobOfB.customer, job: jobOfB.id }));
    }
    for (const job of ofA.jobs) {
      await refused(record.linkForDue(db, b, { due: dueOfB, customer: job.customer, job: job.id }));
    }
  },

  async listVisitsFrom() {
    const visits = await record.listVisitsFrom(db, b, allTime[0]);
    expect(visits.length).toBeGreaterThan(0);
    nothingOfA(visits);
  },

  async recordCall() {
    // A call to the second firm from Mrs Ahmed's mobile makes its own customer.
    const made = await record.recordCall(
      db,
      b,
      newCall({
        kind: 'new_customer',
        name: 'Mrs Ahmed',
        mobile: mrsAhmedsMobile,
        landline: null,
        noText: null,
        about: 'Boiler replacement',
        place: '27 Station Road',
      }),
    );
    nothingOfA(await record.getCall(db, b, made.call));
    // It cannot open a job for the first firm's customer.
    for (const customer of ofA.customers) {
      await refused(
        record.recordCall(
          db,
          b,
          newCall({ kind: 'customer', customer: customer.id, about: 'Boiler replacement', place: '27 Station Road' }),
        ),
      );
    }
    // Nor take a call the first firm holds.
    for (const call of ofA.calls) {
      await refused(record.recordCall(db, b, { ...newCall({ kind: 'details_missing' }), providerCallId: call.providerCallId }));
    }
  },
  async findCallByProviderId() {
    for (const call of ofA.calls) {
      expect(await record.findCallByProviderId(db, b, 'vapi', call.providerCallId)).toBeNull();
    }
  },
  async getCall() {
    for (const call of ofA.calls) {
      expect(await record.getCall(db, b, call.id)).toBeNull();
    }
  },
  async listCallsBetween() {
    const calls = await record.listCallsBetween(db, b, ...allTime);
    expect(calls.length).toBeGreaterThan(0);
    nothingOfA(calls);
  },
  async markCallBooked() {
    const [callOfB] = await record.listCallsBetween(db, b, ...allTime);
    if (callOfB === undefined) throw new Error('The second firm has no calls');
    for (const call of ofA.calls) {
      for (const visit of ofA.visits) {
        await refused(record.markCallBooked(db, b, call.id, visit));
      }
    }
    for (const visit of ofA.visits) {
      await refused(record.markCallBooked(db, b, callOfB.id, visit));
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

  async setOwnerMobile() {
    const [ownerOfB] = await record.listOwners(db, b);
    if (ownerOfB === undefined) throw new Error('The second firm has no owner');
    await record.setOwnerMobile(db, b, ownerOfB.id, ukMobile('07700 900101'), frontline);
    for (const owner of ofA.owners) {
      await refused(record.setOwnerMobile(db, b, owner, ukMobile('07700 900102'), frontline));
      await refused(record.setOwnerMobile(db, b, ownerOfB.id, ukMobile('07700 900102'), { kind: 'owner', owner }));
    }
  },

  async setWording() {
    await record.setWording(db, b, 'text:visit_reminder', "Reminder: Tom's visit is tomorrow, {weekday}, at {time}.", frontline);
    for (const owner of ofA.owners) {
      await refused(record.setWording(db, b, 'text:visit_reminder', 'Reminder: {time}.', { kind: 'owner', owner }));
    }
  },
  async firmWording() {
    const words = await record.firmWording(db, b);
    expect(Object.keys(words).length).toBeGreaterThan(0);
    nothingOfA(words);
  },

  async optOut() {
    for (const customer of ofA.customers) {
      await refused(record.optOut(db, b, customer.id, 'every', frontline));
    }
  },
  async optIn() {
    for (const customer of ofA.customers) {
      await refused(record.optIn(db, b, customer.id, 'every', frontline));
    }
  },
  async optOutNumber() {
    await record.optOutNumber(db, b, ukMobile('07700 900015'));
    expect(await record.isNumberOptedOut(db, b, ukMobile('07700 900015'))).toBe(true);
  },
  async isNumberOptedOut() {
    expect(await record.isNumberOptedOut(db, a, mrsAhmedsMobile)).toBe(true);
    expect(await record.isNumberOptedOut(db, b, mrsAhmedsMobile)).toBe(false);
  },
  async listOptOuts() {
    for (const customer of ofA.customers) {
      expect(await record.listOptOuts(db, b, customer.id)).toEqual([]);
    }
  },

  async addDue() {
    for (const visit of ofA.visits) {
      await refused(record.addDue(db, b, { action: 'send_reminder', visit, runAt: clock.now(), latestAt: far }));
    }
    for (const call of ofA.calls) {
      await refused(record.addDue(db, b, { action: 'alert_owner', call: call.id, runAt: clock.now(), latestAt: far }));
    }
  },
  async findDue() {
    // The one record function besides the three for firms that takes no
    // firm. Each row it gives is the firm's it says, and it gives only ids.
    await record.addDue(db, b, { action: 'send_reminder', runAt: clock.now(), latestAt: far });
    const found = await record.findDue(db);
    expect(found.length).toBeGreaterThan(0);
    for (const { firm, due } of found) {
      expect(firm).not.toBe(a);
      expect(await record.getDue(db, firm, due)).not.toBeNull();
      expect(Object.keys(found[0] ?? {}).sort()).toEqual(['due', 'firm']);
    }
  },
  async claimDue() {
    // Far enough on that every waiting row is due and every claim has run
    // out: without the firm in its query, this would win the first firm's.
    const later = openRecord(env.DB, pretendClock(far));
    for (const due of ofA.dues) {
      expect(await record.claimDue(later, b, due)).toBeNull();
    }
  },
  async finishDue() {
    // With the first firm's own claim: only the firm stops it.
    expect(await record.finishDue(db, b, ofA.held.due, ofA.held.claim, 'sent')).toBe(false);
    for (const due of ofA.dues) {
      expect(await record.finishDue(db, b, due, newId(), 'sent')).toBe(false);
    }
  },
  async releaseDue() {
    expect(await record.releaseDue(db, b, ofA.held.due, ofA.held.claim)).toBe(false);
    expect(await record.releaseDue(db, b, ofA.held.due, ofA.held.claim, far)).toBe(false);
    for (const due of ofA.dues) {
      expect(await record.releaseDue(db, b, due, newId())).toBe(false);
    }
  },
  async cancelDue() {
    for (const due of ofA.dues) {
      expect(await record.cancelDue(db, b, due)).toBe(false);
    }
  },
  async getDue() {
    for (const due of ofA.dues) {
      expect(await record.getDue(db, b, due)).toBeNull();
    }
  },
  async listDueForVisit() {
    for (const visit of ofA.visits) {
      expect(await record.listDueForVisit(db, b, visit)).toEqual([]);
    }
  },
  async listDueForCall() {
    for (const call of ofA.calls) {
      expect(await record.listDueForCall(db, b, call.id)).toEqual([]);
    }
  },

  async claimMessage() {
    const [dueOfB] = (await record.listMessagesBetween(db, b, ...allTime)).map((message) => message.due);
    if (dueOfB === undefined) throw new Error('The second firm has no texts');
    const about = { job: null, visit: null, call: null };
    // A text to the first firm's customer or owner, for the first firm's
    // row in the due list, or about the first firm's job.
    for (const customer of ofA.customers) {
      await refused(
        record.claimMessage(db, b, { due: dueOfB, kind: 'visit_reminder', to: { kind: 'customer', customer: customer.id }, about, going: null, notSent: 'no_wording' }),
      );
    }
    for (const owner of ofA.owners) {
      await refused(
        record.claimMessage(db, b, { due: dueOfB, kind: 'urgent_alert', to: { kind: 'owner', owner }, about, going: null, notSent: 'no_wording' }),
      );
    }
    const [ownerOfB] = await record.listOwners(db, b);
    if (ownerOfB === undefined) throw new Error('The second firm has no owner');
    for (const due of ofA.dues) {
      await refused(
        record.claimMessage(db, b, { due, kind: 'urgent_alert', to: { kind: 'owner', owner: ownerOfB.id }, about, going: null, notSent: 'no_wording' }),
      );
    }
    for (const job of ofA.jobs) {
      await refused(
        record.claimMessage(db, b, { due: dueOfB, kind: 'urgent_alert', to: { kind: 'owner', owner: ownerOfB.id }, about: { ...about, job: job.id }, going: null, notSent: 'no_wording' }),
      );
    }
  },
  async listMessagesForJob() {
    for (const job of ofA.jobs) {
      expect(await record.listMessagesForJob(db, b, job.id)).toEqual([]);
    }
  },
  async findMessageForDue() {
    for (const message of ofA.messages) {
      expect(await record.findMessageForDue(db, b, message.due, message.to)).toBeNull();
    }
  },
  async hasTextedCustomer() {
    // The first firm has texted its Mr Clarke. Asked as the second firm,
    // none of the first firm's customers has been texted.
    for (const customer of ofA.customers) {
      expect(await record.hasTextedCustomer(db, b, customer.id)).toBe(false);
    }
  },
  async getMessage() {
    for (const message of ofA.messages) {
      expect(await record.getMessage(db, b, message.id)).toBeNull();
    }
  },
  async listMessagesBetween() {
    const messages = await record.listMessagesBetween(db, b, ...allTime);
    expect(messages.length).toBeGreaterThan(0);
    nothingOfA(messages);
  },
  async markMessageSent() {
    for (const message of ofA.messages) {
      await refused(record.markMessageSent(db, b, message.id, 'fake', `fake-${newId()}`));
    }
  },
  async markMessageFailed() {
    for (const message of ofA.messages) {
      await refused(record.markMessageFailed(db, b, message.id, 'unclear', null));
    }
  },
  async recordDelivery() {
    for (const message of ofA.messages) {
      if (message.providerId === null) continue;
      expect(await record.recordDelivery(db, b, 'fake', message.providerId, { delivered: false, errorCode: 30003 })).toBeNull();
    }
  },

  async recordTextIn() {
    // A text to the second firm from Mrs Ahmed's mobile lands on its own Mrs Ahmed.
    const landed = await record.recordTextIn(db, b, { provider: 'fake', providerId: `in-${newId()}`, from: mrsAhmedsMobile, words: 'Thank you.', consent: null });
    nothingOfA(landed);
    expect(landed).toMatchObject({ result: 'stored' });
    // A STOP to the second firm from Mrs Ahmed's mobile opts out only the
    // second firm's customers on it.
    const stopped = await record.recordTextIn(db, b, { provider: 'fake', providerId: `in-${newId()}`, from: mrsAhmedsMobile, words: 'STOP', consent: 'stop' });
    nothingOfA(stopped);
    expect(stopped).toMatchObject({ result: 'stored' });
    expect(stopped.result === 'stored' ? stopped.consented.length : 0).toBeGreaterThan(0);
    // Nor can it take a text the first firm holds.
    for (const text of ofA.textsIn) {
      await refused(record.recordTextIn(db, b, { provider: text.provider, providerId: text.providerId, from: mrsAhmedsMobile, words: 'STOP', consent: 'stop' }));
    }
  },
  async listTextsInBetween() {
    const texts = await record.listTextsInBetween(db, b, ...allTime);
    expect(texts.length).toBeGreaterThan(0);
    nothingOfA(texts);
  },

  // The control room. Staff belong to no firm, and the list of firms is how
  // staff choose one: both take no firm. Everything else takes the firm and
  // finds nothing of the first firm's under the second's.
  async findOrAddStaff() {
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    expect(await record.findOrAddStaff(db, 'STAFF@example.com ')).toEqual(staff);
    nothingOfA(staff);
  },
  async listFirms() {
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    const firms = await record.listFirms(db, staff.id);
    expect(firms.map((firm) => firm.id)).toEqual(expect.arrayContaining([a, b]));
  },
  async logStaff() {
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    // A row about the first firm's customer, under the second firm, is refused.
    for (const customer of ofA.customers) {
      await refused(record.logStaff(db, b, staff.id, 'viewed_customer', { customer: customer.id }));
    }
    nothingOfA(await record.logStaff(db, b, staff.id, 'viewed_firm'));
  },
  async findCustomers() {
    for (const typed of ['Mrs Ahmed', '07700 900003', 'mr', '01632 960001']) {
      const found = await record.findCustomers(db, b, typed);
      expect(found.length).toBeGreaterThan(0);
      nothingOfA(found);
    }
  },
  async listOwnerMessages() {
    const messages = await record.listOwnerMessages(db, b);
    expect(messages.length).toBeGreaterThan(0);
    nothingOfA(messages);
  },
  async listFailedTexts() {
    nothingOfA(await record.listFailedTexts(db, b, allTime[0]));
  },
  async needsALook() {
    nothingOfA(await record.needsALook(db, b, allTime[0]));
  },
  async customerFile() {
    for (const customer of ofA.customers) {
      expect(await record.customerFile(db, b, customer.id)).toBeNull();
    }
    nothingOfA(await record.customerFile(db, b, jobOfB.customer));
  },
  async customerFileCounts() {
    for (const customer of ofA.customers) {
      expect(await record.customerFileCounts(db, b, customer.id)).toBeNull();
    }
  },
  async deleteCustomer() {
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    for (const customer of ofA.customers) {
      expect(await record.deleteCustomer(db, b, customer.id, staff.id, customer.name)).toBeNull();
    }
  },
  async setExampleClock() {
    // The second firm is not an example, and its clock cannot move; the
    // first firm's is untouched.
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    await refused(record.setExampleClock(db, b, far, staff.id, 'move_on'));
    await refused(record.setExampleClock(db, b, far, staff.id, 'start'));
  },
  async deleteExampleFirm() {
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    await refused(record.deleteExampleFirm(db, b, staff.id));
  },
  async redoCustomerDelete() {
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    for (const customer of ofA.customers) {
      expect(await record.redoCustomerDelete(withFiles, b, customer.id, staff.id)).toBeNull();
    }
  },
  async logStaffAcrossFirms() {
    // A view across every firm names no firm, and changes no firm's rows.
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    await record.logStaffAcrossFirms(db, staff.id, 'viewed_after_restore');
  },

  // Keeping and deleting (slice H). The first firm's call, recording and
  // export, named under the second firm, are not found, and its files stay.
  async getCallRecording() {
    expect(await record.getCallRecording(db, b, ofA.recorded)).toBeNull();
  },
  async readCallRecording() {
    expect(await record.readCallRecording(withFiles, b, ofA.recorded)).toBeNull();
  },
  async moveRecording() {
    expect(await record.moveRecording(withFiles, b, ofA.recorded)).toBe('nothing_to_do');
  },
  async giveUpRecording() {
    await record.giveUpRecording(withFiles, b, ofA.recorded);
  },
  async deleteRecording() {
    expect(await record.deleteRecording(withFiles, b, ofA.recorded)).toBe('nothing_to_do');
  },
  async markMissingRecordings() {
    expect(await record.markMissingRecordings(withFiles, b)).toBe(0);
  },
  async emptyBin() {
    await record.emptyBin(withFiles, b);
  },
  async sweepFirm() {
    // Run years on, a firm of the same shape as the first has its sweep
    // delete what is its own, and nothing of the first firm's. (Not the
    // second firm, whose shape the last test checks.)
    const third = await loadExample(env.DB, { name: 'Third Example Firm', isExample: false, number: '07700 900301' });
    const later = openRecord(env.DB, pretendClock(instantFromIso('2030-01-01T03:15:00Z')), testDeps(clock).files);
    const swept = await record.sweepFirm(later, third);
    expect(swept.counts.customers).toBeGreaterThan(0);
  },
  async addMissingSweeps() {
    // A record function that takes no firm: the clock gives every firm its
    // sweep. The first firm has one, so none is added for it.
    const added = await record.addMissingSweeps(db);
    nothingOfA(added);
  },
  async listFiles() {
    for (const store of ['kept', 'inbox'] as const) {
      const files = await record.listFiles(withFiles, b, store);
      nothingOfA(files);
      for (const file of files) expect(file.key.startsWith(`firms/${b}/`)).toBe(true);
    }
  },
  async placeInInbox() {
    // A name under the first firm's path, given as the second firm, is refused.
    await expect(record.placeInInbox(withFiles, b, `firms/${a}/stolen.mp3`, new Uint8Array(1))).rejects.toThrow(RangeError);
  },
  async ledgerSince() {
    // The fifteenth: the deletes to do again after a restore, across firms, by id.
    nothingOfA(await record.ledgerSince(withFiles, allTime[0]));
  },
  async askFirmExport() {
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    const made = await record.askFirmExport(db, b, staff.id);
    expect((await record.listFirmExports(db, b)).map((one) => one.id)).toContain(made);
  },
  async listFirmExports() {
    const exports = await record.listFirmExports(db, b);
    expect(exports.length).toBeGreaterThan(0);
    nothingOfA(exports);
  },
  async exportToMake() {
    expect(await record.exportToMake(db, b)).not.toBe(ofA.export);
  },
  async firmTablePage() {
    for (const table of EXPORTED_TABLES) {
      nothingOfA(await record.firmTablePage(db, b, table, 0, 1_000));
    }
  },
  async openFirmExportFile() {
    await refused(record.openFirmExportFile(withFiles, b, ofA.export));
  },
  async markFirmExportReady() {
    await refused(record.markFirmExportReady(db, b, ofA.export, 10));
  },
  async downloadFirmExport() {
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    expect(await record.downloadFirmExport(withFiles, b, ofA.export, staff.id)).toBeNull();
  },
  async markLeaving() {
    // The first firm's name, given as the second firm, is not its name.
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    await refused(record.markLeaving(db, b, staff.id, 'Tidewell Heating'));
  },
  async cancelLeaving() {
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    await refused(record.cancelLeaving(db, b, staff.id));
  },
  async deleteFirm() {
    // The second firm is not leaving: nothing of it goes, and nothing of the first.
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    await refused(record.deleteFirm(withFiles, b, staff.id, 'Second Example Firm'));
    expect(await record.getFirm(db, b)).not.toBeNull();
  },
  async deleteLeftFirm() {
    expect(await record.deleteLeftFirm(withFiles, b)).toBe('nothing_to_do');
  },
  async redoFirmDelete() {
    // Done again for a third firm, it deletes that firm alone.
    const third = await loadExample(env.DB, { name: 'Third Example Firm', isExample: false, number: '07700 900300' });
    const staff = await record.findOrAddStaff(db, 'staff@example.com');
    expect(await record.redoFirmDelete(withFiles, third, staff.id)).toBe('deleted');
    expect(await record.getFirm(db, third)).toBeNull();
  },
  async wasFirmDeleted() {
    expect(await record.wasFirmDeleted(db, b)).toBeNull();
  },
};

describe('the wall between firms', () => {
  it('has a case for every record function', () => {
    expect(Object.keys(cases).sort()).toEqual(Object.keys(record).sort());
  });

  it('has every record function take the firm, apart from the three that find or make a firm, the clock’s two, the link’s, the four of logging in, the control room’s three: staff, the list of firms and a view across firms, and the restore ledger', () => {
    type NotTakingTheFirm = {
      [Name in keyof typeof record]: Parameters<(typeof record)[Name]> extends [RecordDb, FirmId, ...unknown[]]
        ? never
        : Name;
    }[keyof typeof record];
    expectTypeOf<NotTakingTheFirm>().toEqualTypeOf<
      | 'createFirm'
      | 'exampleFirms'
      | 'findFirmByNumber'
      | 'findDue'
      | 'findLink'
      | 'findOwnersByMobile'
      | 'findLoginLink'
      | 'logInWithLink'
      | 'findSession'
      | 'findOrAddStaff'
      | 'listFirms'
      | 'logStaffAcrossFirms'
      | 'addMissingSweeps'
      | 'ledgerSince'
    >();
  });

  it.each(Object.keys(cases) as (keyof typeof record)[])(
    '%s, used as another firm, finds nothing of this firm and changes nothing',
    async (name) => {
      const before = await firmRows(env.DB, a);
      const filesBefore = await filesOf(a);
      await cases[name]();
      expect(await firmRows(env.DB, a)).toEqual(before);
      expect(await filesOf(a)).toEqual(filesBefore);
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

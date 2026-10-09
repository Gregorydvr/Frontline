// A call lands in the record (slice C, and steps 5 and 6 of the acceptance
// story apart from the alert). The example reports in test/fixtures/vapi/
// are sent through the real address, as Vapi sends them, with a pretend
// clock. Then the record and the history are checked.

import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { historyLine } from '../src/history-lines';
import { jobState } from '../src/job-state';
import { ukMobile } from '../src/phone';
import { runDue } from '../src/due';
import {
  getCall,
  historyBetween,
  historyForCustomer,
  historyForJob,
  listCallsBetween,
  listCustomers,
  listDueForCall,
  listJobs,
  listMessagesBetween,
  listOwners,
  listVisitsForJob,
  setOwnerMobile,
  setService,
  setStopButton,
} from '../src/record';
import { openRecord } from '../src/record/db';
import type { FirmId } from '../src/record/types';
import { firmRows } from './helpers/db';
import { testDeps } from './helpers/deps';
import { asAnotherCall, report, send, tidewell, TOMS_MOBILE, withDetails, type Report, type ReportName } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-10-15T15:45:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const app = createApp(() => deps);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;

// Each test has a firm of its own, on a number of its own.
let firm: FirmId;
let number: string;
let numbers = 500;

beforeEach(async () => {
  numbers += 1;
  number = `+447700900${String(numbers)}`;
  firm = await tidewell(db, number);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * An example report, rung to this test's firm. Vapi's id for a call is held
 * only once, whichever firm it is for, so each test gives the call its own.
 */
function to(name: ReportName): Report {
  const body = report(name, number);
  const call = body.message.call as { id: string };
  return asAnotherCall(body, `${call.id}-${String(numbers)}`);
}

async function calls() {
  return listCallsBetween(db, firm, ...allTime);
}

/** The history the call wrote: everything but the firm's set-up. */
async function callHistory(): Promise<string[]> {
  const entries = await historyBetween(db, firm, ...allTime);
  return entries.map((entry) => entry.kind).filter((kind) => !['firm_added', 'owner_added', 'wording_agreed', 'number_set', 'urgent_list_set', 'diary_rules_set', 'service_on'].includes(kind));
}

describe('a call from someone who is not a customer (step 5)', () => {
  it('becomes a call with a message, with no customer and no job', async () => {
    const answer = await send(app, to('supplier'));
    expect(answer.status).toBe(200);

    expect(await listCustomers(db, firm)).toEqual([]);
    expect(await listJobs(db, firm)).toEqual([]);
    const [call, ...others] = await calls();
    expect(others).toEqual([]);
    expect(call).toEqual({
      id: call?.id,
      provider: 'vapi',
      providerCallId: `1f6c3a52-8e47-4b1d-9a3f-0c7e2d5b8a61-${String(numbers)}`,
      startedAt: instantFromIso('2026-10-15T08:26:05.120+01:00'),
      endedAt: instantFromIso('2026-10-15T08:27:31.904+01:00'),
      from: '+447700900300',
      customer: null,
      job: null,
      visit: null,
      outcome: 'message',
      urgentItem: null,
      caller: 'a supplier',
      summary: 'Your order is ready to collect.',
      createdAt: clock.now(),
    });
    expect(await callHistory()).toEqual(['message_taken']);
  });

  it('reads in Done for you as the example has it', async () => {
    await send(app, to('supplier'));
    const lines = (await historyBetween(db, firm, ...allTime)).map((entry) => historyLine(entry, 'feed'));
    expect(lines).toContain('Call from a supplier. Your order is ready to collect.');
  });
});

describe('an urgent call (step 6)', () => {
  it('makes one customer, one job marked urgent, and an urgent call, with no visit', async () => {
    expect((await send(app, to('mr-price-leak'))).status).toBe(200);

    const customers = await listCustomers(db, firm);
    expect(customers).toEqual([
      {
        id: customers[0]?.id,
        name: 'Mr Price',
        mobile: '+447700900016',
        landline: null,
        noText: null,
        // The address taken on the call, which the customer can correct from their link.
        address: '6 Bridge Street',
        email: null,
        detailsConfirmedAt: null,
        createdAt: clock.now(),
      },
    ]);
    const [job] = await listJobs(db, firm);
    expect(job).toMatchObject({
      customer: customers[0]?.id,
      about: 'Leak under the sink',
      place: '6 Bridge Street',
      urgent: true,
    });
    if (job === undefined) throw new Error('No job');
    expect(await listVisitsForJob(db, firm, job.id)).toEqual([]);
    expect(jobState(job, [], clock.now())).toBe('urgent');

    const [call] = await calls();
    expect(call).toMatchObject({
      outcome: 'urgent',
      urgentItem: 'a leak',
      customer: { id: customers[0]?.id, name: 'Mr Price' },
      job: job.id,
      visit: null,
      caller: null,
      summary: 'A leak under the kitchen sink.',
    });
  });

  it('alerts the owner at once, before Vapi has its answer, from the firm’s number, with a link to the job', async () => {
    const sentBefore = deps.texts.sent.length;
    expect((await send(app, to('mr-price-leak'))).status).toBe(200);

    const [job] = await listJobs(db, firm);
    if (job === undefined) throw new Error('No job');
    expect(deps.texts.sent.slice(sentBefore)).toEqual([
      {
        from: number,
        to: TOMS_MOBILE,
        body: `Front-line: urgent call from Mr Price, 6 Bridge Street. A leak under the kitchen sink. Their number: 07700 900016. https://app.example/jobs/${job.id}`,
        providerId: expect.stringMatching(/^fake-/) as unknown,
      },
    ]);
    const [message] = await listMessagesBetween(db, firm, ...allTime);
    expect(message).toMatchObject({
      kind: 'urgent_alert',
      state: 'sent',
      toNumber: TOMS_MOBILE,
      fromNumber: number,
      segments: 2,
      sentAt: clock.now(),
    });
  });

  it('alerts the owner as before, with no link, while this copy has no address for the app', async () => {
    const sentBefore = deps.texts.sent.length;
    const noAddress = createApp(() => ({ ...deps, appAddress: null }));
    expect((await send(noAddress, to('mr-price-leak'))).status).toBe(200);

    expect(deps.texts.sent.slice(sentBefore).map((text) => text.body)).toEqual([
      'Front-line: urgent call from Mr Price, 6 Bridge Street. A leak under the kitchen sink. Their number: 07700 900016.',
    ]);
    expect(await listMessagesBetween(db, firm, ...allTime)).toMatchObject([{ kind: 'urgent_alert', state: 'sent', segments: 1 }]);
  });

  it('writes the call answered and the details taken, then "passed straight to you" once the alert has gone', async () => {
    await send(app, to('mr-price-leak'));
    const [job] = await listJobs(db, firm);
    const [call] = await calls();
    if (job === undefined || call === undefined) throw new Error('No job or call');

    expect(await callHistory()).toEqual(['call_answered', 'details_taken', 'passed_to_owner']);
    const forJob = await historyForJob(db, firm, job.id);
    expect(forJob.map((entry) => [entry.kind, entry.call?.id ?? null])).toEqual([
      ['call_answered', call.id],
      ['passed_to_owner', null],
    ]);
    expect(forJob.map((entry) => historyLine(entry, 'job'))).toEqual(['Answered the call.', 'Passed straight to you.']);
    const feed = (await historyBetween(db, firm, ...allTime)).map((entry) => historyLine(entry, 'feed'));
    expect(feed).toContain('Call from Mr Price. Passed straight to you.');
  });

  it('does not say "passed straight to you" when the alert could not go, and keeps the call', async () => {
    deps.texts.willAnswer('refused');
    expect((await send(app, to('mr-price-leak'))).status).toBe(200);

    expect(await callHistory()).toEqual(['call_answered', 'details_taken']);
    expect(await listMessagesBetween(db, firm, ...allTime)).toMatchObject([{ kind: 'urgent_alert', state: 'failed', reason: 'refused' }]);
    expect(await calls()).toMatchObject([{ outcome: 'urgent' }]);
  });

  it('sends no alert to an owner with no mobile, and records why', async () => {
    const [tom] = await listOwners(db, firm);
    if (tom === undefined) throw new Error('No owner');
    await setOwnerMobile(db, firm, tom.id, null, { kind: 'frontline' });
    const sentBefore = deps.texts.sent.length;
    await send(app, to('mr-price-leak'));

    expect(deps.texts.sent.length).toBe(sentBefore);
    expect(await listMessagesBetween(db, firm, ...allTime)).toMatchObject([
      { kind: 'urgent_alert', state: 'not_sent', reason: 'no_mobile', words: null },
    ]);
    expect(await callHistory()).not.toContain('passed_to_owner');
  });

  it('still alerts the owner with the stop button on, which is for texts to customers', async () => {
    await setStopButton(db, firm, true, { kind: 'frontline' });
    await send(app, to('mr-price-leak'));
    expect(await listMessagesBetween(db, firm, ...allTime)).toMatchObject([{ kind: 'urgent_alert', state: 'sent' }]);
  });

  it('writes the alert with the call, in the same step, and it cannot go twice when run again', async () => {
    await send(app, to('mr-price-leak'));
    const [call] = await calls();
    if (call === undefined) throw new Error('No call');
    const [alert, ...others] = await listDueForCall(db, firm, call.id);
    expect(others).toEqual([]);
    expect(alert).toMatchObject({ action: 'alert_owner', state: 'done', outcome: 'sent', runAt: clock.now() });

    const sentBefore = deps.texts.sent.length;
    if (alert === undefined) throw new Error('No alert');
    expect(await runDue(db, deps, firm, alert.id)).toEqual({ ran: 'not_ours' });
    expect(deps.texts.sent.length).toBe(sentBefore);
  });

  it('is urgent whatever capitals and spaces the agent used for the item', async () => {
    await send(app, withDetails(to('mr-price-leak'), (data) => ({ ...data, urgentMatch: '  A   Leak ' })));
    expect(await calls()).toMatchObject([{ outcome: 'urgent', urgentItem: 'a leak' }]);
  });

  it('is not urgent when the item is not on the firm’s list, and staff can see why from the log', async () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await send(app, withDetails(to('mr-price-leak'), (data) => ({ ...data, urgentMatch: 'a broken tap' })));

    const [call] = await calls();
    expect(call).toMatchObject({ outcome: 'message', urgentItem: null });
    expect((await listJobs(db, firm))[0]?.urgent).toBe(false);
    expect(logged.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown)).toContainEqual({
      firm,
      call: call?.id,
      event: 'urgent_not_on_list',
    });
  });
});

describe('the same report twice', () => {
  it('makes one call when it comes again later', async () => {
    expect((await send(app, to('mr-price-leak'))).status).toBe(200);
    const before = await firmRows(env.DB, firm);
    clock.advance(60_000);
    expect((await send(app, to('mr-price-leak'))).status).toBe(200);
    expect(await firmRows(env.DB, firm)).toEqual(before);
  });

  it('makes one call when copies arrive at the same moment', async () => {
    const answers = await Promise.all([1, 2, 3].map(() => send(app, to('mr-price-leak'))));
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    expect(await calls()).toHaveLength(1);
    expect(await listCustomers(db, firm)).toHaveLength(1);
    expect(await listJobs(db, firm)).toHaveLength(1);
    expect(await callHistory()).toEqual(['call_answered', 'details_taken', 'passed_to_owner']);
    // And one alert to the owner.
    expect(await listMessagesBetween(db, firm, ...allTime)).toHaveLength(1);
  });
});

describe('finding the customer', () => {
  it('finds a customer by their mobile and name, and opens a new job for the new call', async () => {
    await send(app, to('mr-price-leak'));
    await send(app, asAnotherCall(to('mr-price-leak'), `second-call-${String(numbers)}`));

    const customers = await listCustomers(db, firm);
    expect(customers).toHaveLength(1);
    expect(await listJobs(db, firm)).toHaveLength(2);
    expect(await calls()).toHaveLength(2);
    // Their details were taken once, on the first call. Each call, being
    // urgent, was passed to the owner.
    expect((await historyForCustomer(db, firm, customers[0]?.id as never)).map((entry) => entry.kind)).toEqual([
      'call_answered',
      'details_taken',
      'passed_to_owner',
      'call_answered',
      'passed_to_owner',
    ]);
  });

  it('makes a new customer for another name on the same mobile, rather than mixing two people up', async () => {
    await send(app, to('mr-price-leak'));
    clock.advance(60_000);
    await send(
      app,
      withDetails(asAnotherCall(to('mr-price-leak'), `second-call-${String(numbers)}`), (data) => ({
        ...data,
        name: 'Mrs Price',
      })),
    );
    const customers = await listCustomers(db, firm);
    expect(customers.map((customer) => [customer.name, customer.mobile])).toEqual([
      ['Mr Price', '+447700900016'],
      ['Mrs Price', '+447700900016'],
    ]);
  });

  it('keeps a landline, marks that no text can reach them, and finds them by it next time', async () => {
    await send(app, to('landline-caller'));
    const [customer, ...others] = await listCustomers(db, firm);
    expect(others).toEqual([]);
    expect(customer).toMatchObject({ name: 'Mrs Hall', mobile: null, landline: '+441632960001', noText: 'landline' });
    expect(await calls()).toMatchObject([{ from: '+441632960001', outcome: 'message' }]);

    await send(app, asAnotherCall(to('landline-caller'), `second-call-${String(numbers)}`));
    expect(await listCustomers(db, firm)).toHaveLength(1);
    expect(await listJobs(db, firm)).toHaveLength(2);
  });

  it('makes a customer without a mobile for a withheld number, marked, and cannot find them again', async () => {
    await send(app, to('withheld-caller'));
    expect(await listCustomers(db, firm)).toMatchObject([
      { name: 'Ms Rowe', mobile: null, landline: null, noText: 'withheld' },
    ]);
    expect(await calls()).toMatchObject([{ from: null, customer: { name: 'Ms Rowe' } }]);

    await send(app, asAnotherCall(to('withheld-caller'), `second-call-${String(numbers)}`));
    expect(await listCustomers(db, firm)).toHaveLength(2);
  });

  it.each([
    ['"anonymous"', 'anonymous'],
    ['a number from another country', '+33612345678'],
    ['a number that is not a phone number', '+266696687'],
  ])('counts %s as withheld', async (_, from) => {
    const body = to('withheld-caller');
    body.message.customer = { number: from };
    await send(app, body);
    expect(await listCustomers(db, firm)).toMatchObject([{ mobile: null, landline: null, noText: 'withheld' }]);
    expect(await calls()).toMatchObject([{ from: null }]);
  });
});

describe('a call with its details missing', () => {
  it('is kept with the number it came from, and no customer or job, when the details did not come through', async () => {
    expect((await send(app, to('hang-up'))).status).toBe(200);
    expect(await listCustomers(db, firm)).toEqual([]);
    expect(await listJobs(db, firm)).toEqual([]);
    expect(await calls()).toMatchObject([
      { from: '+447700900400', customer: null, job: null, caller: null, summary: null, outcome: 'message' },
    ]);
    const entries = (await historyBetween(db, firm, ...allTime)).filter((entry) => entry.kind === 'details_missing');
    expect(entries).toHaveLength(1);
    expect(historyLine(entries[0] as never, 'feed')).toBe('Call from 07700 900400. Details missing.');
  });

  it.each([
    ['no name', { name: undefined }],
    ['no address', { address: undefined }],
    ['nothing about the job', { about: '' }],
    ['a name that is not text', { name: 42 }],
    ['an address far too long', { address: 'x'.repeat(500) }],
    ['a caller type the agent made up', { callerType: 'friend' }],
  ])('is a call with details missing when the agent gave %s', async (_, change) => {
    await send(app, withDetails(to('landline-caller'), (data) => ({ ...data, ...change })));
    expect(await listCustomers(db, firm)).toEqual([]);
    expect(await calls()).toMatchObject([{ customer: null, job: null, caller: null }]);
    expect(await callHistory()).toEqual(['details_missing']);
  });

  it('is still urgent when the item is on the list, though the address is missing', async () => {
    await send(app, withDetails(to('mr-price-leak'), (data) => ({ ...data, address: undefined })));
    expect(await calls()).toMatchObject([{ customer: null, outcome: 'urgent', urgentItem: 'a leak' }]);
  });

  it('still alerts the owner at once, saying not all the details came through', async () => {
    const sentBefore = deps.texts.sent.length;
    await send(app, withDetails(to('mr-price-leak'), (data) => ({ ...data, address: undefined })));

    expect(deps.texts.sent.slice(sentBefore).map((text) => [text.to, text.body])).toEqual([
      [TOMS_MOBILE, 'Front-line: urgent call. Not all their details came through. A leak under the kitchen sink. Their number: 07700 900016.'],
    ]);
    const [call] = await calls();
    if (call === undefined) throw new Error('No call');
    expect(await listDueForCall(db, firm, call.id)).toMatchObject([{ action: 'alert_owner', state: 'done', outcome: 'sent' }]);
    expect(await listMessagesBetween(db, firm, ...allTime)).toMatchObject([
      { kind: 'urgent_alert_details_missing', state: 'sent', job: null, call: call.id },
    ]);
    // There is no job, so nowhere to say it was passed on.
    expect(await callHistory()).toEqual(['details_missing']);
  });

  it('ends the line about the call as a sentence before the number', async () => {
    const sentBefore = deps.texts.sent.length;
    await send(app, withDetails(to('mr-price-leak'), (data) => ({ ...data, summary: 'Water all over the kitchen floor' })));
    expect(deps.texts.sent[sentBefore]?.body).toMatch(
      /^Front-line: urgent call from Mr Price, 6 Bridge Street\. Water all over the kitchen floor\. Their number: 07700 900016\. https:\/\/app\.example\/jobs\/[0-9a-z]{26}$/,
    );
  });

  it('keeps a customer’s call without its summary when the summary is not usable', async () => {
    await send(app, withDetails(to('landline-caller'), (data) => ({ ...data, summary: 'Too long. '.repeat(40) })));
    expect(await calls()).toMatchObject([{ customer: { name: 'Mrs Hall' }, summary: null }]);
  });

  it('makes text on several lines into one line', async () => {
    await send(app, withDetails(to('landline-caller'), (data) => ({ ...data, address: '12 Kiln Lane\n  Tidewell' })));
    expect((await listJobs(db, firm))[0]?.place).toBe('12 Kiln Lane Tidewell');
  });
});

describe('what is kept from a report', () => {
  it('keeps the transcript with the call, and nothing else that is not read', async () => {
    const body = to('mr-price-leak');
    await send(app, body);
    const [call] = await calls();
    const stored = await getCall(db, firm, call?.id as never);
    expect(stored?.transcript).toBe((body.message.artifact as { transcript: string }).transcript);

    const everything = JSON.stringify(await firmRows(env.DB, firm));
    expect(everything).not.toContain('recordings');
    expect(everything).not.toContain('AC00000000000000000000000000000000');
    expect(everything).not.toContain('You answer the phone for Tidewell Heating.');
    expect(everything).not.toContain('reported a leak under his kitchen sink');
  });

  it('keeps a report without its times as of when it arrived', async () => {
    const body = to('supplier');
    for (const holder of [body.message, body.message.call as Record<string, unknown>]) {
      delete holder.startedAt;
      delete holder.endedAt;
    }
    await send(app, body);
    expect(await calls()).toMatchObject([{ startedAt: clock.now(), endedAt: null }]);
  });

  it('logs ids only: no names, numbers, addresses or words from the call', async () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await send(app, to('mr-price-leak'));
    await send(app, to('mr-price-leak'));
    const lines = logged.mock.calls.map(([line]) => String(line));
    // The second report is the same call, so its alert is not sent again.
    expect(lines.map((line) => (JSON.parse(line) as { event: string }).event)).toEqual([
      'call_stored',
      'text_sent',
      'call_repeated',
    ]);
    for (const line of lines) {
      expect(line).not.toMatch(/Price|07700|\+447700|Bridge|leak|vapi|2a7d4b63-/i);
    }
  });

  it('keeps a call that comes while the firm’s calls are switched off, and tells staff in the log', async () => {
    await setService(db, firm, 'calls', false, { kind: 'frontline' });
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect((await send(app, to('supplier'))).status).toBe(200);
    expect(await calls()).toHaveLength(1);
    expect(logged.mock.calls.map(([line]) => (JSON.parse(String(line)) as { event: string }).event)).toContain(
      'call_while_calls_off',
    );
  });
});

describe('what the address refuses or leaves alone', () => {
  const nothingChanges = async (attempt: () => Response | Promise<Response>, status: number) => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const before = await firmRows(env.DB, firm);
    expect((await attempt()).status).toBe(status);
    expect(await firmRows(env.DB, firm)).toEqual(before);
  };

  it.each([
    ['a wrong secret', { Authorization: `Bearer ${'x'.repeat(64)}` }],
    ['no secret', {}],
    ['the secret without "Bearer"', { Authorization: env.VAPI_SECRET }],
    ['the secret in another header', { 'X-Vapi-Secret': env.VAPI_SECRET }],
    ['"Bearer" and nothing else', { Authorization: 'Bearer ' }],
    ['the secret with something added', { Authorization: `Bearer ${env.VAPI_SECRET}x` }],
  ])('refuses a report with %s, and keeps nothing', async (_, headers: Record<string, string>) => {
    await nothingChanges(() => send(app, to('mr-price-leak'), headers), 401);
  });

  it('refuses everything when no secret has been set up, or one too short to be safe', async () => {
    for (const secret of ['', 'short']) {
      await nothingChanges(
        () => send(app, to('mr-price-leak'), { Authorization: `Bearer ${secret}` }, { ...env, VAPI_SECRET: secret }),
        401,
      );
    }
    const withoutSecret: Partial<Env> = { ...env };
    delete withoutSecret.VAPI_SECRET;
    await nothingChanges(() => send(app, to('mr-price-leak'), undefined, withoutSecret as Env), 401);
  });

  it('answers "not found" for a number no firm has, and keeps nothing', async () => {
    const body = report('mr-price-leak', '+447700900999');
    await nothingChanges(() => send(app, body), 404);
  });

  it('answers OK to other kinds of message from Vapi, and keeps nothing', async () => {
    const statusUpdate = { message: { type: 'status-update', status: 'in-progress', call: { id: 'c-1' } } };
    await nothingChanges(() => send(app, statusUpdate), 200);
  });

  it.each([
    ['is not JSON', 'not json'],
    ['has no message', { hello: 'there' }],
    ['is a report without the call’s id', { message: { type: 'end-of-call-report', call: {} } }],
  ])('refuses a body that %s', async (_, body) => {
    await nothingChanges(
      () =>
        app.request(
          '/vapi/server',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.VAPI_SECRET}`, 'Content-Type': 'application/json' },
            body: typeof body === 'string' ? body : JSON.stringify(body),
          },
          env,
        ),
      400,
    );
  });

  it('only takes reports at its own address, by POST', async () => {
    const answer = await app.request('/vapi/server', { method: 'GET' }, env);
    expect(answer.status).toBe(404);
  });
});

it('reads the firm’s number however Vapi wrote it', async () => {
  const body = to('supplier');
  (body.message.phoneNumber as Record<string, unknown>).number = ukMobile(number).replace('+44', '0');
  expect((await send(app, body)).status).toBe(200);
  expect(await calls()).toHaveLength(1);
});

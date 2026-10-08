// Texts through Twilio (slice D): sending, against a pretend network so
// nothing reaches Twilio; checking that a request is from Twilio; and
// Twilio's two addresses, for texts that come in and for delivery reports.

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { runDue } from '../src/due';
import { historyLine } from '../src/history-lines';
import { newId } from '../src/ids';
import { ukMobile } from '../src/phone';
import { isFromTwilio, TwilioTexts, twilioSignature } from '../src/providers/texts/twilio';
import {
  addDue,
  createCustomer,
  createJob,
  createVisit,
  getMessage,
  historyForJob,
  listMessagesBetween,
  listTextsInBetween,
} from '../src/record';
import { openRecord } from '../src/record/db';
import type { FirmId } from '../src/record/types';
import { firmRows } from './helpers/db';
import { testDeps } from './helpers/deps';
import { postToTwilioRoute, pretendTwilio, twilioFields } from './helpers/twilio';
import { tidewell } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-09-30T13:00:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const app = createApp(() => deps);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;

describe('Twilio’s signature', () => {
  it('matches Twilio’s own published example', async () => {
    // The example in Twilio's documentation on checking its requests.
    const form: [string, string][] = [
      ['CallSid', 'CA1234567890ABCDE'],
      ['Caller', '+14158675309'],
      ['Digits', '1234'],
      ['From', '+14158675309'],
      ['To', '+18005551212'],
    ];
    expect(await twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', form)).toBe(
      'RSOYDt4T1cUTdK1PDd93/VVr8B8=',
    );
    // The order the fields come in makes no difference.
    expect(await twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', [...form].reverse())).toBe(
      'RSOYDt4T1cUTdK1PDd93/VVr8B8=',
    );
  });

  it('is checked against our token, and anything else is refused', async () => {
    const token = 'a'.repeat(32);
    const url = 'https://practice.example/twilio/texts';
    const form: [string, string][] = [['Body', 'Hello']];
    const signed = await twilioSignature(token, url, form);

    expect(await isFromTwilio(token, url, form, signed)).toBe(true);
    // Twilio may sign the address with the standard port.
    expect(await isFromTwilio(token, url, form, await twilioSignature(token, 'https://practice.example:443/twilio/texts', form))).toBe(true);
    expect(await isFromTwilio(token, url, [['Body', 'Hello!']], signed)).toBe(false);
    expect(await isFromTwilio(token, 'https://practice.example/twilio/status', form, signed)).toBe(false);
    expect(await isFromTwilio('b'.repeat(32), url, form, signed)).toBe(false);
    expect(await isFromTwilio(token, url, form, undefined)).toBe(false);
    expect(await isFromTwilio(token, url, form, '')).toBe(false);
    // No token set up, or one too short to be Twilio's: nothing matches.
    expect(await isFromTwilio(undefined, url, form, signed)).toBe(false);
    expect(await isFromTwilio('12345', url, form, await twilioSignature('12345', url, form))).toBe(false);
  });
});

describe('sending through Twilio', () => {
  const accountSid = `AC${'0123456789abcdef'.repeat(2)}`;
  const text = { from: ukMobile('07700 900100'), to: ukMobile('07700 900003'), body: "Reminder: Tom's visit is tomorrow." };

  /** A pretend network that answers as given, and keeps what it was sent. */
  function network(status: number, body: unknown) {
    const asked: Request[] = [];
    const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(new Request(input, init));
      return Promise.resolve(Response.json(body, { status }));
    };
    return { asked, fetch };
  }

  it('posts the text to Twilio from the firm’s number, asking for delivery reports, and gives Twilio’s id', async () => {
    const net = network(201, { sid: `SM${'f'.repeat(32)}`, status: 'queued' });
    const twilio = new TwilioTexts({ accountSid, authToken: 'token', statusCallback: 'https://practice.example/twilio/status', fetch: net.fetch });

    expect(await twilio.sendText(text)).toEqual({ ok: true, providerId: `SM${'f'.repeat(32)}` });
    const [asked] = net.asked;
    expect(asked?.method).toBe('POST');
    expect(asked?.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`);
    expect(asked?.headers.get('Authorization')).toBe(`Basic ${btoa(`${accountSid}:token`)}`);
    expect(Object.fromEntries(new URLSearchParams(await asked?.text()))).toEqual({
      To: '+447700900003',
      From: '+447700900100',
      Body: "Reminder: Tom's visit is tomorrow.",
      StatusCallback: 'https://practice.example/twilio/status',
    });
  });

  it('leaves out the delivery address until there is one', async () => {
    const net = network(201, { sid: `SM${'f'.repeat(32)}` });
    await new TwilioTexts({ accountSid, authToken: 'token', statusCallback: null, fetch: net.fetch }).sendText(text);
    expect(new URLSearchParams(await net.asked[0]?.text()).has('StatusCallback')).toBe(false);
  });

  it('tells a customer who unsubscribed with Twilio from any other refusal', async () => {
    const unsubscribed = network(400, { code: 21610, message: 'Attempt to send to unsubscribed recipient' });
    expect(await new TwilioTexts({ accountSid, authToken: 't', statusCallback: null, fetch: unsubscribed.fetch }).sendText(text)).toEqual({
      ok: false,
      reason: 'unsubscribed',
      code: 21610,
    });
    const refused = network(400, { code: 21211, message: 'Invalid To number' });
    expect(await new TwilioTexts({ accountSid, authToken: 't', statusCallback: null, fetch: refused.fetch }).sendText(text)).toEqual({
      ok: false,
      reason: 'refused',
      code: 21211,
    });
  });

  it('throws when it is not clear whether Twilio took it, so it is never sent again', async () => {
    const failing = network(503, {});
    await expect(new TwilioTexts({ accountSid, authToken: 't', statusCallback: null, fetch: failing.fetch }).sendText(text)).rejects.toThrow();
    const lost = (() => Promise.reject(new TypeError('Network connection lost'))) as typeof fetch;
    await expect(new TwilioTexts({ accountSid, authToken: 't', statusCallback: null, fetch: lost }).sendText(text)).rejects.toThrow();
    const noId = network(201, {});
    await expect(new TwilioTexts({ accountSid, authToken: 't', statusCallback: null, fetch: noId.fetch }).sendText(text)).rejects.toThrow();
  });

  it('sends nothing at all when the account is not set up', async () => {
    const net = network(201, {});
    for (const settings of [
      { accountSid: undefined, authToken: 'token' },
      { accountSid, authToken: undefined },
      { accountSid: 'not an account', authToken: 'token' },
    ]) {
      expect(await new TwilioTexts({ ...settings, statusCallback: null, fetch: net.fetch }).sendText(text)).toEqual({
        ok: false,
        reason: 'refused',
        code: null,
      });
    }
    expect(net.asked).toEqual([]);
  });
});

describe('a text that comes in', () => {
  let firm: FirmId;
  let numbers = 600;
  let number: string;

  beforeEach(async () => {
    numbers += 1;
    number = `+447700900${String(numbers)}`;
    firm = await tidewell(db, number);
  });

  /** The example text, sent to this test's firm, as another text each time. */
  function textIn(change: Record<string, string> = {}) {
    return twilioFields('text-in', { To: number, MessageSid: `SM${newId()}`, ...change });
  }

  it('is stored against the customer and shown on their job, with an empty answer so nothing replies', async () => {
    const mrsAhmed = await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
    const job = await createJob(db, firm, { customer: mrsAhmed, about: 'Boiler replacement', place: '27 Station Road', urgent: false });

    const answer = await postToTwilioRoute(app, '/twilio/texts', textIn());
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Content-Type')).toBe('text/xml');
    expect(await answer.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    expect(await listTextsInBetween(db, firm, ...allTime)).toMatchObject([
      { from: '+447700900003', customer: { id: mrsAhmed, name: 'Mrs Ahmed' }, job, words: "Yes that's fine, see you Thursday.", receivedAt: clock.now() },
    ]);
    const lines = (await historyForJob(db, firm, job)).map((entry) => [entry.by.kind, historyLine(entry, 'job')]);
    expect(lines).toEqual([['customer', 'Text: “Yes that\'s fine, see you Thursday.”']]);
  });

  it('goes on the job of the last text sent to the customer, not just their newest job', async () => {
    const mrsAhmed = await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
    const first = await createJob(db, firm, { customer: mrsAhmed, about: 'Boiler replacement', place: '27 Station Road', urgent: false });
    const visit = await createVisit(db, firm, { job: first, startsAt: instantFromIso('2026-10-01T15:00:00+01:00'), kind: 'quote_visit' });
    const reminder = await addDue(db, firm, { action: 'send_reminder', visit, runAt: clock.now(), latestAt: clock.now() });
    await runDue(db, deps, firm, reminder);
    clock.advance(60_000);
    const newer = await createJob(db, firm, { customer: mrsAhmed, about: 'Radiator swap', place: '27 Station Road', urgent: false });

    await postToTwilioRoute(app, '/twilio/texts', textIn());
    expect((await listTextsInBetween(db, firm, ...allTime))[0]?.job).toBe(first);
    expect(await historyForJob(db, firm, newer)).toEqual([]);
  });

  it('keeps a text from a number that is not a customer’s, with no customer and nothing on any job', async () => {
    await postToTwilioRoute(app, '/twilio/texts', textIn({ From: '+447700900999' }));
    expect(await listTextsInBetween(db, firm, ...allTime)).toMatchObject([{ from: '+447700900999', customer: null, job: null }]);
  });

  it('keeps the same text once, however many times it arrives', async () => {
    await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
    const fields = textIn();
    const answers = await Promise.all([1, 2, 3].map(() => postToTwilioRoute(app, '/twilio/texts', fields)));
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    expect(await listTextsInBetween(db, firm, ...allTime)).toHaveLength(1);
  });

  it('stores a STOP like any other text, until open question 2 says what it does', async () => {
    const mrsAhmed = await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
    await createJob(db, firm, { customer: mrsAhmed, about: 'Boiler replacement', place: '27 Station Road', urgent: false });
    await postToTwilioRoute(app, '/twilio/texts', textIn({ Body: 'STOP' }));
    expect(await listTextsInBetween(db, firm, ...allTime)).toMatchObject([{ words: 'STOP' }]);
  });

  it('is refused, and nothing in it read or kept, without Twilio’s signature', async () => {
    const before = await firmRows(env.DB, firm);
    const fields = textIn();
    const wrong = await twilioSignature('b'.repeat(32), 'http://localhost/twilio/texts', Object.entries(fields));
    expect((await postToTwilioRoute(app, '/twilio/texts', fields, wrong)).status).toBe(401);
    expect((await postToTwilioRoute(app, '/twilio/texts', fields, '')).status).toBe(401);
    // A field changed after it was signed.
    const signed = await twilioSignature(env.TWILIO_AUTH_TOKEN, 'http://localhost/twilio/texts', Object.entries(fields));
    expect((await postToTwilioRoute(app, '/twilio/texts', { ...fields, Body: 'Changed' }, signed)).status).toBe(401);
    // No token set up: everything is refused.
    const noToken = await app.request(
      'http://localhost/twilio/texts',
      { method: 'POST', headers: { 'X-Twilio-Signature': signed }, body: new URLSearchParams(fields).toString() },
      { ...env, TWILIO_AUTH_TOKEN: '' },
    );
    expect(noToken.status).toBe(401);
    expect(await firmRows(env.DB, firm)).toEqual(before);
  });

  it('answers 404 for a number no firm has, and 400 for a text without its fields', async () => {
    expect((await postToTwilioRoute(app, '/twilio/texts', textIn({ To: '+447700900998' }))).status).toBe(404);
    const noId = textIn();
    delete noId.MessageSid;
    expect((await postToTwilioRoute(app, '/twilio/texts', noId)).status).toBe(400);
  });
});

describe('a delivery report', () => {
  let firm: FirmId;
  let numbers = 700;
  let number: string;
  let providerId: string;

  beforeEach(async () => {
    numbers += 1;
    number = `+447700900${String(numbers)}`;
    firm = await tidewell(db, number);
    const mrsAhmed = await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
    const job = await createJob(db, firm, { customer: mrsAhmed, about: 'Boiler replacement', place: '27 Station Road', urgent: false });
    const visit = await createVisit(db, firm, { job, startsAt: instantFromIso('2026-10-01T15:00:00+01:00'), kind: 'quote_visit' });
    const reminder = await addDue(db, firm, { action: 'send_reminder', visit, runAt: clock.now(), latestAt: clock.now() });
    // Sent through the Twilio version, on a pretend network.
    await runDue(db, { texts: pretendTwilio() }, firm, reminder);
    const [sent] = await listMessagesBetween(db, firm, ...allTime);
    expect(sent).toMatchObject({ state: 'sent', provider: 'twilio' });
    providerId = sent?.providerId ?? '';
  });

  async function report(name: 'delivered' | 'undelivered', change: Record<string, string> = {}) {
    return postToTwilioRoute(app, '/twilio/status', twilioFields(name, { From: number, MessageSid: providerId, ...change }));
  }

  async function theText() {
    const [message] = await listMessagesBetween(db, firm, ...allTime);
    return message === undefined ? null : getMessage(db, firm, message.id);
  }

  it('marks the text delivered', async () => {
    expect((await report('delivered')).status).toBe(200);
    expect(await theText()).toMatchObject({ state: 'delivered', reason: null });
  });

  it('marks it failed, with Twilio’s error code, when it could not be delivered', async () => {
    await report('undelivered');
    expect(await theText()).toMatchObject({ state: 'failed', reason: 'undelivered', errorCode: 30003 });
  });

  it('only moves a text forward', async () => {
    await report('delivered');
    // Twilio's reports can arrive out of order.
    await report('delivered', { MessageStatus: 'sent', SmsStatus: 'sent' });
    await report('undelivered');
    expect(await theText()).toMatchObject({ state: 'delivered' });
  });

  it('changes nothing for a text the firm does not have, or without Twilio’s signature', async () => {
    const before = await firmRows(env.DB, firm);
    expect((await report('delivered', { MessageSid: `SM${'0'.repeat(32)}` })).status).toBe(200);
    expect((await postToTwilioRoute(app, '/twilio/status', twilioFields('delivered', { From: number, MessageSid: providerId }), 'wrong')).status).toBe(401);
    expect(await firmRows(env.DB, firm)).toEqual(before);
  });
});

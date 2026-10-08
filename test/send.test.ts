// send(), rules 1 to 4 in CLAUDE.md: the words come from the firm's agreed
// wording; the stop button, the service switch and an opt-out each stop a
// text to a customer; a text is claimed so it cannot go twice; texts are
// GSM-7, with the segments counted. Every text here goes to the stand-in.

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { ukMobile } from '../src/phone';
import {
  addDue,
  claimMessage,
  createCustomer,
  createFirm,
  createJob,
  createOwner,
  createVisit,
  firmWording,
  getFirm,
  getMessage,
  historyForJob,
  listMessagesBetween,
  listOptOuts,
  listOwners,
  optIn,
  optOut,
  setFirmNumber,
  setService,
  setStopButton,
  setWording,
} from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import { CLAIM_HOLDS_FOR } from '../src/record/due';
import type { CustomerId, DueId, FirmId, JobId, VisitId } from '../src/record/types';
import { send, type Outgoing } from '../src/send';
import { optOutsMadeByStop } from './helpers/db';
import { testDeps, type TestDeps } from './helpers/deps';
import { tidewell, TOMS_MOBILE } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-09-30T13:00:00+01:00'));
const db = openRecord(env.DB, clock);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const frontline = { kind: 'frontline' } as const;

let deps: TestDeps;
let firm: FirmId;
let numbers = 800;
let number: string;
let mrsAhmed: CustomerId;
let job: JobId;
let visit: VisitId;
let due: DueId;

beforeEach(async () => {
  clock.set(instantFromIso('2026-09-30T13:00:00+01:00'));
  deps = testDeps(clock);
  numbers += 1;
  number = `+447700900${String(numbers)}`;
  firm = await tidewell(db, number);
  mrsAhmed = await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
  job = await createJob(db, firm, { customer: mrsAhmed, about: 'Boiler replacement', place: '27 Station Road', urgent: false });
  visit = await createVisit(db, firm, { job, startsAt: instantFromIso('2026-10-01T15:00:00+01:00'), kind: 'quote_visit' });
  due = await addDue(db, firm, { action: 'send_reminder', visit, runAt: clock.now(), latestAt: clock.now() });
});

/** Mrs Ahmed's reminder for her visit on Thursday at 3pm, as the due list asks for it. */
function reminder(change: Partial<Outgoing> = {}): Outgoing {
  return {
    due,
    kind: 'visit_reminder',
    to: { kind: 'customer', customer: mrsAhmed },
    about: { job, visit, call: null },
    facts: { owner: 'Tom', weekday: 'Thursday', time: '3pm' },
    ...change,
  };
}

async function texts() {
  return listMessagesBetween(db, firm, ...allTime);
}

describe('a reminder that goes', () => {
  it('is made from the firm’s agreed words, sent from the firm’s number, and recorded with its segments', async () => {
    const sent = await send(deps.texts, db, firm, reminder());
    expect(sent.result).toBe('sent');
    expect(deps.texts.sent).toEqual([
      {
        from: number,
        to: '+447700900003',
        body: "Reminder: Tom's visit is tomorrow, Thursday, at 3pm. See you then.",
        providerId: expect.stringMatching(/^fake-/) as unknown,
      },
    ]);
    const [message] = await texts();
    expect(message).toMatchObject({
      due,
      kind: 'visit_reminder',
      to: { kind: 'customer', customer: mrsAhmed },
      job,
      visit,
      call: null,
      toNumber: '+447700900003',
      fromNumber: number,
      words: "Reminder: Tom's visit is tomorrow, Thursday, at 3pm. See you then.",
      segments: 1,
      state: 'sent',
      reason: null,
      provider: 'fake',
      sentAt: clock.now(),
    });
  });

  it('writes that the reminder was sent, on the visit’s job, in the same step', async () => {
    await send(deps.texts, db, firm, reminder());
    const entries = await historyForJob(db, firm, job);
    expect(entries.map((entry) => [entry.kind, entry.visit?.id, entry.by.kind])).toEqual([['reminder_sent', visit, 'frontline']]);
  });

  it('makes a caller’s curly apostrophe straight, so the text stays GSM-7', async () => {
    await send(deps.texts, db, firm, reminder({ facts: { owner: 'Tom O’Neill', weekday: 'Thursday', time: '3pm' } }));
    expect(deps.texts.sent[0]?.body).toBe("Reminder: Tom O'Neill's visit is tomorrow, Thursday, at 3pm. See you then.");
  });
});

describe('the words', () => {
  it('cannot be anything but the firm’s agreed wording: with none for the kind, nothing goes', async () => {
    const plain = await bareFirm({ number: true });
    expect(await send(deps.texts, db, plain.firm, plain.reminder)).toMatchObject({ result: 'not_sent', why: 'no_wording' });
    expect(deps.texts.sent).toEqual([]);
    expect(await listMessagesBetween(db, plain.firm, ...allTime)).toMatchObject([{ state: 'not_sent', reason: 'no_wording', words: null }]);
  });

  it('are refused at set-up if they hold a character a text cannot carry, such as a curly apostrophe', async () => {
    await expect(setWording(db, firm, 'text:visit_reminder', 'Reminder: Tom’s visit is tomorrow.', frontline)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'text:visit_reminder', 'See you then 👍', frontline)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'text:visit_reminder', 'Reminder: {customer} at {time}.', frontline)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'text:visit_reminder', 'Reminder: {time.', frontline)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'text:quote' as never, 'Your quote.', frontline)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'text:visit_reminder', ' ', frontline)).rejects.toThrow(Refused);
  });

  it('are the newest the firm agreed, and the text names the version it was made from', async () => {
    const newer = await setWording(db, firm, 'text:visit_reminder', 'Reminder: see you {weekday} at {time}.', frontline);
    await send(deps.texts, db, firm, reminder());
    expect(deps.texts.sent[0]?.body).toBe('Reminder: see you Thursday at 3pm.');
    expect((await texts())[0]?.wording).toBe(newer);
  });

  it('count the segments of a long text', async () => {
    await setWording(db, firm, 'text:visit_reminder', `Reminder: {time}. ${'x'.repeat(160)}`, frontline);
    await send(deps.texts, db, firm, reminder());
    expect((await texts())[0]?.segments).toBe(2);
  });
});

describe('what stops a text to a customer (rule 3)', () => {
  it('the stop button holds it: nothing is claimed or sent', async () => {
    await setStopButton(db, firm, true, frontline);
    expect(await send(deps.texts, db, firm, reminder())).toEqual({ result: 'held', why: 'stopped' });
    expect(deps.texts.sent).toEqual([]);
    expect(await texts()).toEqual([]);
  });

  it('the firm’s switch for the service holds it', async () => {
    await setService(db, firm, 'calls', false, frontline);
    expect(await send(deps.texts, db, firm, reminder())).toEqual({ result: 'held', why: 'service_off' });
    expect(deps.texts.sent).toEqual([]);
  });

  it('checks the stop button first, then the switch', async () => {
    await setStopButton(db, firm, true, frontline);
    await setService(db, firm, 'calls', false, frontline);
    expect(await send(deps.texts, db, firm, reminder())).toEqual({ result: 'held', why: 'stopped' });
  });

  it('an opt-out from that kind of text, or from every kind, means it is not sent, and that is recorded', async () => {
    await optOut(db, firm, mrsAhmed, 'visit_reminder', frontline);
    expect(await send(deps.texts, db, firm, reminder())).toMatchObject({ result: 'not_sent', why: 'opted_out' });
    expect(deps.texts.sent).toEqual([]);
    expect(await texts()).toMatchObject([{ state: 'not_sent', reason: 'opted_out', words: null, toNumber: null }]);

    await optIn(db, firm, mrsAhmed, 'visit_reminder', frontline);
    await optOut(db, firm, mrsAhmed, 'every', frontline);
    const again = await addDue(db, firm, { action: 'send_reminder', visit, runAt: clock.now(), latestAt: clock.now() });
    expect(await send(deps.texts, db, firm, reminder({ due: again }))).toMatchObject({ result: 'not_sent', why: 'opted_out' });
  });

  it('checks the switch before the opt-out', async () => {
    await optOut(db, firm, mrsAhmed, 'every', frontline);
    await setService(db, firm, 'calls', false, frontline);
    expect(await send(deps.texts, db, firm, reminder())).toEqual({ result: 'held', why: 'service_off' });
  });

  it('a customer without a mobile gets nothing, and that is recorded', async () => {
    const mrsHall = await createCustomer(db, firm, { name: 'Mrs Hall', mobile: null, noText: 'withheld' });
    expect(await send(deps.texts, db, firm, reminder({ to: { kind: 'customer', customer: mrsHall } }))).toMatchObject({
      result: 'not_sent',
      why: 'no_mobile',
    });
  });

  it('none of them hold an alert to the owner, which is not to a customer', async () => {
    await setStopButton(db, firm, true, frontline);
    await setService(db, firm, 'calls', false, frontline);
    const [tom] = await listOwners(db, firm);
    const sent = await send(deps.texts, db, firm, {
      due,
      kind: 'urgent_alert',
      to: { kind: 'owner', owner: tom?.id ?? (null as never) },
      about: { job, visit: null, call: null },
      facts: { customer: 'Mr Price', place: '6 Bridge Street', summary: 'A leak under the kitchen sink.', number: '07700 900016' },
    });
    expect(sent.result).toBe('sent');
    expect(deps.texts.sent[0]?.to).toBe(TOMS_MOBILE);
  });
});

describe('quiet hours (open question 8)', () => {
  it('hold a text to a customer from 8pm, until 8am, without claiming it', async () => {
    clock.set(instantFromIso('2026-09-30T20:00:00+01:00'));
    expect(await send(deps.texts, db, firm, reminder())).toEqual({
      result: 'held',
      why: 'quiet_hours',
      until: instantFromIso('2026-10-01T08:00:00+01:00'),
    });
    expect(await texts()).toEqual([]);
  });

  it('never hold an alert to the owner, which goes at any hour', async () => {
    clock.set(instantFromIso('2026-10-01T02:00:00+01:00'));
    const [tom] = await listOwners(db, firm);
    const sent = await send(deps.texts, db, firm, {
      due,
      kind: 'urgent_alert',
      to: { kind: 'owner', owner: tom?.id ?? (null as never) },
      about: { job, visit: null, call: null },
      facts: { customer: 'Mr Price', place: '6 Bridge Street', summary: 'A leak under the kitchen sink.', number: '07700 900016' },
    });
    expect(sent.result).toBe('sent');
  });

  it('still record an opt-out at night at once: it is not a hold', async () => {
    clock.set(instantFromIso('2026-09-30T23:00:00+01:00'));
    await optOut(db, firm, mrsAhmed, 'every', frontline);
    expect(await send(deps.texts, db, firm, reminder())).toMatchObject({ result: 'not_sent', why: 'opted_out' });
  });
});

describe('a text cannot go twice', () => {
  it('the same row in the due list, to the same person, is claimed once', async () => {
    expect((await send(deps.texts, db, firm, reminder())).result).toBe('sent');
    const second = await send(deps.texts, db, firm, reminder());
    expect(second).toMatchObject({ result: 'already', state: 'sent' });
    expect(deps.texts.sent).toHaveLength(1);
  });

  it('even when it is sent at the same moment by two workers', async () => {
    const results = await Promise.all([1, 2, 3].map(() => send(deps.texts, db, firm, reminder())));
    expect(results.map((result) => result.result).sort()).toEqual(['already', 'already', 'sent']);
    expect(deps.texts.sent).toHaveLength(1);
    expect(await texts()).toHaveLength(1);
  });

  it('a text that went is found before the stop button is looked at, so a row run again records what happened', async () => {
    // A worker sent Mrs Ahmed's reminder, then stopped before marking its row
    // done. Then the stop button went on, and the row came round again.
    expect((await send(deps.texts, db, firm, reminder())).result).toBe('sent');
    await setStopButton(db, firm, true, frontline);
    expect(await send(deps.texts, db, firm, reminder())).toMatchObject({ result: 'already', state: 'sent' });
    clock.set(instantFromIso('2026-09-30T21:00:00+01:00'));
    expect(await send(deps.texts, db, firm, reminder())).toMatchObject({ result: 'already', state: 'sent' });
    expect(deps.texts.sent).toHaveLength(1);
  });

  it('a text not sent is claimed too, so it is not tried again', async () => {
    await optOut(db, firm, mrsAhmed, 'every', frontline);
    await send(deps.texts, db, firm, reminder());
    await optIn(db, firm, mrsAhmed, 'every', frontline);
    expect(await send(deps.texts, db, firm, reminder())).toMatchObject({ result: 'already', state: 'not_sent' });
    expect(deps.texts.sent).toEqual([]);
  });
});

describe('when the provider does not take it', () => {
  it('a refusal is recorded with the provider’s code, and nothing says it went', async () => {
    deps.texts.willAnswer('refused');
    expect(await send(deps.texts, db, firm, reminder())).toMatchObject({ result: 'failed', why: 'refused' });
    expect(await texts()).toMatchObject([{ state: 'failed', reason: 'refused', errorCode: 21211, providerId: null }]);
    expect(await historyForJob(db, firm, job)).toEqual([]);
  });

  it('a customer who unsubscribed with the provider is recorded as such, and the number is opted out of every text here too', async () => {
    deps.texts.willAnswer('unsubscribed');
    expect(await send(deps.texts, db, firm, reminder())).toMatchObject({ result: 'failed', why: 'unsubscribed' });
    expect(await listOptOuts(db, firm, mrsAhmed)).toEqual(['every']);
    expect(await optOutsMadeByStop(env.DB, mrsAhmed)).toEqual(['every']);
    // Another customer on the same mobile gets nothing either.
    const mrAhmed = await createCustomer(db, firm, { name: 'Mr Ahmed', mobile: ukMobile('07700 900003') });
    const again = await addDue(db, firm, { action: 'send_reminder', visit, runAt: clock.now(), latestAt: clock.now() });
    expect(await send(deps.texts, db, firm, reminder({ due: again, to: { kind: 'customer', customer: mrAhmed } }))).toMatchObject({
      result: 'not_sent',
      why: 'opted_out',
    });
    expect(deps.texts.sent).toEqual([]);
  });

  it('when it is not clear whether it went, it is marked for staff and never sent again', async () => {
    deps.texts.willAnswer('unclear');
    expect(await send(deps.texts, db, firm, reminder())).toMatchObject({ result: 'failed', why: 'unclear' });
    expect(await send(deps.texts, db, firm, reminder())).toMatchObject({ result: 'already', state: 'failed' });
    expect(deps.texts.sent).toEqual([]);
  });

  it('a text a stopped worker left half handed over is marked unclear once its claim has run out, not sent', async () => {
    // A worker claimed Mrs Ahmed's reminder, then stopped before it heard back.
    const firmNumber = (await getFirm(db, firm))?.phoneNumber;
    const wording = (await firmWording(db, firm))['text:visit_reminder']?.id;
    if (firmNumber == null || wording === undefined) throw new Error('Not set up');
    const message = await claimMessage(db, firm, {
      due,
      kind: 'visit_reminder',
      to: { kind: 'customer', customer: mrsAhmed },
      about: { job, visit, call: null },
      going: { toNumber: ukMobile('07700 900003'), fromNumber: firmNumber, words: 'Reminder.', wording },
      notSent: null,
    });

    // Shortly after, it may still be being handed over: it is left alone.
    expect(await send(deps.texts, db, firm, reminder())).toEqual({ result: 'already', message, state: 'sending' });
    expect(await getMessage(db, firm, message)).toMatchObject({ state: 'sending' });

    // Once its claim has run out, nobody can tell whether it went.
    clock.advance(CLAIM_HOLDS_FOR);
    expect(await send(deps.texts, db, firm, reminder())).toEqual({ result: 'already', message, state: 'failed' });
    expect(await getMessage(db, firm, message)).toMatchObject({ state: 'failed', reason: 'unclear' });
    expect(deps.texts.sent).toEqual([]);
  });
});

describe('the firm', () => {
  it('without its own number sends nothing, and that is recorded', async () => {
    const plain = await bareFirm({ number: false });
    await setWording(db, plain.firm, 'text:visit_reminder', 'Reminder: {time}.', frontline);
    expect(await send(deps.texts, db, plain.firm, plain.reminder)).toMatchObject({ result: 'not_sent', why: 'no_number' });
    expect(deps.texts.sent).toEqual([]);
  });

  it('cannot send to another firm’s customer, or about another firm’s visit', async () => {
    const other = await bareFirm({ number: true });
    await setWording(db, other.firm, 'text:visit_reminder', 'Reminder: {time}.', frontline);
    // As the other firm, to this firm's Mrs Ahmed.
    await expect(send(deps.texts, db, other.firm, reminder({ due: other.reminder.due }))).rejects.toThrow(Refused);
    // As the other firm, to its own customer, about this firm's visit.
    await expect(send(deps.texts, db, other.firm, { ...other.reminder, about: { job, visit, call: null } })).rejects.toThrow(Refused);
    expect(deps.texts.sent).toEqual([]);
  });
});

let bareFirms = 0;

/**
 * A firm with calls switched on, a customer with a visit and a reminder
 * row, and nothing else: no agreed wording, and a number only if asked.
 */
async function bareFirm(options: { number: boolean }) {
  bareFirms += 1;
  const made = await createFirm(db, { name: 'Tidewell Heating', isExample: false });
  if (options.number) {
    await setFirmNumber(db, made, ukMobile(`+447700901${String(bareFirms).padStart(3, '0')}`), frontline);
  }
  await setService(db, made, 'calls', true, frontline);
  await createOwner(db, made, { name: 'Tom', mobile: ukMobile(TOMS_MOBILE) });
  const customer = await createCustomer(db, made, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
  const theirJob = await createJob(db, made, { customer, about: 'Boiler replacement', place: '27 Station Road', urgent: false });
  const theirVisit = await createVisit(db, made, { job: theirJob, startsAt: clock.now(), kind: 'quote_visit' });
  const theirDue = await addDue(db, made, { action: 'send_reminder', visit: theirVisit, runAt: clock.now(), latestAt: clock.now() });
  return {
    firm: made,
    reminder: reminder({
      due: theirDue,
      to: { kind: 'customer', customer },
      about: { job: theirJob, visit: theirVisit, call: null },
    }),
  };
}

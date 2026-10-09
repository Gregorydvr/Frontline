// The confirmation of a visit just booked (slice E): its words, the first
// text to a customer with their link, and what stops it.

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { bookingDues } from '../src/diary/times';
import { ownDiary } from '../src/diary/own';
import { runDue } from '../src/due';
import { ukMobile } from '../src/phone';
import {
  addDue,
  createCustomer,
  createJob,
  createVisit,
  findLink,
  historyForJob,
  linkForDue,
  listMessagesBetween,
} from '../src/record';
import { openRecord } from '../src/record/db';
import type { CustomerId, DueId, FirmId, JobId, VisitId } from '../src/record/types';
import { testDeps } from './helpers/deps';
import { tidewell } from './helpers/vapi';

const booked = instantFromIso('2026-09-28T11:15:00+01:00');
const clock = pretendClock(booked);
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const frontline = { kind: 'frontline' } as const;
const thursday3pm = instantFromIso('2026-10-01T15:00:00+01:00');

let firm: FirmId;
let numbers = 700;

beforeEach(async () => {
  clock.set(booked);
  numbers += 1;
  firm = await tidewell(db, `+447700900${String(numbers)}`);
});

/** Mrs Ahmed, her job and a quote visit on Thursday at 3pm, with the row for its confirmation. */
async function visitToConfirm(mobile: string | null = '07700 900003'): Promise<{ customer: CustomerId; job: JobId; visit: VisitId; due: DueId }> {
  const customer = await createCustomer(db, firm, mobile === null ? { name: 'Mrs Ahmed', mobile: null, noText: 'withheld' } : { name: 'Mrs Ahmed', mobile: ukMobile(mobile) });
  const job = await createJob(db, firm, { customer, about: 'Boiler replacement', place: '27 Station Road', urgent: false });
  const visit = await createVisit(db, firm, { job, startsAt: thursday3pm, endsAt: instantFromIso('2026-10-01T16:00:00+01:00'), kind: 'quote_visit' });
  const [confirmation] = bookingDues(thursday3pm, clock.now());
  if (confirmation === undefined) throw new Error('No confirmation');
  const due = await addDue(db, firm, { action: 'send_confirmation', visit, runAt: confirmation.runAt, latestAt: confirmation.latestAt });
  return { customer, job, visit, due };
}

describe('the confirmation', () => {
  it('is the first text, with the link, and the link opens her details for this job', async () => {
    const { customer, job, due } = await visitToConfirm();
    expect(await runDue(db, deps, firm, due)).toEqual({ ran: 'done', outcome: 'sent' });
    const [message] = await listMessagesBetween(db, firm, ...allTime);
    expect(message).toMatchObject({ kind: 'visit_confirmation_first', state: 'sent', segments: 2 });
    const token = /\/d\/([0-9a-z]{26}) /.exec(message?.words ?? '')?.[1];
    if (token === undefined) throw new Error('No link');
    expect(await findLink(db, token)).toEqual({ firm, customer, job, expiresAt: instantFromIso('2026-10-12T11:15:00+01:00') });
    expect((await historyForJob(db, firm, job)).map((entry) => entry.kind)).toEqual(['confirmation_sent']);
  });

  it('gives the same link when its row is run again', async () => {
    const { customer, job, due } = await visitToConfirm();
    const first = await linkForDue(db, firm, { due, customer, job });
    expect(await linkForDue(db, firm, { due, customer, job })).toBe(first);
  });

  it('carries no link for a customer the firm has texted before', async () => {
    const { visit, due } = await visitToConfirm();
    await runDue(db, deps, firm, due);
    const again = await addDue(db, firm, { action: 'send_confirmation', visit, runAt: clock.now(), latestAt: thursday3pm });
    await runDue(db, deps, firm, again);
    const messages = await listMessagesBetween(db, firm, ...allTime);
    expect(messages.map((message) => message.kind)).toEqual(['visit_confirmation_first', 'visit_confirmation']);
    expect(messages[1]?.words).toBe(
      "Hi Mrs Ahmed, it's Tidewell Heating. Tom will be with you on Thursday 1 October at 3pm to look at the job and price it. Need to change it? Just reply here.",
    );
    expect(messages[1]?.segments).toBe(1);
  });

  it('is not sent, and says why, while this copy has no address for links, and makes no link', async () => {
    const { customer, due } = await visitToConfirm();
    expect(await runDue(db, { ...deps, linkAddress: null }, firm, due)).toEqual({ ran: 'done', outcome: 'not_sent' });
    expect(await listMessagesBetween(db, firm, ...allTime)).toMatchObject([{ state: 'not_sent', reason: 'no_link_address', to: { customer } }]);
    expect(deps.texts.sent.filter((text) => text.from === `+447700900${String(numbers)}`)).toEqual([]);
  });

  it('is not sent to a customer with no mobile, and makes no link', async () => {
    const { due } = await visitToConfirm(null);
    expect(await runDue(db, deps, firm, due)).toEqual({ ran: 'done', outcome: 'not_sent' });
    expect(await listMessagesBetween(db, firm, ...allTime)).toMatchObject([{ reason: 'no_mobile' }]);
  });

  it('is not sent for a firm with no agreed words for the first text', async () => {
    const plain = await tidewell(db, `+447700901${String(numbers)}`, ['visit_confirmation_first']);
    const { due } = await visitFor(plain);
    expect(await runDue(db, deps, plain, due)).toEqual({ ran: 'done', outcome: 'not_sent' });
    expect(await listMessagesBetween(db, plain, ...allTime)).toMatchObject([{ reason: 'no_wording' }]);
  });

  it('gives the visit’s new time when it moved before the confirmation went, and nothing once it is cancelled', async () => {
    const { visit, due } = await visitToConfirm();
    expect(await ownDiary(db).move(firm, visit, instantFromIso('2026-10-02T09:00:00+01:00'), frontline)).toBe('moved');
    await runDue(db, deps, firm, due);
    expect((await listMessagesBetween(db, firm, ...allTime))[0]?.words).toContain('on Friday 2 October at 9am');

    const second = await visitToConfirm('07700 900015');
    await ownDiary(db).cancel(firm, second.visit, frontline);
    const again = await addDue(db, firm, { action: 'send_confirmation', visit: second.visit, runAt: clock.now(), latestAt: thursday3pm });
    expect(await runDue(db, deps, firm, again)).toEqual({ ran: 'done', outcome: 'visit_changed' });
  });
});

/** Mrs Ahmed, her job and a quote visit on Thursday at 3pm, for another firm, with the row for its confirmation. */
async function visitFor(of: FirmId): Promise<{ due: DueId }> {
  const customer = await createCustomer(db, of, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
  const job = await createJob(db, of, { customer, about: 'Boiler replacement', place: '27 Station Road', urgent: false });
  const visit = await createVisit(db, of, { job, startsAt: thursday3pm, kind: 'quote_visit' });
  return { due: await addDue(db, of, { action: 'send_confirmation', visit, runAt: clock.now(), latestAt: thursday3pm }) };
}

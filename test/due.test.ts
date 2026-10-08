// The due list and the clock (rule 20 in CLAUDE.md, and slice D): every
// minute the rows whose time has come go on the queue; a worker claims a row
// in one step, acts and marks it done; a row past its latest time is skipped,
// and that is recorded. Acting twice does no harm.

import { createExecutionContext, createMessageBatch, getQueueResult } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { instant, instantFromIso, pretendClock } from '../src/clock';
import { everyMinute, onQueue, runDue } from '../src/due';
import { newId } from '../src/ids';
import { londonInstant } from '../src/london';
import { ukMobile } from '../src/phone';
import {
  addDue,
  cancelDue,
  claimDue,
  createCustomer,
  createJob,
  createVisit,
  finishDue,
  getDue,
  listMessagesBetween,
  optOut,
  releaseDue,
  setService,
  setStopButton,
} from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import { CLAIM_HOLDS_FOR, REQUEUE_AFTER } from '../src/record/due';
import type { CustomerId, DueId, FirmId, JobId, VisitId } from '../src/record/types';
import { send } from '../src/send';
import { testDeps, type TestDeps } from './helpers/deps';
import { tidewell } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-09-28T11:15:00+01:00'));
const db = openRecord(env.DB, clock);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const frontline = { kind: 'frontline' } as const;
const minute = 60_000;

let deps: TestDeps;
let firm: FirmId;
let numbers = 900;

beforeEach(async () => {
  clock.set(instantFromIso('2026-09-28T11:15:00+01:00'));
  deps = testDeps(clock);
  numbers += 1;
  firm = await tidewell(db, `+447700902${String(numbers).slice(-3)}`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A customer of this test's firm with a visit at the given time. */
async function booked(startsAt: string): Promise<{ customer: CustomerId; job: JobId; visit: VisitId }> {
  const customer = await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003') });
  const job = await createJob(db, firm, { customer, about: 'Boiler replacement', place: '27 Station Road', urgent: false });
  const visit = await createVisit(db, firm, { job, startsAt: instantFromIso(startsAt), kind: 'quote_visit' });
  return { customer, job, visit };
}

async function visitAt(startsAt: string): Promise<VisitId> {
  return (await booked(startsAt)).visit;
}

/**
 * The reminder for a visit as slice E will write it: at 1pm UK time the day
 * before, and no later than the start of the visit's day, so that it never
 * says "tomorrow" on the day itself.
 */
async function reminderFor(visit: VisitId, day: { year: number; month: number; day: number }): Promise<DueId> {
  return addDue(db, firm, {
    action: 'send_reminder',
    visit,
    runAt: londonInstant(day.year, day.month, day.day - 1, 13),
    latestAt: londonInstant(day.year, day.month, day.day, 0),
  });
}

/** What the clock puts on the queue for this test's firm, at the clock's time. */
async function queuedNow(): Promise<DueId[]> {
  const before = deps.queue.bodies.length;
  await everyMinute(env.DB, deps);
  return deps.queue.bodies.slice(before).filter((body) => body.firm === firm).map((body) => body.due);
}

describe('the clock', () => {
  it('runs a row set for 1pm UK time on Sunday 18 October 2026 at 12:00 UTC', async () => {
    // Step 4: Mrs Green's reminder, for her visit on Monday 19 October at 9am.
    const row = await reminderFor(await visitAt('2026-10-19T09:00:00+01:00'), { year: 2026, month: 10, day: 19 });
    clock.set(instantFromIso('2026-10-18T11:59:00Z'));
    expect(await queuedNow()).toEqual([]);
    clock.set(instantFromIso('2026-10-18T12:00:00Z'));
    expect(await queuedNow()).toEqual([row]);
  });

  it('runs a row set for 1pm UK time on Sunday 25 October 2026, after the clocks go back, at 13:00 UTC', async () => {
    // Step 7: the reminder for a visit on Monday 26 October at 9am.
    const row = await reminderFor(await visitAt('2026-10-26T09:00:00Z'), { year: 2026, month: 10, day: 26 });
    clock.set(instantFromIso('2026-10-25T12:59:00Z'));
    expect(await queuedNow()).toEqual([]);
    clock.set(instantFromIso('2026-10-25T13:00:00Z'));
    expect(await queuedNow()).toEqual([row]);
  });

  it('runs a row set for 1pm UK time on Sunday 28 March 2027, after the clocks go forward, at 12:00 UTC', async () => {
    // Step 7: the reminder for a visit on Monday 29 March 2027.
    const row = await reminderFor(await visitAt('2027-03-29T09:00:00+01:00'), { year: 2027, month: 3, day: 29 });
    clock.set(instantFromIso('2027-03-28T11:59:00Z'));
    expect(await queuedNow()).toEqual([]);
    clock.set(instantFromIso('2027-03-28T12:00:00Z'));
    expect(await queuedNow()).toEqual([row]);
  });

  it('does not put a row on the queue again for a few minutes, in case the first is still on its way', async () => {
    const row = await addDue(db, firm, { action: 'send_reminder', runAt: clock.now(), latestAt: instant(clock.now() + 60 * minute) });
    expect(await queuedNow()).toEqual([row]);
    clock.advance(minute);
    expect(await queuedNow()).toEqual([]);
    clock.advance(REQUEUE_AFTER);
    expect(await queuedNow()).toEqual([row]);
  });

  it('leaves alone a row that is finished, cancelled, or claimed by a worker still at it', async () => {
    const done = await addDue(db, firm, { action: 'send_reminder', runAt: clock.now(), latestAt: clock.now() });
    const claimed = await claimDue(db, firm, done);
    if (claimed === null) throw new Error('Not claimed');
    await finishDue(db, firm, done, claimed.claim, 'visit_changed');
    const cancelled = await addDue(db, firm, { action: 'send_reminder', runAt: clock.now(), latestAt: clock.now() });
    expect(await cancelDue(db, firm, cancelled)).toBe(true);
    const held = await addDue(db, firm, { action: 'send_reminder', runAt: clock.now(), latestAt: clock.now() });
    expect(await claimDue(db, firm, held)).not.toBeNull();
    expect(await queuedNow()).toEqual([]);
  });

  it('offers again a row whose worker stopped halfway, once its claim has run out', async () => {
    const row = await addDue(db, firm, { action: 'send_reminder', runAt: clock.now(), latestAt: instant(clock.now() + 60 * minute) });
    expect(await claimDue(db, firm, row)).not.toBeNull();
    clock.advance(CLAIM_HOLDS_FOR - minute);
    expect(await queuedNow()).toEqual([]);
    expect(await claimDue(db, firm, row)).toBeNull();
    clock.advance(minute);
    expect(await queuedNow()).toEqual([row]);
    expect(await claimDue(db, firm, row)).not.toBeNull();
  });
});

describe('the worker', () => {
  it('takes rows from the queue, sends the reminder, and marks the row done', async () => {
    const visit = await visitAt('2026-10-01T15:00:00+01:00');
    const row = await reminderFor(visit, { year: 2026, month: 10, day: 1 });
    // Step 3: Wednesday 30 September at 13:00.
    clock.set(instantFromIso('2026-09-30T13:00:00+01:00'));
    const queued = await queuedNow();
    const batch = createMessageBatch('frontline-local-due', queued.map((due, i) => ({ id: String(i), timestamp: new Date(clock.now()), attempts: 1, body: { firm, due } })));
    const ctx = createExecutionContext();
    await onQueue(batch, env.DB, deps);
    expect(await getQueueResult(batch, ctx)).toMatchObject({ explicitAcks: ['0'], retryMessages: [] });

    expect(deps.texts.sent.map((text) => text.body)).toEqual(["Reminder: Tom's visit is tomorrow, Thursday, at 3pm. See you then."]);
    expect(await getDue(db, firm, row)).toMatchObject({ state: 'done', outcome: 'sent', finishedAt: clock.now() });
  });

  it('sends one text when two workers take the same row at the same moment', async () => {
    const row = await reminderFor(await visitAt('2026-10-01T15:00:00+01:00'), { year: 2026, month: 10, day: 1 });
    clock.set(instantFromIso('2026-09-30T13:00:00+01:00'));
    const runs = await Promise.all([runDue(db, deps, firm, row), runDue(db, deps, firm, row)]);
    expect(runs).toEqual(expect.arrayContaining([{ ran: 'done', outcome: 'sent' }, { ran: 'not_ours' }]));
    expect(deps.texts.sent).toHaveLength(1);
    expect(await listMessagesBetween(db, firm, ...allTime)).toHaveLength(1);
  });

  it('sends one text when the worker runs twice at 13:00 (step 3)', async () => {
    const row = await reminderFor(await visitAt('2026-10-01T15:00:00+01:00'), { year: 2026, month: 10, day: 1 });
    clock.set(instantFromIso('2026-09-30T13:00:00+01:00'));
    await runDue(db, deps, firm, row);
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'not_ours' });
    expect(deps.texts.sent).toHaveLength(1);
  });

  it('sends nothing more when a worker that stopped halfway has its row run again', async () => {
    const { customer, job, visit } = await booked('2026-10-01T15:00:00+01:00');
    const row = await reminderFor(visit, { year: 2026, month: 10, day: 1 });
    clock.set(instantFromIso('2026-09-30T13:00:00+01:00'));
    // The first worker claimed the row and sent the text, then stopped
    // before it marked the row done.
    expect(await claimDue(db, firm, row)).not.toBeNull();
    await send(deps.texts, db, firm, {
      due: row,
      kind: 'visit_reminder',
      to: { kind: 'customer', customer },
      about: { job, visit, call: null },
      facts: { owner: 'Tom', weekday: 'Thursday', time: '3pm' },
    });
    expect(deps.texts.sent).toHaveLength(1);

    // Once its claim has run out, the clock offers the row again, and the
    // next worker finds the text already sent.
    clock.advance(CLAIM_HOLDS_FOR);
    expect(await queuedNow()).toEqual([row]);
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(deps.texts.sent).toHaveLength(1);
    expect(await getDue(db, firm, row)).toMatchObject({ state: 'done', outcome: 'sent' });
  });

  it('skips a row past its latest time, records it, and sends nothing', async () => {
    const row = await reminderFor(await visitAt('2026-10-01T15:00:00+01:00'), { year: 2026, month: 10, day: 1 });
    clock.set(instantFromIso('2026-10-01T00:00:01+01:00'));
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'skipped', outcome: 'too_late' });
    expect(await getDue(db, firm, row)).toMatchObject({ state: 'skipped', outcome: 'too_late', finishedAt: clock.now() });
    expect(deps.texts.sent).toEqual([]);
    expect(logged.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown)).toContainEqual({ firm, due: row, event: 'due_too_late' });
  });

  it('sends no reminder for a visit that is no longer tomorrow, as when it was moved', async () => {
    const visit = await visitAt('2026-10-01T15:00:00+01:00');
    // A reminder written for when the visit was a day earlier.
    const early = await reminderFor(visit, { year: 2026, month: 9, day: 30 });
    clock.set(instantFromIso('2026-09-29T13:00:00+01:00'));
    expect(await runDue(db, deps, firm, early)).toEqual({ ran: 'done', outcome: 'visit_changed' });
    expect(deps.texts.sent).toEqual([]);
  });

  it('records an opt-out as a text not sent, and the row as done', async () => {
    const { customer, visit } = await booked('2026-10-01T15:00:00+01:00');
    const row = await reminderFor(visit, { year: 2026, month: 10, day: 1 });
    await optOut(db, firm, customer, 'visit_reminder', frontline);
    clock.set(instantFromIso('2026-09-30T13:00:00+01:00'));
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'done', outcome: 'not_sent' });
    expect(await listMessagesBetween(db, firm, ...allTime)).toMatchObject([{ state: 'not_sent', reason: 'opted_out' }]);
    expect(deps.texts.sent).toEqual([]);
  });
});

describe('the stop button and the service switch hold texts until their latest time (step 8)', () => {
  it('puts the row back to wait while the stop button is on, and sends when it is turned off in time', async () => {
    const row = await reminderFor(await visitAt('2026-10-01T15:00:00+01:00'), { year: 2026, month: 10, day: 1 });
    await setStopButton(db, firm, true, frontline);
    clock.set(instantFromIso('2026-09-30T13:00:00+01:00'));
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'held' });
    expect(await getDue(db, firm, row)).toMatchObject({ state: 'waiting', outcome: null });
    expect(deps.texts.sent).toEqual([]);

    // Offered again by the clock a few minutes later: still held.
    clock.advance(REQUEUE_AFTER);
    expect(await queuedNow()).toEqual([row]);
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'held' });

    await setStopButton(db, firm, false, frontline);
    clock.advance(REQUEUE_AFTER);
    expect(await queuedNow()).toEqual([row]);
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(deps.texts.sent).toHaveLength(1);
  });

  it('skips it, and records that, when the stop button is turned off too late: it never goes out late', async () => {
    const row = await reminderFor(await visitAt('2026-10-01T15:00:00+01:00'), { year: 2026, month: 10, day: 1 });
    await setStopButton(db, firm, true, frontline);
    clock.set(instantFromIso('2026-09-30T13:00:00+01:00'));
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'held' });

    // Turned off after Thursday 1 October.
    clock.set(instantFromIso('2026-10-02T09:00:00+01:00'));
    await setStopButton(db, firm, false, frontline);
    expect(await queuedNow()).toEqual([row]);
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'skipped', outcome: 'too_late' });
    expect(deps.texts.sent).toEqual([]);
    expect(await getDue(db, firm, row)).toMatchObject({ state: 'skipped', outcome: 'too_late' });
  });

  it('holds a text while the firm’s switch for its service is off', async () => {
    const row = await reminderFor(await visitAt('2026-10-01T15:00:00+01:00'), { year: 2026, month: 10, day: 1 });
    await setService(db, firm, 'calls', false, frontline);
    clock.set(instantFromIso('2026-09-30T13:00:00+01:00'));
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'held' });
    await setService(db, firm, 'calls', true, frontline);
    clock.advance(REQUEUE_AFTER);
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'done', outcome: 'sent' });
  });
});

describe('the rows themselves', () => {
  it('refuse a latest time before the time to run, and an action not on the list', async () => {
    await expect(addDue(db, firm, { action: 'send_reminder', runAt: clock.now(), latestAt: instant(clock.now() - 1) })).rejects.toThrow(Refused);
    await expect(addDue(db, firm, { action: 'delete_everything' as never, runAt: clock.now(), latestAt: clock.now() })).rejects.toThrow(Refused);
  });

  it('are cancelled only while waiting', async () => {
    const row = await addDue(db, firm, { action: 'send_reminder', runAt: clock.now(), latestAt: clock.now() });
    expect(await cancelDue(db, firm, row)).toBe(true);
    expect(await cancelDue(db, firm, row)).toBe(false);
    expect(await claimDue(db, firm, row)).toBeNull();
    expect(await getDue(db, firm, row)).toMatchObject({ state: 'cancelled', outcome: 'cancelled' });
  });

  it('are not claimed before their time', async () => {
    const row = await addDue(db, firm, { action: 'send_reminder', runAt: instant(clock.now() + minute), latestAt: instant(clock.now() + minute) });
    expect(await claimDue(db, firm, row)).toBeNull();
  });

  it('can be finished or put back only by the worker holding the claim', async () => {
    const row = await addDue(db, firm, { action: 'send_reminder', runAt: clock.now(), latestAt: clock.now() });
    const claimed = await claimDue(db, firm, row);
    if (claimed === null) throw new Error('Not claimed');
    expect(await finishDue(db, firm, row, newId(), 'sent')).toBe(false);
    expect(await releaseDue(db, firm, row, newId())).toBe(false);
    expect(await finishDue(db, firm, row, claimed.claim, 'sent')).toBe(true);
    expect(await finishDue(db, firm, row, claimed.claim, 'sent')).toBe(false);
  });

  it('a message on the queue that is not a row is let go, and logged', async () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const batch = createMessageBatch('frontline-local-due', [{ id: '0', timestamp: new Date(clock.now()), attempts: 1, body: { firm: 'Mrs Ahmed' } }]);
    await onQueue(batch, env.DB, deps);
    expect(await getQueueResult(batch, createExecutionContext())).toMatchObject({ explicitAcks: ['0'] });
    expect(logged.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown)).toEqual([{ event: 'due_unreadable' }]);
  });
});

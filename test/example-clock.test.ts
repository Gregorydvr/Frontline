// The demo firm's own clock, and resetting the example, from the control room
// (slice G of docs/build-brief.md). Moving one firm's clock on moves no other
// firm's: the system's clock is never changed, and each firm's rows are due by
// its own. A reset deletes the demo firm and everything in it, and loads it
// fresh. Neither can touch a firm that is not an example, and an example
// firm's texts never reach a real provider.

import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { runDue } from '../src/due';
import { loadExample } from '../src/example/load';
import { EXAMPLE_NOW } from '../src/example/tidewell';
import { ukMobile } from '../src/phone';
import {
  addDue,
  createVisit,
  deleteExampleFirm,
  exampleFirms,
  findCustomersByMobile,
  findOrAddStaff,
  getDue,
  getFirm,
  historyForJob,
  listCustomers,
  listJobsForCustomer,
  listMessagesForJob,
} from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import { FIRM_TABLES } from '../src/record/example';
import type { DueId, FirmId, JobId } from '../src/record/types';
import { controlForm, controlOpener } from './helpers/control';
import { firmRows, recordTables, staffLogRows, tableColumns } from './helpers/db';
import { testDeps } from './helpers/deps';
import { opener, ownerCookie } from './helpers/owner';
import { pretendTwilio } from './helpers/twilio';

const clock = pretendClock(instantFromIso(EXAMPLE_NOW));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const app = createApp(() => deps);
const open = controlOpener(app);

/** The demo firm, and a real firm of the same shape. */
let example: FirmId;
let real: FirmId;
/** Each firm's reminder for Mr Clarke's visit on Monday 19 October, due at 1pm on Sunday. */
const reminders = new Map<FirmId, { due: DueId; job: JobId }>();

beforeAll(async () => {
  example = await loadExample(env.DB);
  real = await loadExample(env.DB, { name: 'Second Example Firm', isExample: false, number: '07700 900200' });
  for (const firm of [example, real]) {
    const [clarke] = await findCustomersByMobile(db, firm, ukMobile('07700 900005'));
    const [job] = clarke === undefined ? [] : await listJobsForCustomer(db, firm, clarke.id);
    if (job === undefined) throw new Error('No job');
    const visit = await createVisit(db, firm, { job: job.id, startsAt: instantFromIso('2026-10-19T09:00:00+01:00'), kind: 'quote_visit' });
    const due = await addDue(db, firm, {
      action: 'send_reminder',
      visit,
      runAt: instantFromIso('2026-10-18T13:00:00+01:00'),
      latestAt: instantFromIso('2026-10-19T00:00:00+01:00'),
    });
    reminders.set(firm, { due, job: job.id });
  }
});

function reminderOf(firm: FirmId): { due: DueId; job: JobId } {
  const found = reminders.get(firm);
  if (found === undefined) throw new Error('No reminder');
  return found;
}

describe('moving the demo firm’s clock on', () => {
  it('makes its rows due by its own clock, and no other firm’s', async () => {
    deps.queue.bodies.length = 0;
    const moved = await open(`/control/firms/${example}/clock`, controlForm({ to: '2026-10-18T13:05' }));
    expect(moved.status).toBe(303);

    // The system's clock has not moved.
    expect(clock.now()).toBe(instantFromIso(EXAMPLE_NOW));
    // What came due went on the queue at once: the demo firm's reminder only.
    expect(deps.queue.bodies).toEqual([{ firm: example, due: reminderOf(example).due }]);
    for (const body of deps.queue.bodies) {
      expect(await runDue(db, deps, body.firm, body.due)).toEqual({ ran: 'done', outcome: 'sent' });
    }
    // The reminder went at 1:05pm on Sunday, by the demo firm's clock.
    const entry = (await historyForJob(db, example, reminderOf(example).job)).at(-1);
    expect(entry).toMatchObject({ kind: 'reminder_sent', at: instantFromIso('2026-10-18T13:05:00+01:00') });
    // The real firm's reminder is still waiting, and cannot be claimed yet.
    expect(await getDue(db, real, reminderOf(real).due)).toMatchObject({ state: 'waiting' });
    expect(await runDue(db, deps, real, reminderOf(real).due)).toEqual({ ran: 'not_ours' });

    expect((await staffLogRows(env.DB)).at(-1)).toMatchObject({ firm_id: example, what: 'moved_clock' });
  });

  it('shows the owner of the demo firm its own day, and every other owner the real one', async () => {
    const exampleHome = await (await opener(app, await ownerCookie(db, example))('/')).text();
    expect(exampleHome).toContain('Sunday 18 October');
    const realHome = await (await opener(app, await ownerCookie(db, real))('/')).text();
    expect(realHome).toContain('Thursday 15 October');
  });

  it('only goes forward', async () => {
    const before = (await getFirm(db, example))?.clockAhead;
    expect((await open(`/control/firms/${example}/clock`, controlForm({ to: '2026-10-16T09:00' }))).status).toBe(303);
    expect((await getFirm(db, example))?.clockAhead).toBe(before);
  });

  it('never sends the demo firm’s texts to a real provider', async () => {
    const { job } = reminderOf(example);
    const due = await addDue(db, example, {
      action: 'send_confirmation',
      visit: await createVisit(db, example, { job, startsAt: instantFromIso('2026-10-21T09:00:00+01:00'), kind: 'quote_visit' }),
      runAt: clock.now(),
      latestAt: instantFromIso('2026-10-21T00:00:00+01:00'),
    });
    expect(await runDue(db, { ...deps, texts: pretendTwilio() }, example, due)).toEqual({ ran: 'done', outcome: 'sent' });
    const sent = (await listMessagesForJob(db, example, job)).at(-1);
    expect(sent).toMatchObject({ kind: 'visit_confirmation', state: 'sent', provider: 'fake' });
  });
});

describe('resetting the example', () => {
  it('names every table that holds a firm’s rows, so a reset leaves none behind', async () => {
    const withFirm: string[] = [];
    for (const table of await recordTables(env.DB)) {
      if ((await tableColumns(env.DB, table)).some((column) => column.name === 'firm_id')) withFirm.push(table);
    }
    // The staff log and the list of deleted firms outlive the firm, and the
    // permission slip is never left behind.
    expect([...FIRM_TABLES].sort()).toEqual(withFirm.filter((table) => !['staff_log', 'erasing', 'deleted_firms'].includes(table)).sort());
  });

  it('is refused for a firm that is not an example, and deletes nothing', async () => {
    const before = await firmRows(env.DB, real);
    const staff = (await findOrAddStaff(db, 'staff@example.com')).id;
    await expect(deleteExampleFirm(db, real, staff)).rejects.toThrow(Refused);
    expect((await open(`/control/firms/${real}/reset`, controlForm({}))).status).toBe(404);
    expect(await firmRows(env.DB, real)).toEqual(before);
  });

  it('deletes the demo firm and everything in it, loads it fresh with its clock at the example’s "today", and touches no other firm', async () => {
    const before = await firmRows(env.DB, real);
    const asked = await open(`/control/firms/${example}/reset`);
    expect(await asked.text()).toContain('Reset the example?');

    const reset = await open(`/control/firms/${example}/reset`, controlForm({}));
    expect(reset.status).toBe(303);
    for (const [table, rows] of Object.entries(await firmRows(env.DB, example))) {
      if (table === 'staff_log') continue;
      expect(rows, table).toEqual([]);
    }
    const [fresh] = await exampleFirms(db);
    if (fresh === undefined) throw new Error('Not loaded');
    expect(reset.headers.get('Location')).toBe(`/control/firms/${fresh}`);
    expect(await listCustomers(db, fresh)).toHaveLength(16);
    expect(clock.now() + ((await getFirm(db, fresh))?.clockAhead ?? NaN)).toBe(instantFromIso(EXAMPLE_NOW));
    expect(await firmRows(env.DB, real)).toEqual(before);
    expect((await staffLogRows(env.DB)).slice(-2)).toMatchObject([
      { firm_id: example, what: 'reset_example' },
      { firm_id: fresh, what: 'loaded_example' },
    ]);
  });
});

// The control room (slice G of docs/build-brief.md): who may open it, where,
// that every view and action is recorded (rule 15), the firm's switches and
// stop button, what needs a look, what the owner wrote in Message us, and the
// demo firm's tools, which are never on live.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instant, instantFromIso, pretendClock } from '../src/clock';
import { copyFrom, type Deps } from '../src/deps';
import { runDue } from '../src/due';
import { EXAMPLE_NOW } from '../src/example/tidewell';
import { CLOSED_GATE } from '../src/providers/access';
import { ukMobile } from '../src/phone';
import {
  addDue,
  claimDue,
  createFirm,
  createVisit,
  deleteExampleFirm,
  exampleFirms,
  findOrAddStaff,
  getFirm,
  historyBetween,
  holdTime,
  listOwnerMessages,
  listOwners,
  needsALook,
  recordCall,
  recordOwnerMessage,
  releaseHold,
  setExampleClock,
  setService,
} from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import type { FirmId } from '../src/record/types';
import { controlForm, controlOpener } from './helpers/control';
import { firmRows, staffLogRows, tryToMoveClock } from './helpers/db';
import { APP_ADDRESS, testDeps } from './helpers/deps';
import { asAnotherCall, report, send, tidewell, withDetails } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-10-15T10:00:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const openAs = (more: Partial<Deps> = {}) => controlOpener(createApp(() => ({ ...deps, ...more })));
const open = openAs();
let numbers = 0;

/** A firm set up as a real one is, on a number of its own. */
async function aFirm(): Promise<FirmId> {
  return (await aFirmOn()).firm;
}

async function aFirmOn(): Promise<{ firm: FirmId; number: string }> {
  numbers += 1;
  const number = `+4477009003${String(numbers).padStart(2, '0')}`;
  return { firm: await tidewell(db, number), number };
}

describe('who may open the control room', () => {
  it('answers only at its own address: the owner’s app’s address does not serve it', async () => {
    const answer = await createApp(() => deps).request(`${APP_ADDRESS}/control`, {}, env);
    expect(answer.status).toBe(404);
  });

  it('is shut while the copy has no address for it', async () => {
    expect((await openAs({ controlAddress: null })('/control')).status).toBe(404);
  });

  it('refuses everyone, and records nothing, when no member of staff is vouched for', async () => {
    const before = await staffLogRows(env.DB);
    const answer = await openAs({ staff: CLOSED_GATE })('/control');
    expect(answer.status).toBe(403);
    expect(await answer.text()).not.toContain('Tidewell Heating');
    expect(await staffLogRows(env.DB)).toEqual(before);
  });

  it('refuses a form posted from anywhere but its own pages, and changes nothing', async () => {
    const firm = await aFirm();
    const before = await firmRows(env.DB, firm);
    const answer = await open(`/control/firms/${firm}/stop`, controlForm({ on: '1' }, 'https://elsewhere.example'));
    expect(answer.status).toBe(403);
    expect(await firmRows(env.DB, firm)).toEqual(before);
  });

  it('is sent with no copies kept, search engines kept out, and no scripts', async () => {
    const answer = await open('/control');
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    expect(answer.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(answer.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(await answer.text()).not.toContain('<script');
  });
});

describe('every view is recorded', () => {
  it('in the staff log, with who looked, at what, and when, by id only', async () => {
    const firm = await aFirm();
    const staff = (await findOrAddStaff(db, 'staff@example.com')).id;
    const before = (await staffLogRows(env.DB)).length;

    expect((await open('/control')).status).toBe(200);
    expect((await open(`/control/firms/${firm}`)).status).toBe(200);
    expect((await open(`/control/firms/${firm}/customers?q=quill`)).status).toBe(200);

    const logged = (await staffLogRows(env.DB)).slice(before);
    expect(logged).toMatchObject([
      { firm_id: null, staff_id: staff, what: 'viewed_firms', at: clock.now() },
      { firm_id: firm, staff_id: staff, what: 'viewed_firm', at: clock.now() },
      { firm_id: firm, staff_id: staff, what: 'searched_customers', at: clock.now() },
    ]);
  });

  it('and so is a customer’s page, with the customer', async () => {
    const firm = await aFirm();
    const call = await recordCall(db, firm, {
      provider: 'vapi',
      providerCallId: `view-${firm}`,
      startedAt: clock.now(),
      endedAt: null,
      from: ukMobile('07700 900088'),
      for: { kind: 'new_customer', name: 'Mr Wren', mobile: ukMobile('07700 900088'), landline: null, noText: null, about: 'Boiler service', place: '3 Elm Row' },
      urgentItem: null,
      summary: 'Boiler service due.',
      transcript: null,
    });
    const page = await open(`/control/firms/${firm}/customers/${call.customer ?? ''}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Mr Wren');
    expect((await staffLogRows(env.DB)).at(-1)).toMatchObject({ firm_id: firm, what: 'viewed_customer', customer_id: call.customer });
  });

  it('is not made for a firm or customer that is not there: "not found"', async () => {
    const firm = await aFirm();
    expect((await open('/control/firms/00000000000000000000000000')).status).toBe(404);
    expect((await open(`/control/firms/${firm}/customers/00000000000000000000000000`)).status).toBe(404);
    expect((await open('/control/firms/not-an-id')).status).toBe(404);
  });
});

describe('a firm’s switches and stop button', () => {
  it('are changed by staff, recorded in the firm’s history as done by staff, and in the staff log', async () => {
    const firm = await aFirm();
    const staff = (await findOrAddStaff(db, 'staff@example.com')).id;
    expect((await open(`/control/firms/${firm}/service`, controlForm({ service: 'calls', on: '0' }))).status).toBe(303);
    expect((await open(`/control/firms/${firm}/stop`, controlForm({ on: '1' }))).status).toBe(303);

    const now = await getFirm(db, firm);
    expect(now?.services.calls).toBe(false);
    expect(now?.stopped).toBe(true);
    const entries = (await historyBetween(db, firm, ...allTime)).filter((entry) => entry.by.kind === 'staff');
    expect(entries.map((entry) => [entry.kind, entry.service, entry.by])).toEqual([
      ['service_off', 'calls', { kind: 'staff', staff }],
      ['stop_on', null, { kind: 'staff', staff }],
    ]);
    expect((await staffLogRows(env.DB)).slice(-2)).toMatchObject([
      { firm_id: firm, what: 'service_off', service: 'calls' },
      { firm_id: firm, what: 'stop_on' },
    ]);
  });

  it('refuse a service that is not one of the five', async () => {
    const firm = await aFirm();
    const before = await firmRows(env.DB, firm);
    expect((await open(`/control/firms/${firm}/service`, controlForm({ service: 'stopped', on: '1' }))).status).toBe(400);
    expect(await firmRows(env.DB, firm)).toEqual(before);
  });
});

describe('what needs a look', () => {
  it('shows what until now only a log line told staff', async () => {
    const { firm, number } = await aFirmOn();
    const app = createApp(() => deps);
    // The agent thought it urgent, for something not on the firm's list.
    const notOnList = withDetails(report('mr-price-leak', number), (data) => ({ ...data, urgentMatch: 'no heating' }));
    expect((await send(app, notOnList)).status).toBe(200);
    // A call while the firm's calls were switched off.
    await setService(db, firm, 'calls', false, { kind: 'frontline' });
    clock.advance(60_000);
    const offCall = withDetails(asAnotherCall(report('mr-price-leak', number), 'look-off'), (data) => ({ ...data, urgentMatch: null }));
    expect((await send(app, offCall)).status).toBe(200);
    // A time held and let go.
    const hold = await holdTime(db, firm, {
      provider: 'vapi',
      providerCallId: 'look-hold',
      kind: 'quote_visit',
      startsAt: instantFromIso('2026-10-21T10:00:00+01:00'),
      endsAt: instantFromIso('2026-10-21T11:00:00+01:00'),
    });
    if (hold === null) throw new Error('Not held');
    await releaseHold(db, firm, hold);
    // A row a worker claimed and never finished.
    const [call] = (await firmRows(env.DB, firm)).calls as { id: string; job_id: string }[];
    const visit = await createVisit(db, firm, { job: call?.job_id as never, startsAt: instantFromIso('2026-10-22T09:00:00+01:00'), kind: 'quote_visit' });
    const stuck = await addDue(db, firm, { action: 'send_reminder', visit, runAt: clock.now(), latestAt: instantFromIso('2026-10-22T00:00:00+01:00') });
    await claimDue(db, firm, stuck);
    clock.advance(11 * 60_000);

    const kinds = (await needsALook(db, firm, instant(clock.now() - 24 * 60 * 60_000))).map((item) => item.kind);
    // Both calls started after the switch went off, as their reports say.
    expect(kinds.sort()).toEqual(['call_while_off', 'call_while_off', 'hold_let_go', 'stuck', 'urgent_not_on_list']);
    const page = await (await open(`/control/firms/${firm}`)).text();
    expect(page).toContain('The agent thought this urgent; it is not on the firm’s urgent list.');
    expect(page).toContain('Came while calls were switched off.');
    expect(page).toContain('A time was held on this call and let go. The caller may have been told a time.');
    expect(page).toContain('a reminder that never finished.');
  });

  it('shows an urgent call with nobody to alert', async () => {
    const firm = await createFirm(db, { name: 'Firm With No Owner', isExample: false });
    const call = await recordCall(db, firm, {
      provider: 'vapi',
      providerCallId: `nobody-${firm}`,
      startedAt: clock.now(),
      endedAt: null,
      from: ukMobile('07700 900089'),
      for: { kind: 'details_missing' },
      urgentItem: 'a leak',
      summary: 'Water everywhere.',
      transcript: null,
    });
    if (call.alert === null) throw new Error('No alert');
    expect(await runDue(db, deps, firm, call.alert)).toMatchObject({ outcome: 'nobody_to_tell' });
    // Its calls service was never switched on, too.
    expect((await needsALook(db, firm, instant(clock.now() - 60_000))).map((item) => item.kind).sort()).toEqual(['call_while_off', 'nobody_to_alert']);
  });
});

describe('Message us', () => {
  it('shows what the owner wrote, unread until staff open the firm’s page', async () => {
    const firm = await aFirm();
    const [owner] = await listOwners(db, firm);
    if (owner === undefined) throw new Error('No owner');
    await recordOwnerMessage(db, firm, owner.id, 'Please put my call-out charge up.');
    expect(await listOwnerMessages(db, firm)).toMatchObject([{ words: 'Please put my call-out charge up.', unread: true }]);
    expect(await (await open('/control')).text()).toContain('1 unread from the owner');

    clock.advance(1);
    const page = await (await open(`/control/firms/${firm}`)).text();
    expect(page).toContain('Please put my call-out charge up.');
    expect(page).toContain('Unread');
    expect(await listOwnerMessages(db, firm)).toMatchObject([{ unread: false }]);
  });
});

describe('the demo firm’s tools', () => {
  it('count as live when the copy’s setting is anything but practice, or missing', () => {
    expect(copyFrom('practice')).toBe('practice');
    for (const setting of ['live', 'local', 'Practice', '', undefined]) {
      expect(copyFrom(setting)).toBe('live');
    }
  });

  it('are not there on live: their addresses are "not found", their buttons not drawn, and nothing changes', async () => {
    const live = openAs({ copy: 'live' });
    const firm = (await exampleFirms(db))[0] ?? (await createFirm(db, { name: 'Tidewell Heating', isExample: true }));
    const before = await firmRows(env.DB, firm);
    expect((await live('/control/example', controlForm({}))).status).toBe(404);
    expect((await live(`/control/firms/${firm}/clock`, controlForm({ by: 'day' }))).status).toBe(404);
    expect((await live(`/control/firms/${firm}/reset`)).status).toBe(404);
    expect((await live(`/control/firms/${firm}/reset`, controlForm({}))).status).toBe(404);
    const page = await (await live(`/control/firms/${firm}`)).text();
    expect(page).not.toContain('Move on');
    expect(page).not.toContain('Reset the example');
    expect(await (await live('/control')).text()).not.toContain('Load the example');
    const after = await firmRows(env.DB, firm);
    expect(after.firms).toEqual(before.firms);
    expect(await exampleFirms(db)).toEqual([firm]);
  });

  it('are refused for a firm that is not an example, by the record and by the database', async () => {
    const firm = await aFirm();
    const staff = (await findOrAddStaff(db, 'staff@example.com')).id;
    const before = await firmRows(env.DB, firm);
    await expect(setExampleClock(db, firm, instant(clock.now() + 60_000), staff, 'move_on')).rejects.toThrow(Refused);
    await expect(tryToMoveClock(env.DB, firm)).rejects.toThrow(/CHECK constraint failed/);
    expect((await open(`/control/firms/${firm}/clock`, controlForm({ by: 'day' }))).status).toBe(404);
    expect(await firmRows(env.DB, firm)).toEqual(before);
  });

  it('on practice, load the demo firm when there is none, with its clock at the example’s "today"', async () => {
    const staff = (await findOrAddStaff(db, 'staff@example.com')).id;
    for (const firm of await exampleFirms(db)) await deleteExampleFirm(db, firm, staff);
    expect(await (await open('/control')).text()).toContain('Load the example');

    const loaded = await open('/control/example', controlForm({}));
    expect(loaded.status).toBe(303);
    const [firm] = await exampleFirms(db);
    if (firm === undefined) throw new Error('Not loaded');
    expect(loaded.headers.get('Location')).toBe(`/control/firms/${firm}`);
    const tidewellNow = await getFirm(db, firm);
    expect(clock.now() + (tidewellNow?.clockAhead ?? 0)).toBe(instantFromIso(EXAMPLE_NOW));
    expect((await staffLogRows(env.DB)).at(-1)).toMatchObject({ firm_id: firm, what: 'loaded_example' });
  });
});

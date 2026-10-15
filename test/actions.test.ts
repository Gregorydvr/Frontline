// Every action in the app is a named action in src/actions.ts (task 4 of
// docs/autopilot.md): it says what it does and who may take it, anyone else
// is refused with nothing changed, and the record names who took it. Lint
// keeps the routes from changing the record any other way
// (test/fixtures/lint/change-outside-action.ts).

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, ACTIONS, whoIs, type ActionContext, type Who } from '../src/actions';
import { instantFromIso, pretendClock } from '../src/clock';
import { ukMobile } from '../src/phone';
import { createFirm, createOwner, findOrAddStaff, getFirm, historyBetween, setUrgentList } from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import type { Actor, FirmId, OwnerId, StaffId } from '../src/record/types';
import { staffLogRows } from './helpers/db';
import { testDeps } from './helpers/deps';

const clock = pretendClock(instantFromIso('2026-10-15T10:00:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;

let firm: FirmId;
let owner: OwnerId;
let staff: StaffId;
let mobiles = 400;

const as = (by: Actor): ActionContext => ({ db, d1: env.DB, deps, by });

beforeEach(async () => {
  mobiles += 1;
  firm = await createFirm(db, { name: 'Tidewell Heating', isExample: false });
  await setUrgentList(db, firm, ['a leak'], { kind: 'frontline' });
  owner = await createOwner(db, firm, { name: 'Tom', mobile: ukMobile(`07700 900${String(mobiles)}`) });
  staff = (await findOrAddStaff(db, 'staff@example.com')).id;
});

describe('the named actions', () => {
  it('each say what they do, in a sentence', () => {
    for (const [name, action] of Object.entries(ACTIONS)) {
      expect(action.says, name).toMatch(/^[A-Z].*\.$/);
      expect(action.says, name).not.toMatch(/\bshall\b/);
    }
  });

  it('each name who may take them: the owner, Front-line’s staff, the customer, or the system', () => {
    const whoMay = Object.fromEntries(Object.entries(ACTIONS).map(([name, action]) => [name, [...action.who]]));
    expect(whoMay).toEqual({
      land_call: ['system'],
      book_on_call: ['system'],
      take_text_in: ['system'],
      record_delivery: ['system'],
      send_login_link: ['system'],
      log_in: ['system'],
      log_out: ['owner'],
      message_frontline: ['owner'],
      confirm_details: ['customer'],
      switch_service: ['staff'],
      set_stop_button: ['staff'],
      export_customer: ['staff'],
      delete_customer: ['staff'],
      ask_firm_export: ['staff'],
      mark_leaving: ['staff'],
      cancel_leaving: ['staff'],
      delete_firm: ['staff'],
      replay_deletions: ['staff'],
      add_firm: ['staff'],
      add_owner: ['staff'],
      change_owner_mobile: ['staff'],
      set_firm_number: ['staff'],
      set_urgent_list: ['staff'],
      set_diary_rules: ['staff'],
      choose_trade: ['staff'],
      choose_services: ['staff'],
      buy_number: ['staff'],
      create_agent: ['staff'],
      agree_wording: ['staff'],
      set_agent: ['staff'],
      check_agent: ['staff'],
      overwrite_agent: ['staff'],
      load_example: ['staff'],
      move_example_clock: ['staff'],
      reset_example: ['staff'],
    } satisfies Record<keyof typeof ACTIONS, Who[]>);
  });

  it('read the record’s actors as the four who', () => {
    expect(whoIs({ kind: 'frontline' })).toBe('system');
    expect(whoIs({ kind: 'staff', staff })).toBe('staff');
    expect(whoIs({ kind: 'owner', owner })).toBe('owner');
    expect(whoIs({ kind: 'customer' })).toBe('customer');
  });
});

describe('taking an action', () => {
  it('as staff, does it and records the member of staff in the firm’s history and the staff log', async () => {
    await act(as({ kind: 'staff', staff }), 'set_urgent_list', { firm, items: ['a leak', 'no heating'] });
    expect((await getFirm(db, firm))?.urgentList).toEqual(['a leak', 'no heating']);
    const entries = (await historyBetween(db, firm, ...allTime)).filter((entry) => entry.kind === 'urgent_list_set');
    expect(entries.at(-1)?.by).toEqual({ kind: 'staff', staff });
    expect((await staffLogRows(env.DB)).filter((row) => row.firm_id === firm).map((row) => row.what)).toEqual(['set_urgent_list']);
  });

  it('as the owner, records the owner', async () => {
    await act(as({ kind: 'owner', owner }), 'message_frontline', { firm, words: 'Please put my day rate up.' });
    const entries = await historyBetween(db, firm, ...allTime);
    expect(entries.at(-1)).toMatchObject({ by: { kind: 'owner', owner } });
  });

  it.each([
    ['the owner', { kind: 'owner' } as const],
    ['a customer', { kind: 'customer' } as const],
    ['the system', { kind: 'frontline' } as const],
  ])('is refused to %s for an action only staff may take, and nothing changes', async (_, kind) => {
    const by: Actor = kind.kind === 'owner' ? { kind: 'owner', owner } : kind;
    await expect(act(as(by), 'set_urgent_list', { firm, items: ['no heating'] })).rejects.toThrow(Refused);
    await expect(act(as(by), 'switch_service', { firm, service: 'calls', on: true })).rejects.toThrow(Refused);
    const now = await getFirm(db, firm);
    expect(now?.urgentList).toEqual(['a leak']);
    expect(now?.services.calls).toBe(false);
  });

  it('is refused to staff and the system for what only the owner may do, and nothing is kept', async () => {
    for (const by of [{ kind: 'staff', staff }, { kind: 'frontline' }] as const) {
      await expect(act(as(by), 'message_frontline', { firm, words: 'Not from the owner.' })).rejects.toThrow(Refused);
    }
    expect((await historyBetween(db, firm, ...allTime)).filter((entry) => entry.kind === 'owner_message_sent')).toEqual([]);
  });

  it('is refused to anyone but the system for keeping a call or a delivery report', async () => {
    for (const by of [{ kind: 'staff', staff }, { kind: 'owner', owner }, { kind: 'customer' }] as const) {
      await expect(act(as(by), 'land_call', { report: undefined as never })).rejects.toThrow(Refused);
      await expect(act(as(by), 'record_delivery', { firm, provider: 'twilio', providerId: 'SM0', report: { delivered: true } })).rejects.toThrow(Refused);
    }
  });

  it('for the demo firm, is refused on live', async () => {
    const live = { ...as({ kind: 'staff', staff }), deps: { ...deps, copy: 'live' as const } };
    await expect(act(live, 'load_example', undefined)).rejects.toThrow(Refused);
  });
});

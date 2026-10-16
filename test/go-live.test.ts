// The go-live gate (task 4 of queue 2 in docs/autopilot.md): a firm is
// switched to live only once every item on its checklist is met, and only
// by the member of staff the copy names. Wherever it can, the checklist
// reads the evidence in the record: a call through the firm's number, a text
// from it delivered and one to it received, its agent in step. Staff tick
// the rest. Going live switches on the services the firm chose. Before then,
// only Calls & bookings can be switched on, for its test call, and only once
// its set-up is complete.
//
// The firms and people are invented, on numbers set aside for drama.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { AGENT_HAND_CHECK, GO_LIVE_CHECKS, goLiveChecklist, readyToGoLive, STAFF_TICKED_ITEMS, type ChecklistRules } from '../src/go-live';
import {
  createFirm,
  findCallByProviderId,
  findOrAddStaff,
  getFirm,
  goLiveState,
  historyBetween,
  listMessagesBetween,
  markLive,
  recordAgentPush,
  recordTestCall,
  setAgent,
  setServicesChosen,
  tickGoLive,
} from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import type { CallId, FirmId, StaffId } from '../src/record/types';
import { CONTROL_WORDS } from '../src/screens/control';
import { controlForm, controlOpener } from './helpers/control';
import { firmRows } from './helpers/db';
import { testDeps } from './helpers/deps';
import { postToTwilioRoute, pretendTwilio, twilioFields } from './helpers/twilio';
import { report, send, tidewell } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-10-15T11:00:00+01:00'));
const db = openRecord(env.DB, clock);
const frontline = { kind: 'frontline' } as const;
/** The checklist as live reads it: only the automatic check of the agent counts. */
const LIVE_RULES = { handCheckCounts: false } as const;
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;

/** The control room, and the app Vapi and Twilio reach, with texts through a pretend Twilio and this go-live email. */
function systemWith(goLiveBy: string | null) {
  const deps = { ...testDeps(clock), texts: pretendTwilio(), goLiveBy };
  const app = createApp(() => deps);
  const open = controlOpener(app);
  return {
    app,
    open: async (path: string, init?: RequestInit) => {
      const answer = await open(path, init);
      return { status: answer.status, location: answer.headers.get('Location'), words: await answer.text() };
    },
  };
}

/** The control room's words, as the page escapes them. */
function escaped(words: string): string {
  return words.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function staffId(email = 'staff@example.com'): Promise<StaffId> {
  return (await findOrAddStaff(db, email)).id;
}

/** Which checks are met, by name. */
async function met(firm: FirmId, rules: ChecklistRules = LIVE_RULES): Promise<Record<string, boolean>> {
  const state = await goLiveState(db, firm);
  if (state === null) throw new Error('No firm');
  return Object.fromEntries(goLiveChecklist(state, rules).map((item) => [item.check, item.met]));
}

/**
 * A firm set up in full on its own number, with a call that reached it (an
 * urgent one, so the owner's alert went from its number), that alert
 * reported delivered, and a text to its number received.
 */
async function firmWithEvidence(number: string, system: ReturnType<typeof systemWith>): Promise<{ firm: FirmId; vapiId: string }> {
  const firm = await tidewell(db, number);
  const call = report('mr-price-leak', number.replace(/^0/, '+44').replace(/ /g, ''));
  const vapiId = `go-live-${number.replace(/ /g, '')}`;
  (call.message.call as Record<string, unknown>).id = vapiId;
  expect((await send(system.app, call)).status).toBe(200);
  const [alert] = await listMessagesBetween(db, firm, ...allTime);
  if (alert?.providerId == null) throw new Error('No alert went');
  const from = number.replace(/^0/, '+44').replace(/ /g, '');
  expect((await postToTwilioRoute(system.app, '/twilio/status', twilioFields('delivered', { MessageSid: alert.providerId, SmsSid: alert.providerId, From: from }))).status).toBe(200);
  // Twilio's id for the text, one of its own for each number.
  const sid = `SM${from.slice(-9).padStart(32, '7')}`;
  expect((await postToTwilioRoute(system.app, '/twilio/texts', twilioFields('text-in', { To: from, MessageSid: sid, SmsSid: sid, SmsMessageSid: sid }))).status).toBe(200);
  return { firm, vapiId };
}

/** Everything else on the checklist met: services chosen, the agent in step, the ticks, and the test call. */
async function restMet(firm: FirmId, vapiId: string, system: ReturnType<typeof systemWith>): Promise<void> {
  const staff = await staffId();
  await setServicesChosen(db, firm, ['calls', 'invoices'], frontline);
  const assistant = `00000000-0000-4000-8000-${firm.slice(0, 12).replace(/[^0-9]/g, '0').padEnd(12, '0')}`;
  await setAgent(db, firm, assistant, staff);
  await recordAgentPush(db, firm, { assistantId: assistant, by: { kind: 'frontline' }, due: null, outcome: 'in_step', settings: [], state: 'in_step', differing: [] });
  expect((await system.open(`/control/firms/${firm}/go-live/ticks`, controlForm({ ticked: [...STAFF_TICKED_ITEMS] }))).status).toBe(303);
  expect((await system.open(`/control/firms/${firm}/go-live/test-call`, controlForm({ vapiId, passed: '1' }))).status).toBe(303);
}

describe('the go-live checklist', () => {
  it('reads the evidence in the record, and leaves met only what is', async () => {
    const system = systemWith('staff@example.com');
    const { firm } = await firmWithEvidence('07700 900410', system);
    expect(await met(firm)).toEqual({
      set_up: true,
      services: false,
      number_approved: false,
      number_calls: true,
      number_texts_out: true,
      number_texts_in: true,
      agent_in_step: false,
      test_call: false,
      dp_agreement: false,
      dp_privacy_notice: false,
      dp_ico: false,
      dp_vapi_region: false,
    });
  });

  it('meets nothing about the number for a new firm, and shows every item on its page, marking the data-protection ones to agree', async () => {
    const system = systemWith('staff@example.com');
    const firm = await createFirm(db, { name: 'Fourteenth Example Firm', isExample: false });
    expect(Object.values(await met(firm)).some(Boolean)).toBe(false);
    const page = await system.open(`/control/firms/${firm}/go-live`);
    expect(page.status).toBe(200);
    for (const check of GO_LIVE_CHECKS) expect(page.words).toContain(escaped(CONTROL_WORDS.checks[check]));
    expect(page.words).toContain(escaped(CONTROL_WORDS.goLiveNotReady));
    expect(page.words).not.toContain(`action="/control/firms/${firm}/go-live"`);
    expect(page.words.match(/\[to agree\]/g)?.length).toBeGreaterThanOrEqual(4);
    expect(((await firmRows(env.DB, firm)).staff_log as { what: string }[]).map((row) => row.what)).toContain('viewed_go_live');
  });

  it('records ticks and unticks, never editing one, each in the staff log', async () => {
    const system = systemWith('staff@example.com');
    const firm = await createFirm(db, { name: 'Fifteenth Example Firm', isExample: false });
    await system.open(`/control/firms/${firm}/go-live/ticks`, controlForm({ ticked: ['dp_agreement', 'dp_ico'] }));
    await system.open(`/control/firms/${firm}/go-live/ticks`, controlForm({ ticked: ['dp_agreement'] }));
    expect(await met(firm)).toMatchObject({ dp_agreement: true, dp_ico: false });
    const rows = await firmRows(env.DB, firm);
    expect((rows.go_live_ticks as { item: string; ticked: number }[]).map((row) => [row.item, row.ticked])).toEqual([
      ['dp_agreement', 1],
      ['dp_ico', 1],
      ['dp_ico', 0],
    ]);
    expect((rows.staff_log as { what: string }[]).map((row) => row.what).filter((what) => what.endsWith('go_live'))).toEqual(['ticked_go_live', 'ticked_go_live', 'unticked_go_live']);
    await expect(tickGoLive(db, firm, 'roofing' as never, true, await staffId())).rejects.toThrow(Refused);
  });

  it('takes as the test call only one of the firm’s own calls, ticked as passed', async () => {
    const system = systemWith('staff@example.com');
    const { firm, vapiId } = await firmWithEvidence('07700 900420', system);
    const other = await firmWithEvidence('07700 900421', system);
    // Another firm's call is "not found", as one that never was.
    const theirs = await system.open(`/control/firms/${firm}/go-live/test-call`, controlForm({ vapiId: other.vapiId, passed: '1' }));
    expect(theirs.status).toBe(400);
    expect(theirs.words).toContain(escaped(CONTROL_WORDS.testCallNotFound));
    const unticked = await system.open(`/control/firms/${firm}/go-live/test-call`, controlForm({ vapiId }));
    expect(unticked.status).toBe(400);
    expect(unticked.words).toContain(escaped(CONTROL_WORDS.testCallNeedsTick));
    expect((await met(firm)).test_call).toBe(false);
    expect((await system.open(`/control/firms/${firm}/go-live/test-call`, controlForm({ vapiId, passed: '1' }))).status).toBe(303);
    expect((await met(firm)).test_call).toBe(true);
    // And the record refuses the other firm's call outright.
    const theirCall = await findCallByProviderId(db, other.firm, 'vapi', other.vapiId);
    await expect(recordTestCall(db, firm, theirCall as CallId, await staffId())).rejects.toThrow(Refused);
    expect((await system.open(`/control/firms/${firm}/go-live/test-call`, controlForm({ clear: '1' }))).status).toBe(303);
    expect((await met(firm)).test_call).toBe(false);
  });
});

describe('switching a firm to live', () => {
  it('is refused, with nothing changed, until every item is met', async () => {
    const system = systemWith('staff@example.com');
    const { firm } = await firmWithEvidence('07700 900430', system);
    const before = await firmRows(env.DB, firm);
    const answer = await system.open(`/control/firms/${firm}/go-live`, controlForm({}));
    expect(answer.location).toBe(`/control/firms/${firm}/go-live?done=not_ready`);
    const after = await firmRows(env.DB, firm);
    expect({ ...after, staff_log: [] }).toEqual({ ...before, staff_log: [] });
    expect((await getFirm(db, firm))?.live).toBeNull();
  });

  it('by the member of staff the copy names, marks it live and switches on the services it chose, recorded as done by them', async () => {
    const system = systemWith('staff@example.com');
    const { firm, vapiId } = await firmWithEvidence('07700 900440', system);
    await restMet(firm, vapiId, system);
    const state = await goLiveState(db, firm);
    if (state === null) throw new Error('No firm');
    expect(readyToGoLive(state, LIVE_RULES)).toBe(true);
    const page = await system.open(`/control/firms/${firm}/go-live`);
    expect(page.words).toContain(`action="/control/firms/${firm}/go-live"`);

    const answer = await system.open(`/control/firms/${firm}/go-live`, controlForm({}));
    expect(answer.location).toBe(`/control/firms/${firm}/go-live?done=live`);
    const live = await getFirm(db, firm);
    expect(live?.live).toEqual({ at: clock.now(), by: await staffId() });
    expect(live?.services).toMatchObject({ calls: true, invoices: true, quotes: false });
    const entries = await historyBetween(db, firm, ...allTime);
    expect(entries.slice(-3).map((entry) => [entry.kind, entry.by.kind === 'staff' ? entry.by.staff : null, entry.service ?? null])).toEqual([
      ['went_live', await staffId(), null],
      ['service_on', await staffId(), 'calls'],
      ['service_on', await staffId(), 'invoices'],
    ]);
    expect(((await firmRows(env.DB, firm)).staff_log as { what: string }[]).map((row) => row.what)).toContain('went_live');
    // Pressed again, nothing changes.
    expect((await system.open(`/control/firms/${firm}/go-live`, controlForm({}))).location).toBe(`/control/firms/${firm}/go-live?done=already_live`);
    const firmPage = await system.open(`/control/firms/${firm}`);
    expect(firmPage.words).toContain('Live since');
  });

  it('is refused for anyone else, with nothing changed, and the database checks it too', async () => {
    const system = systemWith('greg-stand-in@example.com');
    const { firm, vapiId } = await firmWithEvidence('07700 900450', system);
    await restMet(firm, vapiId, system);
    const page = await system.open(`/control/firms/${firm}/go-live`);
    expect(page.words).toContain(escaped(CONTROL_WORDS.goLiveOnlyGreg));
    expect(page.words).not.toContain(`action="/control/firms/${firm}/go-live"`);
    expect((await system.open(`/control/firms/${firm}/go-live`, controlForm({}))).location).toBe(`/control/firms/${firm}/go-live?done=not_allowed`);
    expect(await getFirm(db, firm)).toMatchObject({ live: null, services: { invoices: false } });
    // Named by email to the record, a member of staff with another email is refused there too.
    expect(await markLive(db, firm, await staffId(), 'greg-stand-in@example.com', LIVE_RULES)).toBe('not_allowed');
    expect((await getFirm(db, firm))?.live).toBeNull();
  });

  it('is refused while the copy names nobody', async () => {
    const system = systemWith(null);
    const { firm, vapiId } = await firmWithEvidence('07700 900460', system);
    await restMet(firm, vapiId, system);
    expect((await system.open(`/control/firms/${firm}/go-live`)).words).toContain(escaped(CONTROL_WORDS.goLiveNobodyNamed));
    expect((await system.open(`/control/firms/${firm}/go-live`, controlForm({}))).location).toBe(`/control/firms/${firm}/go-live?done=nobody_named`);
    expect((await getFirm(db, firm))?.live).toBeNull();
  });
});

describe('switching services on before a firm is live', () => {
  it('refuses Calls & bookings while the set-up is incomplete, and anything else until the firm is live', async () => {
    const system = systemWith('staff@example.com');
    const bare = await createFirm(db, { name: 'Sixteenth Example Firm', isExample: false });
    const calls = await system.open(`/control/firms/${bare}/service`, controlForm({ service: 'calls', on: '1' }));
    expect(calls.location).toBe(`/control/firms/${bare}?refused=set_up_incomplete`);
    expect((await system.open(`/control/firms/${bare}?refused=set_up_incomplete`)).words).toContain(escaped(CONTROL_WORDS.switchRefused.set_up_incomplete));
    expect((await getFirm(db, bare))?.services.calls).toBe(false);

    const { firm } = await firmWithEvidence('07700 900470', system);
    // Set up in full: Calls & bookings can go on, for its test call; quotes cannot until it is live.
    expect((await system.open(`/control/firms/${firm}/service`, controlForm({ service: 'calls', on: '1' }))).location).toBe(`/control/firms/${firm}`);
    expect((await system.open(`/control/firms/${firm}/service`, controlForm({ service: 'quotes', on: '1' }))).location).toBe(`/control/firms/${firm}?refused=not_live`);
    expect((await getFirm(db, firm))?.services.quotes).toBe(false);
    // Switching off is never refused.
    expect((await system.open(`/control/firms/${firm}/service`, controlForm({ service: 'calls', on: '0' }))).location).toBe(`/control/firms/${firm}`);
  });

  it('holds an example firm to neither', async () => {
    const system = systemWith('staff@example.com');
    const example = await createFirm(db, { name: 'Example Demo Firm', isExample: true });
    expect((await system.open(`/control/firms/${example}/service`, controlForm({ service: 'quotes', on: '1' }))).location).toBe(`/control/firms/${example}`);
    expect((await getFirm(db, example))?.services.quotes).toBe(true);
  });
});

describe('Greg’s check of the agent by hand (his decision of 16 Oct 2026)', () => {
  /** A firm with everything met but its agent in step: the agent is set, never checked by Front-line. */
  async function allButTheAgent(number: string, system: ReturnType<typeof systemWith>): Promise<FirmId> {
    const { firm, vapiId } = await firmWithEvidence(number, system);
    await setServicesChosen(db, firm, ['calls'], frontline);
    await setAgent(db, firm, '00000000-0000-4000-8000-00000000a9a9'.replace('a9a9', number.slice(-4)), await staffId());
    expect((await system.open(`/control/firms/${firm}/go-live/ticks`, controlForm({ ticked: [...STAFF_TICKED_ITEMS] }))).status).toBe(303);
    expect((await system.open(`/control/firms/${firm}/go-live/test-call`, controlForm({ vapiId, passed: '1' }))).status).toBe(303);
    return firm;
  }

  it('counts on practice as the agent matching, recorded by Greg, so the firm can go live', async () => {
    const system = systemWith('staff@example.com');
    const firm = await allButTheAgent('07700 900480', system);
    const practice = { handCheckCounts: true };
    expect((await met(firm, practice)).agent_in_step).toBe(false);
    expect((await system.open(`/control/firms/${firm}/go-live/agent-check`, controlForm({ checked: '1' }))).location).toBe(`/control/firms/${firm}/go-live`);
    expect((await met(firm, practice)).agent_in_step).toBe(true);
    // Never on live, which needs the automatic check.
    expect((await met(firm, LIVE_RULES)).agent_in_step).toBe(false);
    expect((await system.open(`/control/firms/${firm}/go-live`, controlForm({}))).location).toBe(`/control/firms/${firm}/go-live?done=live`);
  });

  it('is refused for anyone but Greg, with nothing recorded, and the database checks it too', async () => {
    const system = systemWith('greg-stand-in@example.com');
    const firm = await allButTheAgent('07700 900481', system);
    const page = await system.open(`/control/firms/${firm}/go-live`);
    expect(page.words).toContain(escaped(CONTROL_WORDS.agentHandCheckOnlyGreg));
    expect(page.words).not.toContain(`action="/control/firms/${firm}/go-live/agent-check"`);
    expect((await system.open(`/control/firms/${firm}/go-live/agent-check`, controlForm({ checked: '1' }))).location).toBe(`/control/firms/${firm}/go-live?done=not_allowed`);
    await expect(tickGoLive(db, firm, AGENT_HAND_CHECK, true, await staffId(), 'greg-stand-in@example.com')).rejects.toThrow(Refused);
    await expect(tickGoLive(db, firm, AGENT_HAND_CHECK, true, await staffId())).rejects.toThrow(Refused);
    expect((await goLiveState(db, firm))?.evidence.ticks[AGENT_HAND_CHECK]).toBeUndefined();
  });

  it('is not offered on live, and refused there', async () => {
    const deps = { ...testDeps(clock), texts: pretendTwilio(), goLiveBy: 'staff@example.com', copy: 'live' as const };
    const open = controlOpener(createApp(() => deps));
    const firm = await createFirm(db, { name: 'Live Copy Example Firm', isExample: false });
    const page = await (await open(`/control/firms/${firm}/go-live`)).text();
    expect(page).not.toContain(escaped(CONTROL_WORDS.agentHandCheck));
    expect((await open(`/control/firms/${firm}/go-live/agent-check`, controlForm({ checked: '1' }))).headers.get('Location')).toBe(`/control/firms/${firm}/go-live?done=not_allowed`);
    expect((await goLiveState(db, firm))?.evidence.ticks[AGENT_HAND_CHECK]).toBeUndefined();
  });
});

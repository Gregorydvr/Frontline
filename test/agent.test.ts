// The control room keeps each firm's voice agent in Vapi in step with the
// record (task 3 of docs/autopilot.md): the agent made from one template and
// the firm's record (src/agent-settings.ts), and put on Vapi by a row in the
// due list, or by staff, with the script's checks (src/agent-push.ts).
// Against the stand-in for Vapi: nothing here reaches Vapi.

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import practiceAgent from '../vapi/practice-assistant.json';
import template from '../vapi/agent-template.json';
import { agentSettingsFor, differingSettings, holdsASecret, joinedWithOr, OWNED_SETTINGS, sameSetting, type AgentSettings } from '../src/agent-settings';
import { pushAgent } from '../src/agent-push';
import { createApp } from '../src/app';
import { instant, instantFromIso, pretendClock } from '../src/clock';
import { runDue } from '../src/due';
import { createFirm, findOrAddStaff, getAgent, getDue, listAgentPushes, setAgent, setUrgentList } from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import type { DueId, FirmId, StaffId } from '../src/record/types';
import { VapiApi } from '../src/providers/vapi/api';
import { controlForm, controlOpener } from './helpers/control';
import { dueRowsFor, staffLogRows, tryToDeleteAgentPush, tryToEditAgentPush } from './helpers/db';
import { APP_ADDRESS, testDeps, VAPI_CREDENTIAL } from './helpers/deps';

const clock = pretendClock(instantFromIso('2026-10-15T10:00:00+01:00'));
const db = openRecord(env.DB, clock);
let deps = testDeps(clock);
const frontline = { kind: 'frontline' } as const;
const PRACTICE_COPY = { appAddress: 'https://practice-app.vanrooyenenterprises.com', credential: 'ecd964a5-42ff-4fca-952a-95ca211d84a5' };
const TEST_COPY = { appAddress: APP_ADDRESS, credential: VAPI_CREDENTIAL };

let firm: FirmId;
let staff: StaffId;
let assistant: string;
let made = 0;

/** The firm's agent as the record would make it now. */
function wantedFor(name: string, urgent: string[], id: FirmId = firm): AgentSettings {
  const built = agentSettingsFor({ id, name, urgentList: urgent }, TEST_COPY);
  if (!('settings' in built)) throw new Error('Not ready');
  return built.settings;
}

/** The firm's waiting rows that push its agent. */
async function pushRows(): Promise<DueId[]> {
  return (await dueRowsFor(env.DB, firm, 'push_agent')).filter((row) => row.state === 'waiting').map((row) => row.id as DueId);
}

/** Runs the firm's one waiting push row. */
async function runThePush() {
  const [row] = await pushRows();
  if (row === undefined) throw new Error('No push waiting');
  return runDue(db, deps, firm, row);
}

beforeEach(async () => {
  clock.set(instantFromIso('2026-10-15T10:00:00+01:00'));
  deps = testDeps(clock);
  made += 1;
  firm = await createFirm(db, { name: 'Tidewell Heating', isExample: false });
  await setUrgentList(db, firm, ['a leak'], frontline);
  staff = (await findOrAddStaff(db, 'staff@example.com')).id;
  assistant = `00000000-0000-4000-8000-${String(made).padStart(12, '0')}`;
  // Vapi holds the agent as Front-line would make it, as after the script.
  deps.agents.agents.set(assistant, wantedFor('Tidewell Heating', ['a leak']));
});

describe('the agent made from the record', () => {
  it('is exactly the practice agent’s file, for the practice firm on practice', () => {
    const built = agentSettingsFor({ id: '6g9dmtzcgtcwqa867j1hb6szc3' as FirmId, name: 'Practice Test Plumbing', urgentList: ['a leak', 'a smell of gas'] }, PRACTICE_COPY);
    expect(built).toEqual({ settings: practiceAgent });
  });

  it('owns every setting the template names, and the template holds no key or secret', () => {
    expect(OWNED_SETTINGS).toEqual(['firstMessage', 'model', 'serverMessages', 'server', 'artifactPlan', 'analysisPlan']);
    expect(holdsASecret(template)).toBe(false);
    expect(holdsASecret({ server: { headers: { Authorization: 'Bearer x' } } })).toBe(true);
  });

  it('names the firm’s own urgent list wherever the instructions name it, and leaves no gap unfilled', () => {
    const wanted = JSON.stringify(wantedFor('Tidewell Heating', ['a leak', 'no heating', 'a smell of gas']));
    expect(wanted).not.toMatch(/\[\[/);
    expect(wanted).toContain('If the call is about a leak, no heating or a smell of gas, do not use free_times');
    expect(wanted).toContain('Never use it on a call about a leak, no heating, a smell of gas or anything else dangerous.');
    expect(wanted).toContain("Tidewell Heating's urgent list: a leak, no heating, a smell of gas.");
    expect(wanted).toContain(`"recordingPath":"/firms/${firm}"`);
    expect(wanted).toContain(`"url":"${APP_ADDRESS}/vapi/book"`);
  });

  it('joins a list as a sentence does', () => {
    expect(joinedWithOr(['a leak'])).toBe('a leak');
    expect(joinedWithOr(['a leak', 'a smell of gas'])).toBe('a leak or a smell of gas');
    expect(joinedWithOr(['a leak', 'no heating', 'a smell of gas'])).toBe('a leak, no heating or a smell of gas');
  });

  it('cannot be made without an urgent list, this copy’s address, or its credential', () => {
    const firmNow = { id: firm, name: 'Tidewell Heating', urgentList: ['a leak'] };
    expect(agentSettingsFor({ ...firmNow, urgentList: [] }, TEST_COPY)).toEqual({ notReady: 'no_urgent_list' });
    expect(agentSettingsFor(firmNow, { ...TEST_COPY, appAddress: null })).toEqual({ notReady: 'no_app_address' });
    expect(agentSettingsFor(firmNow, { ...TEST_COPY, credential: null })).toEqual({ notReady: 'no_credential' });
  });

  it('is compared as the script compares it: key order and the order of required fields mean nothing', () => {
    expect(sameSetting({ a: 1, b: { required: ['x', 'y'] } }, { b: { required: ['y', 'x'] }, a: 1 })).toBe(true);
    expect(sameSetting({ tools: ['x', 'y'] }, { tools: ['y', 'x'] })).toBe(false);
    const wanted = wantedFor('Tidewell Heating', ['a leak']);
    expect(differingSettings({ ...wanted, firstMessage: 'Hello.' }, wanted)).toEqual(['firstMessage']);
  });
});

describe('setting the firm’s agent', () => {
  it('checks it by a row in the due list, and finds it in step with nothing sent', async () => {
    expect(await setAgent(db, firm, assistant, staff)).toBe('set');
    expect(await getAgent(db, firm)).toMatchObject({ assistantId: assistant, state: 'unchecked', confirmed: null });
    expect(await runThePush()).toEqual({ ran: 'done', outcome: 'pushed' });
    expect(deps.agents.requests).toEqual([{ assistant, method: 'GET', settings: [] }]);
    expect(await getAgent(db, firm)).toMatchObject({ state: 'in_step', checkedAt: clock.now(), differing: [] });
    expect((await getAgent(db, firm))?.confirmed).toMatch(/^[0-9a-f]{64}$/);
    expect(await listAgentPushes(db, firm)).toMatchObject([{ assistantId: assistant, by: frontline, outcome: 'in_step', settings: [] }]);
  });

  it('does not change an agent found different on its first check: staff choose', async () => {
    deps.agents.agents.set(assistant, { ...wantedFor('Tidewell Heating', ['a leak']), firstMessage: 'Hello from the dashboard.' });
    await setAgent(db, firm, assistant, staff);
    expect(await runThePush()).toEqual({ ran: 'done', outcome: 'not_pushed' });
    expect(deps.agents.requests.map((request) => request.method)).toEqual(['GET']);
    expect(await getAgent(db, firm)).toMatchObject({ state: 'differs', differing: ['firstMessage'], confirmed: null });
  });

  it('refuses an id that is not Vapi’s, and one another firm has', async () => {
    await expect(setAgent(db, firm, 'not-an-id', staff)).rejects.toThrow(Refused);
    await setAgent(db, firm, assistant, staff);
    const other = await createFirm(db, { name: 'Second Example Firm', isExample: false });
    expect(await setAgent(db, other, assistant, staff)).toBe('taken');
    expect(await getAgent(db, other)).toBeNull();
  });
});

describe('saving the urgent list', () => {
  beforeEach(async () => {
    await setAgent(db, firm, assistant, staff);
    await runThePush();
    deps.agents.requests.length = 0;
  });

  it('marks the agent behind and pushes only the settings that name the list, then reads them back', async () => {
    await setUrgentList(db, firm, ['a leak', 'a smell of gas'], { kind: 'staff', staff });
    expect((await getAgent(db, firm))?.state).toBe('behind');
    expect(await runThePush()).toEqual({ ran: 'done', outcome: 'pushed' });
    expect(deps.agents.requests).toEqual([
      { assistant, method: 'GET', settings: [] },
      { assistant, method: 'PATCH', settings: ['model', 'analysisPlan'] },
      { assistant, method: 'GET', settings: [] },
    ]);
    expect(differingSettings(deps.agents.agents.get(assistant) ?? {}, wantedFor('Tidewell Heating', ['a leak', 'a smell of gas']))).toEqual([]);
    expect(await getAgent(db, firm)).toMatchObject({ state: 'in_step', differing: [] });
    expect((await listAgentPushes(db, firm))[0]).toMatchObject({ outcome: 'changed', settings: ['model', 'analysisPlan'], by: frontline });
  });

  it('adds one row however often it is saved before the push runs, and a second run sends nothing', async () => {
    await setUrgentList(db, firm, ['a leak', 'no heating'], frontline);
    await setUrgentList(db, firm, ['a leak', 'a smell of gas'], frontline);
    expect(await pushRows()).toHaveLength(1);
    await runThePush();
    // The record as it is when the row runs, not as it was when it was made.
    expect(JSON.stringify(deps.agents.agents.get(assistant))).toContain('urgent list: a leak, a smell of gas.');
    deps.agents.requests.length = 0;
    expect(await pushAgent(db, deps, firm, { by: frontline, due: null, overwrite: false })).toEqual({ outcome: 'in_step', tryAgain: false });
    expect(deps.agents.requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('puts no row on the due list for a firm with no agent set', async () => {
    const other = await createFirm(db, { name: 'Second Example Firm', isExample: false });
    await setUrgentList(db, other, ['a leak'], frontline);
    expect(await dueRowsFor(env.DB, other, 'push_agent')).toEqual([]);
  });

  it('waits and tries again while Vapi cannot be reached, then pushes', async () => {
    await setUrgentList(db, firm, ['a leak', 'a smell of gas'], frontline);
    deps.agents.willAnswer('unreachable');
    const [row] = await pushRows();
    if (row === undefined) throw new Error('No row');
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'held' });
    expect((await getAgent(db, firm))?.state).toBe('behind');
    clock.set(instant(clock.now() + 5 * 60_000));
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'done', outcome: 'pushed' });
    expect((await listAgentPushes(db, firm)).map((push) => push.outcome)).toEqual(['changed', 'unreachable', 'in_step']);
  });

  it('counts a push Vapi took though its answer never came: the next run finds it in step', async () => {
    await setUrgentList(db, firm, ['a leak', 'a smell of gas'], frontline);
    // The change goes, then the read-back cannot reach Vapi.
    const answers = deps.agents;
    const read = answers.read.bind(answers);
    let reads = 0;
    answers.read = (id) => {
      reads += 1;
      return reads === 2 ? Promise.resolve({ ok: false, why: 'unreachable', status: null }) : read(id);
    };
    const [row] = await pushRows();
    if (row === undefined) throw new Error('No row');
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'held' });
    clock.set(instant(clock.now() + 5 * 60_000));
    expect(await runDue(db, deps, firm, row)).toEqual({ ran: 'done', outcome: 'pushed' });
    expect((await listAgentPushes(db, firm))[0]?.outcome).toBe('in_step');
  });

  it('does not overwrite a change made in Vapi’s dashboard, and shows staff what differs', async () => {
    const held = deps.agents.agents.get(assistant) ?? {};
    deps.agents.agents.set(assistant, { ...held, firstMessage: 'Hello from the dashboard.' });
    await setUrgentList(db, firm, ['a leak', 'a smell of gas'], frontline);
    expect(await runThePush()).toEqual({ ran: 'done', outcome: 'not_pushed' });
    expect(deps.agents.requests.map((request) => request.method)).toEqual(['GET']);
    expect(await getAgent(db, firm)).toMatchObject({ state: 'differs', differing: ['firstMessage', 'model', 'analysisPlan'] });
    expect(deps.agents.agents.get(assistant)?.firstMessage).toBe('Hello from the dashboard.');
  });

  it('never changes an agent whose recording path is another firm’s, even when staff choose to', async () => {
    const held = deps.agents.agents.get(assistant) ?? {};
    deps.agents.agents.set(assistant, { ...held, artifactPlan: { ...(held.artifactPlan as object), recordingPath: '/firms/another' } });
    await setUrgentList(db, firm, ['a leak', 'a smell of gas'], frontline);
    expect(await runThePush()).toEqual({ ran: 'done', outcome: 'not_pushed' });
    expect(await pushAgent(db, deps, firm, { by: { kind: 'staff', staff }, due: null, overwrite: true })).toEqual({ outcome: 'not_this_firms', tryAgain: false });
    expect(deps.agents.requests.some((request) => request.method === 'PATCH')).toBe(false);
    expect((await getAgent(db, firm))?.state).toBe('stuck');
  });

  it('shows a read-back that does not match, and does not try again by itself', async () => {
    await setUrgentList(db, firm, ['a leak', 'a smell of gas'], frontline);
    deps.agents.ignoreChanges = true;
    expect(await runThePush()).toEqual({ ran: 'done', outcome: 'not_pushed' });
    expect(await getAgent(db, firm)).toMatchObject({ state: 'differs', differing: ['model', 'analysisPlan'] });
    expect(await pushRows()).toEqual([]);
  });

  it('stops, and says so, when Vapi refuses the settings or has no such agent', async () => {
    await setUrgentList(db, firm, ['a leak', 'a smell of gas'], frontline);
    deps.agents.willAnswer('refused');
    expect(await runThePush()).toEqual({ ran: 'done', outcome: 'not_pushed' });
    expect((await listAgentPushes(db, firm))[0]?.outcome).toBe('refused');
    deps.agents.agents.delete(assistant);
    expect(await pushAgent(db, deps, firm, { by: frontline, due: null, overwrite: false })).toEqual({ outcome: 'not_found', tryAgain: false });
    expect((await getAgent(db, firm))?.state).toBe('stuck');
  });

  it('reaches nothing while this copy has no Vapi key, and says it is not connected', async () => {
    await setUrgentList(db, firm, ['a leak', 'a smell of gas'], frontline);
    const unconnected = { ...deps, agents: null };
    const [row] = await pushRows();
    if (row === undefined) throw new Error('No row');
    expect(await runDue(db, unconnected, firm, row)).toEqual({ ran: 'done', outcome: 'not_pushed' });
    expect(deps.agents.requests).toEqual([]);
    expect((await listAgentPushes(db, firm))[0]?.outcome).toBe('not_connected');
    expect((await getDue(db, firm, row))?.outcome).toBe('not_pushed');
  });

  it('keeps every push in a log that is never edited, and deleted only with the firm', async () => {
    const [push] = await listAgentPushes(db, firm);
    if (push === undefined) throw new Error('No push');
    await expect(tryToEditAgentPush(env.DB, push.id)).rejects.toThrow(/never edited/);
    await expect(tryToDeleteAgentPush(env.DB, push.id)).rejects.toThrow(/only with the firm/);
  });
});

describe('the control room', () => {
  const open = (path: string, init: RequestInit = {}) => controlOpener(createApp(() => deps))(path, init);

  it('sets the firm’s agent, checks it, and shows where it stands, each in the staff log', async () => {
    expect((await open(`/control/firms/${firm}/agent`)).status).toBe(200);
    expect((await open(`/control/firms/${firm}/agent`, controlForm({ agent: 'not an id' }))).status).toBe(400);
    expect((await open(`/control/firms/${firm}/agent`, controlForm({ agent: assistant.toUpperCase() }))).status).toBe(303);
    expect((await getAgent(db, firm))?.assistantId).toBe(assistant);
    expect((await open(`/control/firms/${firm}/agent/check`, controlForm({}))).status).toBe(303);
    expect((await getAgent(db, firm))?.state).toBe('in_step');
    const page = await (await open(`/control/firms/${firm}`)).text();
    expect(page).toContain(assistant);
    expect(page).toContain('In step with the record');
    expect(page).not.toContain('Put the record’s settings on it');
    const logged = (await staffLogRows(env.DB)).filter((row) => row.firm_id === firm).map((row) => row.what);
    expect(logged).toEqual(['viewed_set_up_agent', 'viewed_set_up_agent', 'set_agent', 'checked_agent', 'viewed_firm']);
  });

  it('offers to put the record’s settings on an agent changed in Vapi, and does so when asked', async () => {
    await setAgent(db, firm, assistant, staff);
    await runThePush();
    const held = deps.agents.agents.get(assistant) ?? {};
    deps.agents.agents.set(assistant, { ...held, firstMessage: 'Hello from the dashboard.' });
    await open(`/control/firms/${firm}/agent/check`, controlForm({}));
    const page = await (await open(`/control/firms/${firm}`)).text();
    expect(page).toContain('Different from the record');
    expect(page).toContain('firstMessage');
    expect(page).toContain('Put the record’s settings on it');
    expect((await open(`/control/firms/${firm}/agent/overwrite`, controlForm({}))).status).toBe(303);
    expect(deps.agents.agents.get(assistant)?.firstMessage).toBe(wantedFor('Tidewell Heating', ['a leak']).firstMessage);
    expect(await getAgent(db, firm)).toMatchObject({ state: 'in_step' });
    expect((await listAgentPushes(db, firm))[0]).toMatchObject({ outcome: 'changed', settings: ['firstMessage'], by: { kind: 'staff', staff } });
  });
});

describe('Vapi’s own API', () => {
  const ID = '00000000-0000-4000-8000-0000000000f1';

  it('reads and changes an agent with the key, at Vapi’s address only', async () => {
    const asked: { url: string; method: string; key: string | null; body: unknown }[] = [];
    const network = (async (url: string, init: RequestInit) => {
      asked.push({ url, method: init.method ?? 'GET', key: new Headers(init.headers).get('Authorization'), body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null });
      return Promise.resolve(Response.json({ id: ID, firstMessage: 'Hello.' }));
    }) as unknown as typeof fetch;
    const api = new VapiApi('invented-key', network);
    expect(await api.read(ID)).toEqual({ ok: true, agent: { id: ID, firstMessage: 'Hello.' } });
    expect(await api.change(ID, { firstMessage: 'Hello.' })).toMatchObject({ ok: true });
    expect(asked).toEqual([
      { url: `https://api.vapi.ai/assistant/${ID}`, method: 'GET', key: 'Bearer invented-key', body: null },
      { url: `https://api.vapi.ai/assistant/${ID}`, method: 'PATCH', key: 'Bearer invented-key', body: { firstMessage: 'Hello.' } },
    ]);
  });

  it('reads Vapi’s answers: busy or down is unreachable, 404 not found, any other refusal refused', async () => {
    const answering = (status: number) => new VapiApi('k', () => Promise.resolve(new Response('{}', { status })));
    expect(await answering(503).read(ID)).toEqual({ ok: false, why: 'unreachable', status: 503 });
    expect(await answering(429).read(ID)).toEqual({ ok: false, why: 'unreachable', status: 429 });
    expect(await answering(404).read(ID)).toEqual({ ok: false, why: 'not_found', status: 404 });
    expect(await answering(400).change(ID, {})).toEqual({ ok: false, why: 'refused', status: 400 });
    const down = new VapiApi('k', () => Promise.reject(new Error('down')));
    expect(await down.read(ID)).toEqual({ ok: false, why: 'unreachable', status: null });
    // An id that is not Vapi's is never sent anywhere.
    expect(await answering(200).read('../keys')).toEqual({ ok: false, why: 'not_found', status: null });
  });

  it('makes an agent with POST /assistant, and reads its id from the answer (task 3 of queue 2)', async () => {
    const asked: { url: string; method: string; body: unknown }[] = [];
    const network = ((url: string, init: RequestInit) => {
      asked.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null });
      return Promise.resolve(Response.json({ id: ID, name: 'Invented' }, { status: 201 }));
    }) as unknown as typeof fetch;
    expect(await new VapiApi('k', network).create({ name: 'Invented' })).toEqual({ ok: true, assistant: ID });
    expect(asked).toEqual([{ url: 'https://api.vapi.ai/assistant', method: 'POST', body: { name: 'Invented' } }]);
  });

  it('reads a refusal as certain, and anything else that is not an agent as unclear', async () => {
    const answering = (status: number, body: unknown = {}) => new VapiApi('k', () => Promise.resolve(Response.json(body, { status })));
    expect(await answering(400).create({})).toEqual({ ok: false, why: 'refused' });
    expect(await answering(401).create({})).toEqual({ ok: false, why: 'refused' });
    expect(await answering(500).create({})).toEqual({ ok: false, why: 'unclear' });
    expect(await answering(429).create({})).toEqual({ ok: false, why: 'unclear' });
    expect(await answering(201, { id: 'not-an-id' }).create({})).toEqual({ ok: false, why: 'unclear' });
    expect(await new VapiApi('k', () => Promise.reject(new Error('down'))).create({})).toEqual({ ok: false, why: 'unclear' });
  });
});

// The guided set-up in the control room (task 3 of queue 2 in
// docs/autopilot.md): staff add a firm, then its owner, trade, services,
// diary rules, number and voice agent, one step after another, each going
// back to the guided page. Buying the number and making the agent are each
// switched off unless the copy allows them, and neither can happen twice.
//
// The firms are invented: "Seventh Example Firm" and others, with numbers in
// the range set aside for drama.

import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { phoneNumbers } from '../src/index';
import { askProvisioning, createFirm, findOrAddStaff, getAgent, getFirm, historyBetween, listProvisioning, setUrgentList } from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import { finishProvisioning } from '../src/record/provisioning';
import type { FirmId, ProvisioningId, StaffId } from '../src/record/types';
import { CONTROL_WORDS } from '../src/screens/control';
import { TRADE_PACKS } from '../src/trade-packs';
import { controlForm, controlOpener } from './helpers/control';
import { firmRows } from './helpers/db';
import { APP_ADDRESS, testDeps, type TestDeps } from './helpers/deps';

const clock = pretendClock(instantFromIso('2026-10-15T16:00:00+01:00'));
const db = openRecord(env.DB, clock);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;

let staff: StaffId;

beforeAll(async () => {
  staff = (await findOrAddStaff(db, 'staff@example.com')).id;
});

/** The control room as staff open it, with these dependencies. */
function controlWith(deps: TestDeps | (Omit<TestDeps, 'numbers' | 'agents'> & { numbers: null; agents: null })) {
  const open = controlOpener(createApp(() => deps));
  return async (path: string, init?: RequestInit) => {
    const answer = await open(path, init);
    return { status: answer.status, location: answer.headers.get('Location'), words: await answer.text() };
  };
}

/** The control room's words, as the page escapes them. */
function escaped(words: string): string {
  return words.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** What the staff log holds about a firm, as what was done. */
async function staffLog(firm: FirmId): Promise<string[]> {
  return ((await firmRows(env.DB, firm)).staff_log as { what: string }[]).map((row) => row.what);
}

describe('the guided set-up, step by step', () => {
  const deps = testDeps(clock);
  const open = controlWith(deps);
  let firm: FirmId;

  it('starts when a firm is added, at the guided page, with the owner next', async () => {
    const added = await open('/control/add-firm', controlForm({ name: 'Seventh Example Firm' }));
    expect(added.status).toBe(303);
    const id = /^\/control\/firms\/([0-9a-z]{26})\/onboard$/.exec(added.location ?? '')?.[1];
    if (id === undefined) throw new Error('No firm');
    firm = id as FirmId;
    const page = await open(`/control/firms/${firm}/onboard`);
    expect(page.status).toBe(200);
    expect(page.words).toContain(escaped('Set up Seventh Example Firm'));
    expect(page.words).toContain(`href="/control/firms/${firm}/owner?flow=onboard">Next: Its owner`);
    expect(await staffLog(firm)).toContain('viewed_onboarding');
  });

  it('takes each step in its own page and comes back to the guided page, with the next step to do', async () => {
    const owner = await open(`/control/firms/${firm}/owner?flow=onboard`, controlForm({ name: 'Example Owner', mobile: '07700 900701' }));
    expect(owner.location).toBe(`/control/firms/${firm}/onboard`);
    expect((await open(`/control/firms/${firm}/onboard`)).words).toContain('Next: Its trade');

    // Each step page, opened from the guided page, posts back to it.
    expect((await open(`/control/firms/${firm}/trade?flow=onboard`)).words).toContain(`action="/control/firms/${firm}/trade?flow=onboard"`);
    const trade = await open(`/control/firms/${firm}/trade?flow=onboard`, controlForm({ trade: 'drainage' }));
    expect(trade.location).toBe(`/control/firms/${firm}/onboard`);
    // The pack filled in the diary rules, so the next step to do is the services.
    expect((await open(`/control/firms/${firm}/onboard`)).words).toContain('Next: The services it chose');

    const services = await open(`/control/firms/${firm}/services?flow=onboard`, controlForm({ service: ['calls', 'invoices', 'roofing'] }));
    expect(services.location).toBe(`/control/firms/${firm}/onboard`);
    expect(await getFirm(db, firm)).toMatchObject({
      servicesChosen: ['calls', 'invoices'],
      diaryRules: TRADE_PACKS.drainage.diaryRules,
      // Choosing switches nothing on.
      services: { calls: false, quotes: false, followups: false, paperwork: false, invoices: false },
    });
    expect((await open(`/control/firms/${firm}/onboard`)).words).toContain('Next: Its number');
  });

  it('saves a step opened from the firm’s page back to the firm’s page, as before', async () => {
    const saved = await open(`/control/firms/${firm}/services`, controlForm({ service: 'calls' }));
    expect(saved.location).toBe(`/control/firms/${firm}`);
    expect((await getFirm(db, firm))?.servicesChosen).toEqual(['calls']);
    const entries = await historyBetween(db, firm, ...allTime);
    expect(entries.filter((entry) => entry.kind === 'services_chosen').map((entry) => entry.by.kind)).toEqual(['staff', 'staff']);
    expect((await staffLog(firm)).filter((what) => what === 'chose_services')).toHaveLength(2);
  });

  it('buys the firm’s number in Twilio when the copy allows it, sets it on the firm, and records who asked', async () => {
    const bought = await open(`/control/firms/${firm}/onboard/number`, controlForm({}));
    expect(bought.location).toBe(`/control/firms/${firm}/onboard?made=made`);
    expect(deps.numbers.bought).toEqual([{ smsUrl: `${APP_ADDRESS}/twilio/texts`, label: firm }]);
    expect((await getFirm(db, firm))?.phoneNumber).toBe('+447700900501');
    expect(await listProvisioning(db, firm)).toMatchObject([{ what: 'number', state: 'done', made: '+447700900501' }]);
    expect(await staffLog(firm)).toContain('asked_for_number');
    const page = await open(`/control/firms/${firm}/onboard?made=made`);
    expect(page.words).toContain(escaped(CONTROL_WORDS.provisioned.made));
    // Pressed again, nothing more is bought.
    expect((await open(`/control/firms/${firm}/onboard/number`, controlForm({}))).location).toBe(`/control/firms/${firm}/onboard?made=has_one`);
    expect(deps.numbers.bought).toHaveLength(1);
  });

  it('makes the firm’s agent in Vapi from the record when the copy has a key, and sets it on the firm', async () => {
    const made = await open(`/control/firms/${firm}/onboard/agent`, controlForm({}));
    expect(made.location).toBe(`/control/firms/${firm}/onboard?made=made`);
    expect(deps.agents.created).toHaveLength(1);
    const assistant = deps.agents.created[0] ?? '';
    expect((await getAgent(db, firm))?.assistantId).toBe(assistant);
    // Made from the firm's own record: its recording path, and its urgent list.
    const settings = JSON.stringify(deps.agents.agents.get(assistant));
    expect(settings).toContain(`/firms/${firm}`);
    expect(settings).toContain('sewage coming up');
    expect(await listProvisioning(db, firm)).toMatchObject([{ what: 'agent', state: 'done', made: assistant }, { what: 'number', state: 'done' }]);
    // Setting it put a check of the agent on the due list.
    const due = (await firmRows(env.DB, firm)).due as { action: string; state: string }[];
    expect(due.some((row) => row.action === 'push_agent' && row.state === 'waiting')).toBe(true);
    // Pressed again, nothing more is made.
    expect((await open(`/control/firms/${firm}/onboard/agent`, controlForm({}))).location).toBe(`/control/firms/${firm}/onboard?made=has_one`);
    expect(deps.agents.created).toHaveLength(1);
  });

  it('leaves only the wording to do, which goes only once the owner agrees it', async () => {
    const page = await open(`/control/firms/${firm}/onboard`);
    expect(page.words).toContain(`href="/control/firms/${firm}/wording">`);
    expect(page.words).toContain('0 of 7 agreed');
    expect(page.words).toContain(escaped(CONTROL_WORDS.missing));
  });
});

describe('buying a number and making an agent, switched off', () => {
  const deps = { ...testDeps(clock), numbers: null, agents: null };
  const open = controlWith(deps);

  it('says so on the guided page, with the way to do each by hand', async () => {
    const firm = await createFirm(db, { name: 'Eighth Example Firm', isExample: false });
    const page = await open(`/control/firms/${firm}/onboard`);
    expect(page.words).toContain(escaped(CONTROL_WORDS.buyNumberOff));
    expect(page.words).toContain(escaped(CONTROL_WORDS.createAgentOff));
    expect(page.words).not.toContain(`action="/control/firms/${firm}/onboard/number"`);
    expect(page.words).not.toContain(`action="/control/firms/${firm}/onboard/agent"`);
    expect(page.words).toContain(`href="/control/firms/${firm}/number?flow=onboard"`);
    expect(page.words).toContain(`href="/control/firms/${firm}/agent?flow=onboard"`);
  });

  it('asks nothing of any provider, and records no request, even when posted to', async () => {
    const firm = await createFirm(db, { name: 'Ninth Example Firm', isExample: false });
    await setUrgentList(db, firm, ['a leak'], { kind: 'frontline' });
    expect((await open(`/control/firms/${firm}/onboard/number`, controlForm({}))).location).toBe(`/control/firms/${firm}/onboard?made=switched_off`);
    expect((await open(`/control/firms/${firm}/onboard/agent`, controlForm({}))).location).toBe(`/control/firms/${firm}/onboard?made=switched_off`);
    expect(await listProvisioning(db, firm)).toEqual([]);
    expect(await getFirm(db, firm)).toMatchObject({ phoneNumber: null });
    expect(await getAgent(db, firm)).toBeNull();
  });

  it('is switched off on a deployed copy unless NUMBERS_ON is "yes" and the bundle and address are set', () => {
    const whole = {
      NUMBERS_ON: 'yes',
      TWILIO_ACCOUNT_SID: `AC${'0'.repeat(32)}`,
      TWILIO_AUTH_TOKEN: 'invented-token',
      TWILIO_BUNDLE_SID: `BU${'1'.repeat(32)}`,
      TWILIO_ADDRESS_SID: `AD${'2'.repeat(32)}`,
    };
    const of = (overrides: Record<string, string>) => phoneNumbers({ ...env, ...whole, ...overrides });
    expect(of({})).not.toBeNull();
    expect(of({ NUMBERS_ON: '' })).toBeNull();
    expect(of({ NUMBERS_ON: 'true' })).toBeNull();
    expect(of({ TWILIO_BUNDLE_SID: '' })).toBeNull();
    expect(of({ TWILIO_ADDRESS_SID: '' })).toBeNull();
    // Every copy's own settings, as wrangler.jsonc gives them to the tests: switched off.
    expect(phoneNumbers(env)).toBeNull();
  });
});

describe('asking a provider at most once', () => {
  const deps = testDeps(clock);
  const open = controlWith(deps);

  it('lets only one of two requests at once go to the provider', async () => {
    const firm = await createFirm(db, { name: 'Tenth Example Firm', isExample: false });
    const [one, two] = await Promise.all([askProvisioning(db, firm, 'number', staff), askProvisioning(db, firm, 'number', staff)]);
    expect([one, two].filter((asked) => asked !== null)).toHaveLength(1);
    // Every press is in the staff log.
    expect((await staffLog(firm)).filter((what) => what === 'asked_for_number')).toHaveLength(2);
  });

  it('can ask again after a clear refusal, but never after an unclear answer, until staff look', async () => {
    const firm = await createFirm(db, { name: 'Eleventh Example Firm', isExample: false });
    deps.numbers.willAnswer('refused');
    expect((await open(`/control/firms/${firm}/onboard/number`, controlForm({}))).location).toBe(`/control/firms/${firm}/onboard?made=failed`);
    deps.numbers.willAnswer('unclear');
    expect((await open(`/control/firms/${firm}/onboard/number`, controlForm({}))).location).toBe(`/control/firms/${firm}/onboard?made=unclear`);
    expect((await open(`/control/firms/${firm}/onboard/number`, controlForm({}))).location).toBe(`/control/firms/${firm}/onboard?made=already_asked`);
    expect(deps.numbers.bought).toEqual([]);
    expect((await listProvisioning(db, firm)).map((one) => one.state)).toEqual(['unclear', 'failed']);
    const page = await open(`/control/firms/${firm}/onboard`);
    expect(page.words).toContain('the answer did not say whether it was made');
  });

  it('makes no agent for a firm that is not ready, and asks Vapi nothing', async () => {
    const firm = await createFirm(db, { name: 'Twelfth Example Firm', isExample: false });
    expect((await open(`/control/firms/${firm}/onboard/agent`, controlForm({}))).location).toBe(`/control/firms/${firm}/onboard?made=not_ready`);
    expect(deps.agents.created).toEqual([]);
    expect(await listProvisioning(db, firm)).toEqual([]);
  });

  it('finishes a request once only, and only the firm’s own', async () => {
    const firm = await createFirm(db, { name: 'Thirteenth Example Firm', isExample: false });
    const asked = (await askProvisioning(db, firm, 'agent', staff)) as ProvisioningId;
    await finishProvisioning(db, firm, asked, { state: 'failed' });
    await expect(finishProvisioning(db, firm, asked, { state: 'done', made: 'x' })).rejects.toThrow(Refused);
  });
});

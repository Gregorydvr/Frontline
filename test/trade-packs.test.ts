// Trade starter packs (task 2 of queue 2 in docs/autopilot.md): each pack
// passes every check a firm's own set-up must pass, and choosing a trade in
// the control room fills in only what the firm has none of yet, recorded as
// done by staff, with nothing agreed or sent.
//
// The firms are invented: "Fifth Example Firm" and "Sixth Example Firm".

import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { runDue } from '../src/due';
import { segments, isGsm7 } from '../src/gsm';
import { DRAFT_WORDING, makeWords } from '../src/messages';
import { createFirm, findOrAddStaff, firmWording, getFirm, historyBetween, setAgent, setDiaryRules, setTrade, setUrgentList } from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import { MESSAGE_KINDS, TRADES, type DueId, type FirmId, type MessageKind, type StaffId } from '../src/record/types';
import { CONTROL_WORDS } from '../src/screens/control';
import { diaryRulesProblems, urgentListProblems, wordingProblems } from '../src/set-up';
import { draftFor, TRADE_PACKS } from '../src/trade-packs';
import { EXAMPLE_DIARY_RULES } from '../src/example/tidewell';
import { controlForm, controlOpener } from './helpers/control';
import { firmRows } from './helpers/db';
import { testDeps } from './helpers/deps';

const clock = pretendClock(instantFromIso('2026-10-15T16:00:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const open = controlOpener(createApp(() => deps));
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const KINDS = Object.keys(MESSAGE_KINDS) as MessageKind[];
const frontline = { kind: 'frontline' } as const;

let staff: StaffId;

beforeAll(async () => {
  staff = (await findOrAddStaff(db, 'staff@example.com')).id;
});

/** The control room's words, as the page escapes them. */
function escaped(words: string): string {
  return words.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

describe('each starter pack', () => {
  it.each(TRADES)('%s has an urgent list a firm could save', (trade) => {
    const { urgentList } = TRADE_PACKS[trade];
    expect(urgentList.length).toBeGreaterThan(0);
    expect(urgentListProblems(urgentList)).toEqual([]);
  });

  it.each(TRADES)('%s has diary rules a firm could save, with a length for a quote visit', (trade) => {
    const { diaryRules } = TRADE_PACKS[trade];
    expect(diaryRulesProblems(diaryRules)).toEqual([]);
    expect(diaryRules.lengths.quote_visit).toBeGreaterThan(0);
  });

  it.each(TRADES.flatMap((trade) => KINDS.map((kind) => [trade, kind] as const)))('%s: the draft for %s passes the wording check', (trade, kind) => {
    const draft = draftFor(trade, kind);
    if (draft === null) return;
    expect(wordingProblems(`text:${kind}`, draft)).toEqual([]);
  });

  it.each(TRADES)('%s: its own drafts are plain text and two texts at most, with the longest names a call gives', (trade) => {
    for (const draft of Object.values(TRADE_PACKS[trade].wording)) {
      const words = makeWords(draft, {
        customer: 'Mrs Bartholomew-Fitzgerald',
        firm: 'Tidewell Heating and Plumbing Services',
        owner: 'a'.repeat(60),
        day: 'Wednesday 30 September',
        time: '12:30pm',
        weekday: 'Wednesday',
      });
      expect(isGsm7(words)).toBe(true);
      expect(segments(words)).toBeLessThanOrEqual(2);
    }
  });

  it('gives the draft every firm starts from where the pack has none, and for a firm with no trade', () => {
    expect(draftFor(null, 'visit_reminder')).toBe(DRAFT_WORDING.visit_reminder);
    expect(draftFor('drainage', 'urgent_alert')).toBe(DRAFT_WORDING.urgent_alert);
    expect(draftFor('drainage', 'visit_reminder')).toContain('drain covers');
  });
});

describe('choosing a firm’s trade', () => {
  let firm: FirmId;

  /** The firm's history about itself, as the kind and whether this member of staff did it. */
  async function firmHistory(): Promise<unknown[][]> {
    const entries = await historyBetween(db, firm, ...allTime);
    return entries.map((entry) => [entry.kind, entry.by.kind === 'staff' && entry.by.staff === staff]);
  }

  beforeAll(async () => {
    firm = await createFirm(db, { name: 'Fifth Example Firm', isExample: false });
  });

  it('shows each pack and what it would fill in, with its words marked to agree, and records the view', async () => {
    const answer = await open(`/control/firms/${firm}/trade`);
    expect(answer.status).toBe(200);
    const words = await answer.text();
    for (const trade of TRADES) {
      expect(words).toContain(escaped(CONTROL_WORDS.trades[trade]));
      expect(words).toContain(escaped(TRADE_PACKS[trade].urgentList[0] ?? ''));
    }
    expect(words).toContain('[to agree]');
    const log = (await firmRows(env.DB, firm)).staff_log as { what: string }[];
    expect(log.map((row) => row.what)).toContain('viewed_set_up_trade');
  });

  it('refuses no trade, or one that is not on the list, and changes nothing', async () => {
    const before = await getFirm(db, firm);
    for (const trade of ['', 'roofing']) {
      const answer = await open(`/control/firms/${firm}/trade`, controlForm({ trade }));
      expect(answer.status).toBe(400);
      expect(await answer.text()).toContain(CONTROL_WORDS.tradeChoose);
    }
    expect(await getFirm(db, firm)).toEqual(before);
    await expect(setTrade(db, firm, 'roofing' as never, frontline)).rejects.toThrow(Refused);
  });

  it('fills in the urgent list and the diary rules from the pack, recorded as done by staff, and agrees no wording', async () => {
    const answer = await open(`/control/firms/${firm}/trade`, controlForm({ trade: 'plumbing_heating' }));
    expect(answer.status).toBe(303);
    expect(await getFirm(db, firm)).toMatchObject({
      trade: 'plumbing_heating',
      urgentList: TRADE_PACKS.plumbing_heating.urgentList,
      diaryRules: TRADE_PACKS.plumbing_heating.diaryRules,
      services: { calls: false },
    });
    expect((await firmHistory()).slice(-3)).toEqual([
      ['trade_set', true],
      ['urgent_list_set', true],
      ['diary_rules_set', true],
    ]);
    const log = (await firmRows(env.DB, firm)).staff_log as { what: string }[];
    expect(log.map((row) => row.what).slice(-3)).toEqual(['set_trade', 'set_urgent_list', 'set_diary_rules']);
    expect(await firmWording(db, firm)).toEqual({});
  });

  it('starts the wording pages from the pack’s drafts, marked to agree', async () => {
    const reminder = await (await open(`/control/firms/${firm}/wording/visit_reminder`)).text();
    expect(reminder).toContain(escaped(TRADE_PACKS.plumbing_heating.wording.visit_reminder ?? 'none'));
    expect(reminder).toContain('Plumbing &amp; heating starter pack');
    // A kind the pack has no draft of its own for starts from the draft every firm starts from.
    const alert = await (await open(`/control/firms/${firm}/wording/urgent_alert`)).text();
    expect(alert).toContain(escaped(CONTROL_WORDS.startsFromDraft));
  });

  it('never changes what the firm already has: choosing another trade keeps its list and rules', async () => {
    await setUrgentList(db, firm, ['a leak'], frontline);
    await setDiaryRules(db, firm, EXAMPLE_DIARY_RULES, frontline);
    const filled = await setTrade(db, firm, 'electrical', { kind: 'staff', staff });
    expect(filled).toEqual({ urgentList: false, diaryRules: false });
    expect(await getFirm(db, firm)).toMatchObject({ trade: 'electrical', urgentList: ['a leak'], diaryRules: EXAMPLE_DIARY_RULES });
    expect((await firmHistory()).slice(-1)).toEqual([['trade_set', true]]);
    const page = await (await open(`/control/firms/${firm}/trade`)).text();
    expect(page).toContain(escaped(CONTROL_WORDS.tradeKeptUrgent));
    expect(page).toContain(escaped(CONTROL_WORDS.tradeKeptDiary));
  });

  it('shows the trade on the firm’s page', async () => {
    const words = await (await open(`/control/firms/${firm}`)).text();
    expect(words).toContain(`${CONTROL_WORDS.trade}</dt><dd>${CONTROL_WORDS.trades.electrical}`);
  });

  it('puts the filled-in urgent list on the firm’s agent in Vapi, as saving the list does', async () => {
    const other = await createFirm(db, { name: 'Sixth Example Firm', isExample: false });
    await setAgent(db, other, '00000000-0000-4000-8000-0000000000f6', staff);
    const pushes = async () => ((await firmRows(env.DB, other)).due as { id: DueId; action: string; state: string }[]).filter((row) => row.action === 'push_agent' && row.state === 'waiting');
    // Setting the agent put a push on the due list. Once it has run, none waits.
    for (const row of await pushes()) await runDue(db, deps, other, row.id);
    expect(await pushes()).toEqual([]);
    await setTrade(db, other, 'drainage', { kind: 'staff', staff });
    expect(await pushes()).toHaveLength(1);
  });
});

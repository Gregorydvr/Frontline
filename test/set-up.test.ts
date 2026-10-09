// Setting up a firm (slice H2): staff add a firm in the control room, its
// owner, its number, what counts as urgent, when visits can be booked, and
// the wording the owner agreed for each kind of text. Then a call to its
// number lands as its own, and its confirmation goes from its number in the
// words its owner agreed.
//
// The firm added is the invented "Second Example Firm", on 07700 900200,
// with the invented "Example Owner" on 07700 900201. Tidewell Heating, on
// 07700 900100, is there to hold a number the new firm cannot take. Every
// number is in the range set aside for drama.

import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { runDue } from '../src/due';
import { newId } from '../src/ids';
import { DRAFT_WORDING } from '../src/messages';
import {
  createLoginLink,
  findLoginLink,
  findOrAddStaff,
  firmWording,
  getDue,
  getFirm,
  historyBetween,
  listCustomers,
  listDueForVisit,
  listJobsForCustomer,
  listMessagesBetween,
  listOwners,
  listVisitsForJob,
  listWording,
  setWording,
} from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import { MESSAGE_KINDS, type FirmId, type MessageKind, type OwnerId, type StaffId } from '../src/record/types';
import { CONTROL_WORDS } from '../src/screens/control';
import { callsSetUpGaps, NAME_LIMITS, nameProblems, wordingProblems } from '../src/set-up';
import { controlForm, controlOpener } from './helpers/control';
import { countFirms, firmRows, historyKinds, insertWordingPastTheRecord } from './helpers/db';
import { testDeps } from './helpers/deps';
import { opener, ownerCookie } from './helpers/owner';
import { asAnotherCall, report, send, sendTool, tidewell, toolAnswer, toolCall } from './helpers/vapi';

// Monday 28 September 2026, 11:14: the firm is set up, then Mrs Ahmed rings it.
const clock = pretendClock(instantFromIso('2026-09-28T11:14:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const app = createApp(() => deps);
const open = controlOpener(app);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const KINDS = Object.keys(MESSAGE_KINDS) as MessageKind[];

let staff: StaffId;
let tidewellHeating: FirmId;
let firm: FirmId;
let owner: OwnerId;

beforeAll(async () => {
  tidewellHeating = await tidewell(db, '07700 900100');
  staff = (await findOrAddStaff(db, 'staff@example.com')).id;
});

/** A control-room page's words. */
async function page(path: string, init?: RequestInit): Promise<{ status: number; words: string }> {
  const answer = await open(path, init);
  return { status: answer.status, words: await answer.text() };
}

/** The staff log's rows about the firm, as what was done, with the owner or kind of text where there is one. */
async function staffLog(about: FirmId | null): Promise<unknown[][]> {
  const rows = about === null ? [] : ((await firmRows(env.DB, about)).staff_log as { what: string; owner_id: string | null; message_kind: string | null; staff_id: string }[]);
  return rows.map((row) => [row.what, row.staff_id === staff, row.owner_id, row.message_kind]);
}

/** The firm's history about itself, as the kind and who did it. */
async function firmHistory(): Promise<unknown[][]> {
  const entries = await historyBetween(db, firm, ...allTime);
  return entries.map((entry) => [entry.kind, entry.by.kind === 'staff' ? entry.by.staff === staff : entry.by.kind]);
}

/** The control room's words for a problem, as the page escapes them. */
function escaped(words: string): string {
  return words.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

describe('adding a firm', () => {
  it('shows the form, and records the view', async () => {
    const shown = await page('/control/add-firm');
    expect(shown.status).toBe(200);
    expect(shown.words).toContain(CONTROL_WORDS.addFirmHint);
  });

  it('refuses a name that is empty, or that a text cannot carry, and adds nothing', async () => {
    const before = await countFirms(env.DB);
    const empty = await page('/control/add-firm', controlForm({ name: '  ' }));
    expect(empty.status).toBe(400);
    expect(empty.words).toContain(CONTROL_WORDS.nameProblems.empty);
    const emoji = await page('/control/add-firm', controlForm({ name: 'Second Example Firm 👍' }));
    expect(emoji.status).toBe(400);
    expect(emoji.words).toContain('These characters cannot go in a text: 👍');
    expect(await countFirms(env.DB)).toBe(before);
  });

  it('adds it by name, with every service off and the stop button off, recorded as done by staff', async () => {
    const added = await open('/control/add-firm', controlForm({ name: 'Second Example Firm' }));
    expect(added.status).toBe(303);
    const id = /^\/control\/firms\/([0-9a-z]{26})$/.exec(added.headers.get('Location') ?? '')?.[1];
    if (id === undefined) throw new Error('No firm');
    firm = id as FirmId;
    expect(await getFirm(db, firm)).toMatchObject({
      name: 'Second Example Firm',
      isExample: false,
      services: { calls: false, quotes: false, followups: false, paperwork: false, invoices: false },
      stopped: false,
      phoneNumber: null,
      urgentList: [],
      diaryRules: null,
    });
    expect(await firmHistory()).toEqual([['firm_added', true]]);
    expect(await staffLog(firm)).toEqual([['added_firm', true, null, null]]);
  });

  it('shows on its page everything still missing, and what its agent in Vapi needs', async () => {
    const shown = await page(`/control/firms/${firm}`);
    expect(shown.status).toBe(200);
    expect(shown.words).toContain(escaped(CONTROL_WORDS.missing));
    for (const gap of ['number', 'owner', 'urgent_list', 'diary'] as const) {
      expect(shown.words).toContain(escaped(CONTROL_WORDS.gaps[gap]));
    }
    expect(shown.words).toContain('Agreed wording for:');
    expect(shown.words).toContain(firm);
    expect(shown.words).toContain(`/firms/${firm}`);
    expect(shown.words).not.toContain(CONTROL_WORDS.nothingMissing);
  });
});

describe('its owner', () => {
  it('refuses a landline, or no name, and adds nobody', async () => {
    const landline = await page(`/control/firms/${firm}/owner`, controlForm({ name: 'Example Owner', mobile: '01632 960001' }));
    expect(landline.status).toBe(400);
    expect(landline.words).toContain(CONTROL_WORDS.notAMobile);
    const nameless = await page(`/control/firms/${firm}/owner`, controlForm({ name: '', mobile: '07700 900201' }));
    expect(nameless.status).toBe(400);
    expect(await listOwners(db, firm)).toEqual([]);
  });

  it('adds the owner with their mobile, recorded as done by staff', async () => {
    expect((await page(`/control/firms/${firm}/owner`)).status).toBe(200);
    expect((await open(`/control/firms/${firm}/owner`, controlForm({ name: 'Example Owner', mobile: '07700 900201' }))).status).toBe(303);
    const [added] = await listOwners(db, firm);
    if (added === undefined) throw new Error('No owner');
    owner = added.id;
    expect(added).toMatchObject({ name: 'Example Owner', mobile: '+447700900201' });
    expect((await firmHistory()).slice(-1)).toEqual([['owner_added', true]]);
    expect((await staffLog(firm)).slice(-1)).toEqual([['added_owner', true, owner, null]]);
  });

  it('is one owner: asked again, the firm’s page comes back', async () => {
    expect((await open(`/control/firms/${firm}/owner`)).status).toBe(303);
    expect((await open(`/control/firms/${firm}/owner`, controlForm({ name: 'Another', mobile: '07700 900202' }))).status).toBe(303);
    expect(await listOwners(db, firm)).toHaveLength(1);
  });
});

describe('its number', () => {
  it('cannot be another firm’s, the owner’s own mobile, or a landline, and nothing changes', async () => {
    const before = await firmRows(env.DB, tidewellHeating);
    const taken = await page(`/control/firms/${firm}/number`, controlForm({ number: '07700 900100' }));
    expect(taken.status).toBe(400);
    expect(taken.words).toContain(escaped(CONTROL_WORDS.numberProblems.taken));
    const owners = await page(`/control/firms/${firm}/number`, controlForm({ number: '07700 900201' }));
    expect(owners.words).toContain(escaped(CONTROL_WORDS.numberProblems.owners_mobile));
    const landline = await page(`/control/firms/${firm}/number`, controlForm({ number: '01632 960001' }));
    expect(landline.words).toContain(CONTROL_WORDS.numberProblems.not_mobile);
    expect((await getFirm(db, firm))?.phoneNumber).toBeNull();
    expect(await firmRows(env.DB, tidewellHeating)).toEqual(before);
    expect(await historyKinds(env.DB, firm)).not.toHaveProperty('number_set');
  });

  it('is set, recorded as done by staff, and its page, viewed, is in the staff log', async () => {
    const before = (await staffLog(firm)).length;
    expect((await page(`/control/firms/${firm}/number`)).status).toBe(200);
    expect((await staffLog(firm)).slice(before)).toEqual([['viewed_set_up_number', true, null, null]]);
    expect((await open(`/control/firms/${firm}/number`, controlForm({ number: '07700 900200' }))).status).toBe(303);
    expect((await getFirm(db, firm))?.phoneNumber).toBe('+447700900200');
    expect((await firmHistory()).slice(-1)).toEqual([['number_set', true]]);
    expect((await staffLog(firm)).slice(before)).toEqual([
      ['viewed_set_up_number', true, null, null],
      ['set_number', true, null, null],
    ]);
  });
});

describe('what counts as urgent', () => {
  it('refuses an item twice, and changes nothing', async () => {
    const twice = await page(`/control/firms/${firm}/urgent`, controlForm({ items: 'a leak\r\n\r\nno heating\r\nA leak' }));
    expect(twice.status).toBe(400);
    expect(twice.words).toContain('Twice: A leak');
    expect((await getFirm(db, firm))?.urgentList).toEqual([]);
  });

  it('is one item a line, recorded as done by staff', async () => {
    expect((await page(`/control/firms/${firm}/urgent`)).status).toBe(200);
    expect((await open(`/control/firms/${firm}/urgent`, controlForm({ items: 'a leak\r\n no heating \r\n' }))).status).toBe(303);
    expect((await getFirm(db, firm))?.urgentList).toEqual(['a leak', 'no heating']);
    expect((await firmHistory()).slice(-1)).toEqual([['urgent_list_set', true]]);
    expect((await staffLog(firm)).slice(-1)).toEqual([['set_urgent_list', true, null, null]]);
    // The line for its agent in Vapi.
    expect((await page(`/control/firms/${firm}`)).words).toContain('Second Example Firm&#39;s urgent list: a leak, no heating.');
  });
});

describe('when visits can be booked', () => {
  const rules = { day: ['1', '2', '3', '4', '5'], opens: '08:00', closes: '16:00', every: '60', daysAhead: '14', length_quote_visit: '60' };

  it('refuses rules that make no sense, with their reasons, and changes nothing', async () => {
    const noDays = await page(`/control/firms/${firm}/diary`, controlForm({ ...rules, day: [] }));
    expect(noDays.status).toBe(400);
    expect(noDays.words).toContain(CONTROL_WORDS.diaryProblems.no_days);
    const backwards = await page(`/control/firms/${firm}/diary`, controlForm({ ...rules, opens: '16:00', closes: '08:00' }));
    expect(backwards.words).toContain(CONTROL_WORDS.diaryProblems.hours);
    const tooLong = await page(`/control/firms/${firm}/diary`, controlForm({ ...rules, length_quote_visit: '600' }));
    expect(tooLong.words).toContain(CONTROL_WORDS.diaryProblems.length);
    expect((await getFirm(db, firm))?.diaryRules).toBeNull();
  });

  it('are set, recorded as done by staff', async () => {
    expect((await page(`/control/firms/${firm}/diary`)).status).toBe(200);
    expect((await open(`/control/firms/${firm}/diary`, controlForm(rules))).status).toBe(303);
    expect((await getFirm(db, firm))?.diaryRules).toEqual({ days: [1, 2, 3, 4, 5], opens: 480, closes: 960, every: 60, lengths: { quote_visit: 60 }, daysAhead: 14 });
    expect((await firmHistory()).slice(-1)).toEqual([['diary_rules_set', true]]);
    expect((await staffLog(firm)).slice(-1)).toEqual([['set_diary_rules', true, null, null]]);
  });
});

describe('the wording', () => {
  const agreed = { owner: '', how: 'phone', agreed: '1', intent: 'save' };

  it('starts from the draft, with the gaps it can use and its segments, and records the view', async () => {
    const shown = await page(`/control/firms/${firm}/wording/visit_reminder`);
    expect(shown.status).toBe(200);
    expect(shown.words).toContain(CONTROL_WORDS.startsFromDraft);
    expect(shown.words).toContain(escaped(DRAFT_WORDING.visit_reminder ?? ''));
    for (const gap of MESSAGE_KINDS.visit_reminder.gaps) {
      expect(shown.words).toContain(`{${gap}}`);
    }
    // The draft with the firm's owner and the example's day and time.
    expect(shown.words).toContain('Reminder: Example Owner&#39;s visit is tomorrow, Thursday, at 3pm. See you then.');
    expect(shown.words).toContain('With example details: 1 segment (76 characters)');
    expect((await staffLog(firm)).slice(-1)).toEqual([['viewed_wording', true, null, 'visit_reminder']]);
  });

  it('is not found for a kind of text there is not', async () => {
    expect((await page(`/control/firms/${firm}/wording/quote`)).status).toBe(404);
  });

  it('checked, names a character a text cannot carry and a gap it cannot use, and saves nothing', async () => {
    const curly = await page(`/control/firms/${firm}/wording/visit_reminder`, controlForm({ intent: 'check', words: 'Reminder: Example Owner’s visit is at {time}.' }));
    expect(curly.status).toBe(200);
    expect(curly.words).toContain('These characters cannot go in a text: ’');
    const gap = await page(`/control/firms/${firm}/wording/visit_reminder`, controlForm({ intent: 'check', words: 'Reminder for {name} at {time}.' }));
    expect(gap.words).toContain('{name} is not a gap this text can use.');
    expect(await listWording(db, firm, 'text:visit_reminder')).toEqual([]);
    expect((await staffLog(firm)).slice(-2)).toEqual([
      ['checked_wording', true, null, 'visit_reminder'],
      ['checked_wording', true, null, 'visit_reminder'],
    ]);
  });

  it('checked and fit to go, shows the text with example details and its segments, at most and with the longest details', async () => {
    const long = `Reminder: {owner}'s visit is tomorrow, {weekday}, at {time}. ${'x'.repeat(100)}`;
    const checked = await page(`/control/firms/${firm}/wording/visit_reminder`, controlForm({ intent: 'check', words: long }));
    expect(checked.words).toContain(escaped(`${CONTROL_WORDS.checked}. ${CONTROL_WORDS.fits}`));
    expect(checked.words).toContain('With example details: 2 segments');
    expect(checked.words).toContain('With the longest details a call can give: up to 2 segments');
  });

  it('refuses the first text to a new customer without its link, or without the word STOP', async () => {
    const draft = DRAFT_WORDING.visit_confirmation_first ?? '';
    const noLink = await page(`/control/firms/${firm}/wording/visit_confirmation_first`, controlForm({ ...agreed, owner, words: draft.replace(' {link}', '') }));
    expect(noLink.status).toBe(400);
    expect(noLink.words).toContain(CONTROL_WORDS.wordingProblems.needs_link);
    expect(noLink.words).toContain(CONTROL_WORDS.nothingSaved);
    const noStop = await page(`/control/firms/${firm}/wording/visit_confirmation_first`, controlForm({ ...agreed, owner, words: draft.replace(' Reply STOP to stop these texts.', '') }));
    expect(noStop.status).toBe(400);
    expect(noStop.words).toContain(CONTROL_WORDS.wordingProblems.needs_stop);
    expect(await listWording(db, firm, 'text:visit_confirmation_first')).toEqual([]);
  });

  it('is not saved unless staff tick that the owner agreed these exact words', async () => {
    const unticked = await page(`/control/firms/${firm}/wording/visit_reminder`, controlForm({ ...agreed, owner, agreed: '', words: DRAFT_WORDING.visit_reminder ?? '' }));
    expect(unticked.status).toBe(400);
    expect(unticked.words).toContain(CONTROL_WORDS.needTick);
    expect(await listWording(db, firm, 'text:visit_reminder')).toEqual([]);
  });

  it('is saved as agreed for every kind: the exact words, the owner who agreed them, how and when, and who recorded it', async () => {
    for (const kind of KINDS) {
      const words = DRAFT_WORDING[kind] ?? '';
      expect((await open(`/control/firms/${firm}/wording/${kind}`, controlForm({ ...agreed, owner, words }))).status).toBe(303);
      expect(await listWording(db, firm, `text:${kind}`)).toEqual([
        {
          id: expect.any(String) as string,
          words,
          at: clock.now(),
          by: { kind: 'staff', staff },
          staffEmail: 'staff@example.com',
          agreed: { owner: { id: owner, name: 'Example Owner' }, how: 'phone', at: clock.now() },
        },
      ]);
    }
    const agreedRows = (await staffLog(firm)).filter(([what]) => what === 'agreed_wording');
    expect(agreedRows).toEqual(KINDS.map((kind) => ['agreed_wording', true, null, kind]));
    expect((await firmHistory()).filter(([kind]) => kind === 'wording_agreed')).toEqual(KINDS.map(() => ['wording_agreed', true]));
    expect((await page(`/control/firms/${firm}/wording`)).words).not.toContain(CONTROL_WORDS.notAgreed);
  });

  it('keeps each version: a new one is in use, and the old one stays as it was', async () => {
    const [first] = await listWording(db, firm, 'text:visit_reminder');
    clock.advance(60_000);
    const newer = "Reminder: {owner}'s visit is tomorrow, {weekday}, at {time}. See you then!";
    expect((await open(`/control/firms/${firm}/wording/visit_reminder`, controlForm({ ...agreed, how: 'in_writing', owner, words: newer }))).status).toBe(303);
    const versions = await listWording(db, firm, 'text:visit_reminder');
    expect(versions.map((version) => [version.words, version.agreed?.how])).toEqual([
      [newer, 'in_writing'],
      [DRAFT_WORDING.visit_reminder, 'phone'],
    ]);
    expect(versions[1]).toEqual(first);
    expect((await firmWording(db, firm))['text:visit_reminder']?.words).toBe(newer);
    // Back to the draft, as the rest of this file expects.
    await open(`/control/firms/${firm}/wording/visit_reminder`, controlForm({ ...agreed, owner, words: DRAFT_WORDING.visit_reminder ?? '' }));
  });
});

describe('the database', () => {
  it('refuses words for a text that name no owner as agreeing them, or another firm’s owner', async () => {
    const [ownerOfTidewell] = await listOwners(db, tidewellHeating);
    await expect(insertWordingPastTheRecord(env.DB, { id: newId(), firm, agreedBy: null })).rejects.toThrow(/must say who agreed it/);
    await expect(insertWordingPastTheRecord(env.DB, { id: newId(), firm, agreedBy: ownerOfTidewell?.id ?? null })).rejects.toThrow(/not the firm/);
    // The firm's own owner goes in.
    await insertWordingPastTheRecord(env.DB, { id: newId(), firm, agreedBy: owner });
  });

  it('is written to by setWording, which refuses words for a text with no agreement, an owner’s line with one, and a way of agreeing not on the list', async () => {
    const by = { kind: 'staff', staff } as const;
    await expect(setWording(db, firm, 'text:visit_reminder', 'Reminder: {time}.', by, null)).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'line:visit_booked:job', 'Booked.', by, { owner, how: 'phone' })).rejects.toThrow(Refused);
    await expect(setWording(db, firm, 'text:visit_reminder', 'Reminder: {time}.', by, { owner, how: 'by_pigeon' as 'phone' })).rejects.toThrow(Refused);
  });
});

describe('the firm, set up', () => {
  it('has nothing missing before Calls & bookings', async () => {
    const shown = await page(`/control/firms/${firm}`);
    expect(shown.words).toContain(CONTROL_WORDS.nothingMissing);
    expect(shown.words).not.toContain(escaped(CONTROL_WORDS.missing));
  });

  it('takes a call to its number as its own, and confirms the visit from its number in the words its owner agreed', async () => {
    expect((await open(`/control/firms/${firm}/service`, controlForm({ service: 'calls', on: '1' }))).status).toBe(303);
    const number = '+447700900200';
    const callId = 'set-up-ahmed';
    const free = await toolAnswer(await sendTool(app, '/vapi/free-times', toolCall('free-times', { day: '2026-10-01' }, { to: number, callId })));
    const [first] = free.times as { start: string }[];
    expect(first?.start).toBe('2026-10-01T08:00');
    await toolAnswer(await sendTool(app, '/vapi/book', toolCall('book', { start: first?.start }, { to: number, callId })));
    expect((await send(app, asAnotherCall(report('mrs-ahmed-booked', number), callId))).status).toBe(200);

    // Mrs Ahmed is the new firm's customer; Tidewell Heating has none.
    const [mrsAhmed] = await listCustomers(db, firm);
    expect(mrsAhmed?.name).toBe('Mrs Ahmed');
    expect(await listCustomers(db, tidewellHeating)).toEqual([]);
    const [job] = await listJobsForCustomer(db, firm, mrsAhmed?.id ?? ('' as never));
    const [visit] = await listVisitsForJob(db, firm, job?.id ?? ('' as never));
    const confirmation = (await listDueForVisit(db, firm, visit?.id ?? ('' as never))).find((due) => due.action === 'send_confirmation');
    if (confirmation === undefined) throw new Error('No confirmation');

    clock.advance(60_000);
    expect(await runDue(db, deps, firm, confirmation.id)).toEqual({ ran: 'done', outcome: 'sent' });
    const sent = deps.texts.sent[deps.texts.sent.length - 1];
    expect(sent).toMatchObject({ from: number, to: '+447700900003' });
    expect(sent?.body).toMatch(
      /^Hi Mrs Ahmed, it's Second Example Firm\. Example Owner will be with you on Thursday 1 October at 8am to look at the job and price it\. Need to change it\? Just reply here\. Check your details: https:\/\/links\.example\/d\/[0-9a-z]{26} Reply STOP to stop these texts\.$/,
    );
    const agreedWords = (await firmWording(db, firm))['text:visit_confirmation_first'];
    expect((await listMessagesBetween(db, firm, ...allTime)).map((message) => message.wording)).toContain(agreedWords?.id);
  });

  it('keeps its number while Calls & bookings is on: customers reply to the number they have', async () => {
    const changed = await page(`/control/firms/${firm}/number`, controlForm({ number: '07700 900203' }));
    expect(changed.status).toBe(400);
    expect(changed.words).toContain(escaped(CONTROL_WORDS.numberProblems.calls_on));
    expect((await getFirm(db, firm))?.phoneNumber).toBe('+447700900200');
  });
});

describe('changing the owner’s mobile', () => {
  it('refuses a landline, or the firm’s own number, and changes nothing', async () => {
    const landline = await page(`/control/firms/${firm}/owners/${owner}/mobile`, controlForm({ mobile: '01632 960001' }));
    expect(landline.status).toBe(400);
    const firms = await page(`/control/firms/${firm}/owners/${owner}/mobile`, controlForm({ mobile: '07700 900200' }));
    expect(firms.words).toContain(escaped(CONTROL_WORDS.mobileIsFirmsNumber));
    expect((await listOwners(db, firm))[0]?.mobile).toBe('+447700900201');
  });

  it('ends every login the owner has, and every login link not yet used, in the same step, recorded as done by staff', async () => {
    const cookie = await ownerCookie(db, firm);
    expect((await opener(app, cookie)('/')).status).toBe(200);
    const unused = await createLoginLink(db, firm, { owner, job: null });

    expect((await page(`/control/firms/${firm}/owners/${owner}/mobile`)).status).toBe(200);
    expect((await open(`/control/firms/${firm}/owners/${owner}/mobile`, controlForm({ mobile: '07700 900202' }))).status).toBe(303);

    expect((await listOwners(db, firm))[0]?.mobile).toBe('+447700900202');
    // The login on the old phone has ended: the app sends it to log in again.
    const after = await opener(app, cookie)('/');
    expect(after.status).not.toBe(200);
    expect(after.headers.get('Location') ?? '').toContain('/login');
    // The link already sent no longer works, and its text, still waiting, will not go.
    expect(await findLoginLink(db, unused.token)).toBeNull();
    expect(await getDue(db, firm, unused.due)).toMatchObject({ state: 'cancelled' });
    expect((await firmHistory()).slice(-1)).toEqual([['owner_mobile_set', true]]);
    expect((await staffLog(firm)).slice(-2)).toEqual([
      ['viewed_set_up_owner', true, owner, null],
      ['changed_owner_mobile', true, owner, null],
    ]);
  });
});

describe('the checks behind the forms', () => {
  it('find what a firm still needs: everything, for a firm just added', async () => {
    const bare = await getFirm(db, tidewellHeating);
    if (bare === null) throw new Error('No firm');
    expect(callsSetUpGaps({ ...bare, phoneNumber: null, urgentList: [], diaryRules: null }, [], {}).map((gap) => gap.kind)).toEqual([
      'number',
      'owner',
      'urgent_list',
      'diary',
      'wording',
    ]);
    expect(callsSetUpGaps(bare, [{ id: owner, name: 'Tom', mobile: null, createdAt: clock.now() }], {}).map((gap) => gap.kind)).toEqual([
      'owner_mobile',
      'wording',
    ]);
    const noQuoteVisits = { ...bare, diaryRules: bare.diaryRules === null ? null : { ...bare.diaryRules, lengths: { install: 240 } } };
    expect(callsSetUpGaps(noQuoteVisits, await listOwners(db, tidewellHeating), await firmWording(db, tidewellHeating))).toEqual([{ kind: 'quote_visit_length' }]);
  });

  it('take a name with a curly apostrophe, which a text makes straight, but not one a text cannot carry', () => {
    expect(nameProblems('O’Brien Plumbing', NAME_LIMITS.firm)).toEqual([]);
    expect(nameProblems('Łukasz Heating', NAME_LIMITS.firm)).toEqual([{ kind: 'not_gsm7', characters: ['Ł'] }]);
    expect(nameProblems('x'.repeat(61), NAME_LIMITS.owner)).toEqual([{ kind: 'too_long', longest: 60 }]);
  });

  it('give each problem with some wording, not only the first', () => {
    expect(wordingProblems('text:login_link', 'Log in: {token} ’')).toEqual([
      { kind: 'not_gsm7', characters: ['’'] },
      { kind: 'needs_link' },
      { kind: 'unknown_gap', gap: 'token' },
    ]);
    expect(wordingProblems('text:quote', 'Your quote.')).toEqual([{ kind: 'unknown_key' }]);
  });
});

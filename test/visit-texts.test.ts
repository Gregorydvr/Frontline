// Task 5 of docs/autopilot.md: three texts to customers, built and switched
// off. A visit moved, a visit cancelled, and the morning after a quote visit.
// Each is written to the due list only while the copy's TEXTS_ON setting
// names it, which no copy does, and goes only in wording the owner agreed.

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instant, instantFromIso, pretendClock } from '../src/clock';
import { textsOnFrom } from '../src/deps';
import { ownDiary } from '../src/diary/own';
import { runDue } from '../src/due';
import { segments, isGsm7 } from '../src/gsm';
import { historyLine } from '../src/history-lines';
import { DRAFT_WORDING, makeWords } from '../src/messages';
import { historyForJob, listDueForVisit, listJobs, listMessagesBetween, listVisitsForJob, optOut } from '../src/record';
import { openRecord } from '../src/record/db';
import { CALLS_WORDING } from '../src/set-up';
import { MESSAGE_KINDS, type FirmId, type MessageKind, type VisitId } from '../src/record/types';
import { testDeps } from './helpers/deps';
import { asAnotherCall, report, send, sendTool, tidewell, toolAnswer, toolCall } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-09-28T11:14:00+01:00'));
const db = openRecord(env.DB, clock);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const MRS_AHMED = '+447700900003';
const ALL_ON: MessageKind[] = ['visit_moved_notice', 'visit_cancelled_notice', 'visit_followup'];
const frontline = { kind: 'frontline' } as const;

let firm: FirmId;
let number: string;
let numbers = 700;
let deps = testDeps(clock);

beforeEach(async () => {
  clock.set(instantFromIso('2026-09-28T11:14:00+01:00'));
  numbers += 1;
  number = `+447700900${String(numbers)}`;
  firm = await tidewell(db, number);
});

/** Books Thursday 1 October at 3pm on Mrs Ahmed's call, with these texts switched on, files it, and runs her confirmation. */
async function booked(on: MessageKind[], confirm = true): Promise<VisitId> {
  deps = { ...testDeps(clock), textsOn: on };
  const app = createApp(() => deps);
  const call = `texts-${String(numbers)}`;
  expect(await toolAnswer(await sendTool(app, '/vapi/book', toolCall('book', { start: '2026-10-01T15:00' }, { to: number, callId: call })))).toMatchObject({ booked: true });
  clock.set(instant(clock.now() + 60_000));
  expect((await send(app, asAnotherCall(report('mrs-ahmed-booked', number), call))).status).toBe(200);
  const [job] = await listJobs(db, firm);
  const [visit] = job === undefined ? [] : await listVisitsForJob(db, firm, job.id);
  if (visit === undefined) throw new Error('Not booked');
  if (confirm) {
    const confirmation = (await listDueForVisit(db, firm, visit.id)).find((due) => due.action === 'send_confirmation');
    if (confirmation === undefined) throw new Error('No confirmation');
    expect(await runDue(db, deps, firm, confirmation.id)).toEqual({ ran: 'done', outcome: 'sent' });
  }
  return visit.id;
}

const waiting = async (visit: VisitId) => (await listDueForVisit(db, firm, visit)).filter((due) => due.state === 'waiting');
const rowFor = async (visit: VisitId, action: string) => (await waiting(visit)).find((due) => due.action === action);
const textsToHer = () => deps.texts.sent.filter((text) => text.to === MRS_AHMED).map((text) => text.body);

describe('switched off, as on every copy', () => {
  it('writes none of their rows when a visit is booked, moved or cancelled', async () => {
    const visit = await booked([]);
    expect((await waiting(visit)).map((due) => due.action)).toEqual(['send_reminder', 'tell_owner_booked']);
    expect(await ownDiary(db, []).move(firm, visit, instantFromIso('2026-10-02T09:00:00+01:00'), frontline)).toBe('moved');
    expect((await waiting(visit)).map((due) => due.action)).toEqual(['tell_owner_booked', 'send_reminder']);
    expect(await ownDiary(db, []).cancel(firm, visit, frontline)).toBe(true);
    expect(await waiting(visit)).toEqual([]);
  });

  it('sends nothing from a row written while one was on, once it is off', async () => {
    const visit = await booked(['visit_followup']);
    const row = await rowFor(visit, 'send_visit_followup');
    if (row === undefined) throw new Error('No row');
    clock.set(instantFromIso('2026-10-02T10:00:00+01:00'));
    const before = textsToHer().length;
    expect(await runDue(db, { ...deps, textsOn: [] }, firm, row.id)).toEqual({ ran: 'done', outcome: 'switched_off' });
    expect(textsToHer().slice(before)).toEqual([]);
    expect((await listMessagesBetween(db, firm, ...allTime)).filter((text) => text.kind === 'visit_followup')).toEqual([]);
  });

  it('is the setting on every copy: TEXTS_ON names none, and names only these three', () => {
    expect(textsOnFrom(env.TEXTS_ON)).toEqual([]);
    expect(textsOnFrom('visit_followup, visit_reminder,urgent_alert ,visit_moved_notice')).toEqual(['visit_moved_notice', 'visit_followup']);
    expect((Object.keys(MESSAGE_KINDS) as MessageKind[]).filter((kind) => MESSAGE_KINDS[kind].switchable)).toEqual(ALL_ON);
  });

  it('are not needed before Calls & bookings, and the demo firm has not agreed them', () => {
    for (const kind of ALL_ON) expect(CALLS_WORDING).not.toContain(kind);
  });
});

describe('the text after a quote visit, switched on', () => {
  it('goes at 10am the day after the visit, in the words the owner agreed, and the owner sees it', async () => {
    const visit = await booked(['visit_followup']);
    expect(await rowFor(visit, 'send_visit_followup')).toMatchObject({
      runAt: instantFromIso('2026-10-02T10:00:00+01:00'),
      latestAt: instantFromIso('2026-10-02T20:00:00+01:00'),
    });
    const row = await rowFor(visit, 'send_visit_followup');
    if (row === undefined) throw new Error('No row');
    clock.set(instantFromIso('2026-10-02T10:00:00+01:00'));
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(textsToHer().at(-1)).toBe('Hi Mrs Ahmed, thanks for having Tom round. Tidewell Heating will be in touch with the price. Any questions? Just reply here.');
    const [job] = await listJobs(db, firm);
    if (job === undefined) throw new Error('No job');
    expect((await historyForJob(db, firm, job.id)).map((entry) => historyLine(entry, 'job')).at(-1)).toBe('Thanked them after the visit.');
  });

  it('follows the visit when it moves, and goes with it when it is cancelled', async () => {
    const visit = await booked(['visit_followup']);
    await ownDiary(db, deps.textsOn).move(firm, visit, instantFromIso('2026-10-05T09:00:00+01:00'), frontline);
    expect((await waiting(visit)).filter((due) => due.action === 'send_visit_followup').map((due) => due.runAt)).toEqual([instantFromIso('2026-10-06T10:00:00+01:00')]);
    await ownDiary(db, deps.textsOn).cancel(firm, visit, frontline);
    expect(await rowFor(visit, 'send_visit_followup')).toBeUndefined();
  });

  it('does not go to a customer who opted out of it', async () => {
    const visit = await booked(['visit_followup']);
    const [job] = await listJobs(db, firm);
    if (job === undefined) throw new Error('No job');
    await optOut(db, firm, job.customer, 'visit_followup', { kind: 'customer' });
    const row = await rowFor(visit, 'send_visit_followup');
    if (row === undefined) throw new Error('No row');
    clock.set(instantFromIso('2026-10-02T10:00:00+01:00'));
    const before = textsToHer().length;
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'not_sent' });
    expect(textsToHer().slice(before)).toEqual([]);
  });
});

describe('the text that a visit moved, switched on', () => {
  it('goes at once with the new day and time, to a customer whose confirmation went', async () => {
    const visit = await booked(['visit_moved_notice']);
    clock.set(instantFromIso('2026-09-28T15:00:00+01:00'));
    expect(await ownDiary(db, deps.textsOn).move(firm, visit, instantFromIso('2026-10-02T09:00:00+01:00'), frontline)).toBe('moved');
    const row = await rowFor(visit, 'send_visit_moved');
    if (row === undefined) throw new Error('No row');
    expect(row.latestAt).toBe(instantFromIso('2026-10-02T09:00:00+01:00'));
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(textsToHer().at(-1)).toBe("Hi Mrs Ahmed, it's Tidewell Heating. Tom's visit has moved to Friday 2 October at 9am. Need to change it? Just reply here.");
  });

  it('is not written while her confirmation still waits, since that gives the new time itself', async () => {
    const visit = await booked(['visit_moved_notice'], false);
    await ownDiary(db, deps.textsOn).move(firm, visit, instantFromIso('2026-10-02T09:00:00+01:00'), frontline);
    expect(await rowFor(visit, 'send_visit_moved')).toBeUndefined();
  });

  it('goes once for two moves, at the latest time, and waits for 8am after one at night', async () => {
    const visit = await booked(['visit_moved_notice']);
    clock.set(instantFromIso('2026-09-28T21:00:00+01:00'));
    const diary = ownDiary(db, deps.textsOn);
    await diary.move(firm, visit, instantFromIso('2026-10-02T09:00:00+01:00'), frontline);
    await diary.move(firm, visit, instantFromIso('2026-10-02T11:00:00+01:00'), frontline);
    const rows = (await waiting(visit)).filter((due) => due.action === 'send_visit_moved');
    expect(rows).toHaveLength(1);
    const [row] = rows;
    if (row === undefined) throw new Error('No row');
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'held' });
    clock.set(instantFromIso('2026-09-29T08:00:00+01:00'));
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(textsToHer().at(-1)).toContain('moved to Friday 2 October at 11am.');
  });
});

describe('the text that a visit is cancelled, switched on', () => {
  it('goes with the day and time it was, to a customer whose confirmation went', async () => {
    const visit = await booked(['visit_cancelled_notice']);
    expect(await ownDiary(db, deps.textsOn).cancel(firm, visit, frontline)).toBe(true);
    const row = await rowFor(visit, 'send_visit_cancelled');
    if (row === undefined) throw new Error('No row');
    expect(await runDue(db, deps, firm, row.id)).toEqual({ ran: 'done', outcome: 'sent' });
    expect(textsToHer().at(-1)).toBe("Hi Mrs Ahmed, it's Tidewell Heating. Your visit on Thursday 1 October at 3pm is cancelled. Need a new time? Just reply here.");
    const [job] = await listJobs(db, firm);
    if (job === undefined) throw new Error('No job');
    expect((await historyForJob(db, firm, job.id)).map((entry) => historyLine(entry, 'feed')).at(-1)).toBe('Told Mrs Ahmed their visit is cancelled.');
  });

  it('is not written for a customer who was never told of the visit', async () => {
    const visit = await booked(['visit_cancelled_notice'], false);
    await ownDiary(db, deps.textsOn).cancel(firm, visit, frontline);
    expect(await waiting(visit)).toEqual([]);
  });
});

describe('the draft wording, to agree', () => {
  it.each(ALL_ON)('of %s is GSM-7 and two texts at most, with the longest names a call can give', (kind) => {
    const draft = DRAFT_WORDING[kind];
    if (draft === null) throw new Error('No draft');
    const words = makeWords(draft, {
      customer: 'Mrs Bartholomew-Fitzgerald',
      firm: 'Tidewell Heating and Plumbing Services',
      owner: 'Christopher',
      day: 'Wednesday 30 September',
      time: '12:30pm',
    });
    expect(isGsm7(words)).toBe(true);
    expect(segments(words)).toBeLessThanOrEqual(2);
  });
});

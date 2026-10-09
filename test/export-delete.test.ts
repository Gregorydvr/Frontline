// Exporting and deleting one customer from the control room (slice G of
// docs/build-brief.md). One invented customer, Miss Quill, is given every
// kind of row the record holds: calls (one urgent, with the owner's alert),
// a job, a visit with its confirmation and link, texts in, a STOP, details
// confirmed from her link, a time held and let go, a call from her number
// whose details did not come through, an owner's login link to her job, and
// history. Then every table in the database is read:
// - the export holds every row there that is about her
// - after the delete, nothing about her is left, apart from the listed
//   exceptions: the staff log's record of what staff did, by id only; her
//   bare mobile on the firm's list of numbers that get no text, since she
//   texted STOP; and what the owner wrote in Message us that names her
// The second firm's Miss Quill, with the same name and mobile, is untouched.

import { env } from 'cloudflare:workers';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { runDue } from '../src/due';
import { ukMobile } from '../src/phone';
import {
  addDue,
  confirmCustomerDetails,
  createLoginLink,
  createVisit,
  customerFile,
  deleteCustomer,
  findOrAddStaff,
  getCustomer,
  holdTime,
  listJobsForCustomer,
  listOwners,
  logStaff,
  moveRecording,
  placeInInbox,
  recordCall,
  recordOwnerMessage,
  recordTextIn,
  releaseHold,
} from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import type { CallId, CustomerId, FirmId, StaffId } from '../src/record/types';
import { localFiles, namesIn } from './helpers/files';
import { controlForm, controlOpener } from './helpers/control';
import { firmRows, rowsHolding, staffLogRows, tryToDeleteHistory, tryToDeleteStaffLog, tryToEditStaffLog } from './helpers/db';
import { testDeps } from './helpers/deps';
import { tidewell } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-10-15T10:00:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const open = controlOpener(createApp(() => deps));

const NAME = 'Miss Quill';
const MOBILE = '+447700900077';
const ADDRESS = 'Flat 2, 9 Mill Lane';
const EMAIL = 'quill@example.com';
const SAID = 'The hall radiator is cold.';
const TRANSCRIPT = 'Caller: the hall radiator is cold, can someone come and look?';
const TEXTED = 'Quill here, thank you.';
const RECORDED = 'Invented bytes standing for her recording.';
/** Her recorded call, in each firm. */
const recordings = new Map<FirmId, CallId>();
const withFiles = openRecord(env.DB, clock, localFiles());

let a: FirmId;
let b: FirmId;
let quill: CustomerId;
let twin: CustomerId;
let staff: StaffId;
/** Every id and detail of hers, to look for in every table. */
let markers: string[];

/** Gives a firm its Miss Quill, with every kind of row. */
async function missQuill(firm: FirmId): Promise<{ customer: CustomerId; ids: string[] }> {
  const ids: string[] = [];
  let calls = 0;
  const call = (rest: Pick<Parameters<typeof recordCall>[2], 'for' | 'urgentItem'>) => {
    calls += 1;
    return recordCall(db, firm, {
      provider: 'vapi',
      providerCallId: `quill-${firm}-${String(calls)}`,
      startedAt: clock.now(),
      endedAt: null,
      from: ukMobile(MOBILE),
      summary: SAID,
      transcript: TRANSCRIPT,
      ...rest,
    });
  };
  const first = await call({
    for: { kind: 'new_customer', name: NAME, mobile: ukMobile(MOBILE), landline: null, noText: null, about: 'Cold radiator', place: ADDRESS },
    urgentItem: null,
  });
  if (first.customer === null || first.job === null) throw new Error('No customer');
  const customer = first.customer;
  ids.push(customer, first.job, first.call);

  // A call of hers with its recording, kept in the file store (slice H).
  const inbox = `firms/${firm}/quill-mono.mp3`;
  await placeInInbox(withFiles, firm, inbox, new TextEncoder().encode(RECORDED));
  const recorded = await recordCall(db, firm, {
    provider: 'vapi',
    providerCallId: `quill-${firm}-recorded`,
    startedAt: clock.now(),
    endedAt: clock.now(),
    from: ukMobile(MOBILE),
    for: { kind: 'customer', customer, about: 'Cold radiator again', place: ADDRESS },
    urgentItem: null,
    summary: SAID,
    transcript: TRANSCRIPT,
    recording: { kind: 'waiting', from: inbox },
  });
  expect(await moveRecording(withFiles, firm, recorded.call)).toBe('kept');
  ids.push(recorded.call);
  recordings.set(firm, recorded.call);

  // A quote visit, its confirmation (her first text, with her link), and her details confirmed from it.
  const visit = await createVisit(db, firm, { job: first.job, startsAt: instantFromIso('2026-10-19T09:00:00+01:00'), kind: 'quote_visit' });
  ids.push(visit);
  const confirmation = await addDue(db, firm, { action: 'send_confirmation', visit, runAt: clock.now(), latestAt: instantFromIso('2026-10-19T00:00:00+01:00') });
  expect(await runDue(db, deps, firm, confirmation)).toEqual({ ran: 'done', outcome: 'sent' });
  await confirmCustomerDetails(db, firm, customer, first.job, { name: NAME, address: ADDRESS, email: EMAIL });
  // A reminder still waiting.
  await addDue(db, firm, { action: 'send_reminder', visit, runAt: instantFromIso('2026-10-18T13:00:00+01:00'), latestAt: instantFromIso('2026-10-19T00:00:00+01:00') });

  // An urgent call, and the owner's alert about it, which carries her name and number.
  const urgent = await call({ for: { kind: 'customer', customer, about: 'A leak', place: ADDRESS }, urgentItem: 'a leak' });
  if (urgent.alert === null || urgent.job === null) throw new Error('No alert');
  ids.push(urgent.job, urgent.call);
  expect(await runDue(db, deps, firm, urgent.alert)).toEqual({ ran: 'done', outcome: 'sent' });
  // A time held during that call, let go since it was urgent.
  const hold = await holdTime(db, firm, {
    provider: 'vapi',
    providerCallId: `quill-${firm}-2`,
    kind: 'quote_visit',
    startsAt: instantFromIso('2026-10-20T10:00:00+01:00'),
    endsAt: instantFromIso('2026-10-20T11:00:00+01:00'),
  });
  if (hold === null) throw new Error('Not held');
  await releaseHold(db, firm, hold);

  // A call from her number whose details did not come through: no customer.
  const missing = await call({ for: { kind: 'details_missing' }, urgentItem: null });
  ids.push(missing.call);

  // Texts from her: one about the visit, then STOP.
  for (const [words, consent] of [[TEXTED, null], ['STOP', 'stop']] as const) {
    const text = await recordTextIn(db, firm, { provider: 'fake', providerId: `in-${firm}-${words}`, from: MOBILE, words, consent });
    if (text.result !== 'stored') throw new Error('Not stored');
    ids.push(text.text);
  }

  // An owner's login link that would land on her job, and what the owner wrote about her.
  const [owner] = await listOwners(db, firm);
  if (owner === undefined) throw new Error('No owner');
  await createLoginLink(db, firm, { owner: owner.id, job: first.job });
  await recordOwnerMessage(db, firm, owner.id, `Please ring ${NAME} back about the radiator.`);
  return { customer, ids };
}

/** A row as the export gives it: times as UTC dates, and no keys. */
function asExported(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (column === 'token' || column === 'claim') continue;
    out[column] = (column === 'at' || column.endsWith('_at')) && typeof value === 'number' ? new Date(value).toISOString() : value;
  }
  return out;
}

beforeAll(async () => {
  a = await tidewell(db);
  b = await tidewell(db, '07700 900200');
  const ofA = await missQuill(a);
  quill = ofA.customer;
  twin = (await missQuill(b)).customer;
  staff = (await findOrAddStaff(db, 'staff@example.com')).id;
  markers = [...ofA.ids, NAME, MOBILE, '07700 900077', ADDRESS, EMAIL, SAID, TRANSCRIPT, TEXTED];
});

/** What the staff log and the firm's other kept rows may hold about her: never more. */
function kept(found: { table: string; row: Record<string, unknown> }[]) {
  return found.filter(({ table }) => table !== 'staff_log');
}

describe('exporting a customer', () => {
  it('gives a file holding every row about her, from every table, and records who exported it', async () => {
    const before = kept(await rowsHolding(env.DB, a, markers));
    // Every kind of row is there to find.
    expect(new Set(before.map(({ table }) => table))).toEqual(
      new Set(['customers', 'jobs', 'visits', 'calls', 'history', 'messages', 'links', 'login_links', 'due', 'texts_in', 'opt_outs', 'opted_out_numbers', 'owner_messages']),
    );

    const answer = await open(`/control/firms/${a}/customers/${quill}/export`, controlForm({}));
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Content-Disposition')).toBe(`attachment; filename="frontline-export-${a}-${quill}.zip"`);
    expect(answer.headers.get('Content-Type')).toBe('application/zip');
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    const zip = unzipSync(new Uint8Array(await answer.arrayBuffer()));
    const file = JSON.parse(strFromU8(zip['customer.json'] ?? new Uint8Array(0))) as {
      tables: Record<string, Record<string, unknown>[]>;
      ownerMessagesNamingThem: Record<string, unknown>[];
      historyAsTheOwnerReadsIt: { at: string; line: string | null }[];
    };
    for (const { table, row } of before) {
      const exported = table === 'owner_messages' ? file.ownerMessagesNamingThem : (file.tables[table] ?? []);
      expect(exported, table).toContainEqual(asExported(row));
    }
    // And her recording, as it is kept.
    const recorded = recordings.get(a);
    expect(strFromU8(zip[`recordings/${recorded ?? ''}.mp3`] ?? new Uint8Array(0))).toBe(RECORDED);
    expect(Object.keys(zip).sort()).toEqual(['customer.json', `recordings/${recorded ?? ''}.mp3`]);
    // And the rows that hold none of her details but are about her: the due list's rows and her opt-outs.
    expect(file.tables.due?.length).toBeGreaterThanOrEqual(3);
    expect(file.tables.opt_outs).toMatchObject([{ customer_id: quill, kind: 'every' }]);
    expect(file.tables.holds).toHaveLength(1);
    // No key a link opens with.
    expect(JSON.stringify(file)).not.toMatch(/"token"/);
    expect(file.historyAsTheOwnerReadsIt.map(({ line }) => line)).toContain('Answered the call.');

    expect((await staffLogRows(env.DB)).at(-1)).toMatchObject({ firm_id: a, what: 'exported_customer', customer_id: quill, staff_id: staff });
  });

  it('holds nothing of another firm’s customer of the same name and number', async () => {
    const file = await customerFile(db, a, quill);
    expect(JSON.stringify(file)).not.toContain(twin);
    expect(JSON.stringify(file)).not.toContain(b);
  });
});

describe('deleting a customer', () => {
  it('is refused, and deletes nothing, when the name typed is not hers', async () => {
    const before = await firmRows(env.DB, a);
    const answer = await open(`/control/firms/${a}/customers/${quill}/delete`, controlForm({ name: 'Mrs Quill' }));
    expect(answer.status).toBe(400);
    expect(await answer.text()).toContain('That is not their name as it is held. Nothing was deleted.');
    expect(await firmRows(env.DB, a)).toEqual(before);
    await expect(deleteCustomer(db, a, quill, staff, '')).rejects.toThrow(Refused);
  });

  it('cannot delete her history any other way, nor change or delete the staff log', async () => {
    const [entry] = (await firmRows(env.DB, a)).history as { id: string; customer_id: string | null }[];
    await expect(tryToDeleteHistory(env.DB, entry?.id ?? '')).rejects.toThrow(/History is deleted only with what it is about/);
    const logged = await logStaff(db, a, staff, 'viewed_customer', { customer: quill });
    await expect(tryToEditStaffLog(env.DB, logged)).rejects.toThrow(/never edited/);
    await expect(tryToDeleteStaffLog(env.DB, logged)).rejects.toThrow(/never deleted/);
  });

  it('leaves nothing about her, apart from the staff log, her bare mobile on the no-text list, and the owner’s own words', async () => {
    const answer = await open(`/control/firms/${a}/customers/${quill}/delete`, controlForm({ name: ' miss  QUILL ' }));
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain('The customer and everything held about them is deleted.');

    const left = await rowsHolding(env.DB, a, markers);
    expect(left.filter(({ table }) => !['staff_log', 'opted_out_numbers', 'owner_messages'].includes(table))).toEqual([]);
    // The staff log holds ids, and names from fixed lists, only.
    for (const { row } of left.filter(({ table }) => table === 'staff_log')) {
      expect(Object.keys(row).sort()).toEqual(['at', 'customer_id', 'firm_id', 'id', 'message_kind', 'owner_id', 'seq', 'service', 'staff_id', 'what']);
    }
    expect(left.filter(({ table }) => table === 'opted_out_numbers').map(({ row }) => row)).toEqual([
      { firm_id: a, mobile: MOBILE, at: expect.any(Number) as number },
    ]);
    expect(await getCustomer(db, a, quill)).toBeNull();
    // Her recording is gone from the file store, and nothing is left in the bin.
    expect(await namesIn(localFiles().kept, `firms/${a}/calls/`)).toEqual([]);
    expect(await namesIn(localFiles().inbox, `firms/${a}/`)).toEqual([]);
    // The delete is recorded, with who did it.
    expect((await staffLogRows(env.DB)).at(-1)).toMatchObject({ firm_id: a, what: 'deleted_customer', customer_id: quill, staff_id: staff });
    // A later customer on her mobile still gets no text: her STOP stands.
    expect(left.some(({ table }) => table === 'opted_out_numbers')).toBe(true);
  });

  it('leaves the other firm’s customer of the same name and number untouched', async () => {
    expect(await getCustomer(db, b, twin)).toMatchObject({ name: NAME, mobile: MOBILE });
    expect(await namesIn(localFiles().kept, `firms/${b}/calls/`)).toEqual([`firms/${b}/calls/${recordings.get(b) ?? ''}.mp3`]);
    expect(await listJobsForCustomer(db, b, twin)).toHaveLength(3);
    expect(await rowsHolding(env.DB, b, [twin])).not.toEqual([]);
  });

  it('deletes once: pressed again, it finds nothing and says so', async () => {
    const before = await firmRows(env.DB, a);
    expect(await deleteCustomer(db, a, quill, staff, NAME)).toBeNull();
    const answer = await open(`/control/firms/${a}/customers/${quill}/delete`, controlForm({ name: NAME }));
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain('Already deleted, or not found.');
    expect(await firmRows(env.DB, a)).toEqual(before);
  });

  it('cannot run as another firm: Miss Quill of the second firm, named under the first firm, is not found', async () => {
    const before = await firmRows(env.DB, b);
    expect(await deleteCustomer(db, a, twin, staff, NAME)).toBeNull();
    expect(await customerFile(db, a, twin)).toBeNull();
    expect(await (await open(`/control/firms/${a}/customers/${twin}/delete`, controlForm({ name: NAME }))).text()).toContain('Already deleted, or not found.');
    expect(await firmRows(env.DB, b)).toEqual(before);
  });
});

// Exporting one firm, a firm leaving, and deleting one firm (slice H of
// docs/build-brief.md). When a firm leaves, its records are handed over as a
// file and deleted within 30 days.

import { env } from 'cloudflare:workers';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instant, instantFromIso, pretendClock, type Instant } from '../src/clock';
import { everyMinute, runDue } from '../src/due';
import { loadExample } from '../src/example/load';
import { EXPORT_HEADINGS, makeFirmExport } from '../src/firm-export';
import { newId } from '../src/ids';
import { ukMobile } from '../src/phone';
import {
  addDue,
  askFirmExport,
  cancelLeaving,
  createLoginLink,
  giveUpRecording,
  holdTime,
  linkForDue,
  listCustomers,
  listJobsForCustomer,
  listOwners,
  logInWithLink,
  optOut,
  optOutNumber,
  recordOwnerMessage,
  recordTextIn,
  createCustomer,
  createJob,
  deleteFirm,
  deleteLeftFirm,
  findFirmByNumber,
  findOrAddStaff,
  getDue,
  getFirm,
  listFirmExports,
  markLeaving,
  moveRecording,
  placeInInbox,
  recordCall,
  wasFirmDeleted,
} from '../src/record';
import { openRecord, Refused, runTogether } from '../src/record/db';
import { eraseFirmStatements, FIRM_TABLES } from '../src/record/erase';
import { forExport } from '../src/record/firm-file';
import type { CallId, FirmId, StaffId } from '../src/record/types';
import { controlForm, controlOpener } from './helpers/control';
import { dueRowsFor, firmRows, insertManyCallsPastTheRecord, staffLogRows, tryToDeleteDeletedFirm } from './helpers/db';
import { testDeps } from './helpers/deps';
import { failingOn, localFiles, namesIn } from './helpers/files';
import { report, send } from './helpers/vapi';

const START = instantFromIso('2026-10-15T16:00:00+01:00');
const DAY = 24 * 60 * 60_000;
const clock = pretendClock(START);
const deps = testDeps(clock);
const db = openRecord(env.DB, clock, deps.files);
const files = localFiles();
const open = controlOpener(createApp(() => deps));

let numbers = 500;
/** A firm of the example's shape, with a number of its own. */
async function firmNamed(name: string): Promise<{ firm: FirmId; number: string }> {
  numbers += 1;
  const number = `07700 900${String(numbers)}`;
  return { firm: await loadExample(env.DB, { name, isExample: false, number }), number };
}

/** A call to the firm with its recording kept. */
async function recordedCall(firm: FirmId): Promise<CallId> {
  const name = `firms/${firm}/firm-${newId()}-mono.mp3`;
  await placeInInbox(db, firm, name, new TextEncoder().encode('Invented bytes, not a real recording.'));
  const made = await recordCall(db, firm, {
    provider: 'vapi',
    providerCallId: `firm-${newId()}`,
    startedAt: clock.now(),
    endedAt: clock.now(),
    from: ukMobile('07700 900300'),
    for: { kind: 'not_customer', caller: 'a supplier' },
    urgentItem: null,
    summary: 'Your order is ready to collect.',
    transcript: 'Invented transcript.',
    recording: { kind: 'waiting', from: name },
  });
  expect(await moveRecording(db, firm, made.call)).toBe('kept');
  return made.call;
}

/** Gives the firm a row in every table that holds a firm's rows. */
async function everyKindOfRow(firm: FirmId): Promise<void> {
  const staff = await staffId();
  const [owner] = await listOwners(db, firm);
  const [customer] = await listCustomers(db, firm);
  if (owner === undefined || customer === undefined) throw new Error('Not the example');
  const [job] = await listJobsForCustomer(db, firm, customer.id);
  if (job === undefined) throw new Error('No job');
  await recordedCall(firm);
  await askFirmExport(db, firm, staff);
  await optOut(db, firm, customer.id, 'visit_reminder', { kind: 'frontline' });
  await optOutNumber(db, firm, ukMobile('07700 900399'));
  await recordTextIn(db, firm, { provider: 'fake', providerId: `every-${firm}`, from: '+447700900399', words: 'Hello.', consent: null });
  await recordOwnerMessage(db, firm, owner.id, 'Invented words.');
  await holdTime(db, firm, { provider: 'vapi', providerCallId: `every-${firm}`, kind: 'quote_visit', startsAt: instant(START + 3 * DAY), endsAt: instant(START + 3 * DAY + 3_600_000) });
  const due = await addDue(db, firm, { action: 'send_confirmation', runAt: START, latestAt: START });
  await linkForDue(db, firm, { due, customer: customer.id, job: job.id });
  const login = await createLoginLink(db, firm, { owner: owner.id, job: null });
  expect(await runDue(db, deps, firm, login.due)).toEqual({ ran: 'done', outcome: 'sent' });
  expect(await logInWithLink(db, login.token)).not.toBeNull();
  // A file in the bin, put there as a delete leaves it.
  const waiting = await recordCall(db, firm, {
    provider: 'vapi',
    providerCallId: `every-bin-${firm}`,
    startedAt: START,
    endedAt: START,
    from: null,
    for: { kind: 'details_missing' },
    urgentItem: null,
    summary: null,
    transcript: null,
    recording: { kind: 'waiting', from: `firms/${firm}/never-arrived.mp3` },
  });
  await giveUpRecording(openRecord(env.DB, clock, { kept: files.kept, inbox: failingOn(files.inbox, 'delete') }), firm, waiting.call).catch(() => undefined);
}

/** The clock's minute: every row due goes on the queue, and the worker runs each. */
async function minute(at: Instant = clock.now()): Promise<void> {
  clock.set(at);
  const before = deps.queue.bodies.length;
  await everyMinute(env.DB, deps);
  for (const body of deps.queue.bodies.slice(before)) {
    await runDue(db, deps, body.firm, body.due);
  }
}

async function staffId(): Promise<StaffId> {
  return (await findOrAddStaff(db, 'staff@example.com')).id;
}

/** Downloads the firm's newest made export from the control room, and opens the zip. */
async function downloaded(firm: FirmId): Promise<Record<string, Uint8Array>> {
  const made = (await listFirmExports(db, firm)).find((one) => one.state === 'ready');
  if (made === undefined) throw new Error('No export made');
  const answer = await open(`/control/firms/${firm}/export/${made.id}`);
  expect(answer.status).toBe(200);
  expect(answer.headers.get('Content-Type')).toBe('application/zip');
  expect(answer.headers.get('Content-Disposition')).toBe(`attachment; filename="frontline-firm-export-${firm}-${made.id}.zip"`);
  return unzipSync(new Uint8Array(await answer.arrayBuffer()));
}

describe('exporting a firm', () => {
  it('makes, by a row in the due list, a zip of every row of every table the firm has, spreadsheets, and the recordings kept', async () => {
    clock.set(START);
    const { firm } = await firmNamed('Export Example Firm');
    const call = await recordedCall(firm);
    // A customer whose name a spreadsheet would take as a formula.
    const sly = await createCustomer(db, firm, { name: '=HYPERLINK("https://example.invalid")', mobile: ukMobile('07700 900301') });
    await createJob(db, firm, { customer: sly, about: '+1 radiator', place: '@home', urgent: false });

    expect((await open(`/control/firms/${firm}/export`, controlForm({}))).status).toBe(303);
    expect((await listFirmExports(db, firm)).map((one) => one.state)).toEqual(['asked']);
    await minute();
    expect((await listFirmExports(db, firm)).map((one) => one.state)).toEqual(['ready']);

    const zip = await downloaded(firm);
    expect(Object.keys(zip).sort()).toEqual(
      ['calls.csv', 'customers.csv', 'everything.json', 'history.csv', 'jobs.csv', 'texts.csv', 'visits.csv', `recordings/${call}.mp3`].sort(),
    );
    expect(strFromU8(zip[`recordings/${call}.mp3`] ?? new Uint8Array(0))).toBe('Invented bytes, not a real recording.');

    // Every row the firm holds, in every table, is in everything.json, as an export gives it.
    const everything = JSON.parse(strFromU8(zip['everything.json'] ?? new Uint8Array(0))) as { tables: Record<string, unknown[]> };
    const rows = await firmRows(env.DB, firm);
    for (const [table, held] of Object.entries(rows)) {
      // The bin and the exports themselves are not part of the firm's records; the staff log and the list of deleted firms are Front-line's own.
      if (['files_to_delete', 'firm_exports', 'staff_log', 'deleted_firms', 'erasing'].includes(table)) continue;
      expect(everything.tables[table], table).toBeDefined();
      for (const row of held as Record<string, unknown>[]) {
        // The rows of the clock's own work in that minute moved on after the file was made.
        if (table === 'due' && ['make_firm_export', 'sweep'].includes(String(row.action))) continue;
        expect(everything.tables[table], table).toContainEqual(forExport(row));
      }
    }
    // No key a link opens with.
    expect(strFromU8(zip['everything.json'] ?? new Uint8Array(0))).not.toMatch(/"token"/);

    // The spreadsheets: their headings, the customers by name, and nothing a spreadsheet would run.
    const customers = strFromU8(zip['customers.csv'] ?? new Uint8Array(0)).split('\r\n');
    expect(customers[0]).toBe(EXPORT_HEADINGS.customers.join(','));
    expect(customers.some((line) => line.startsWith('Mrs Ahmed,07700 900003,'))).toBe(true);
    expect(customers).toContainEqual(expect.stringMatching(/^"'=HYPERLINK\(""https:\/\/example\.invalid""\)",07700 900301,/));
    const jobs = strFromU8(zip['jobs.csv'] ?? new Uint8Array(0));
    expect(jobs).toContain("'+1 radiator,'@home");
    expect(strFromU8(zip['calls.csv'] ?? new Uint8Array(0))).toContain(`recordings/${call}.mp3`);
    expect(strFromU8(zip['history.csv'] ?? new Uint8Array(0)).split('\r\n')[0]).toBe(EXPORT_HEADINGS.history.join(','));
    expect(strFromU8(zip['history.csv'] ?? new Uint8Array(0))).toContain('Call from Mrs Green answered.');

    // The download is recorded.
    expect((await staffLogRows(env.DB)).at(-1)).toMatchObject({ firm_id: firm, what: 'downloaded_firm_export' });
    expect((await listFirmExports(db, firm))[0]?.downloadedAt).toBe(clock.now());
  });

  it('stopped halfway, keeps nothing half-made, and runs again', async () => {
    clock.set(START);
    const { firm } = await firmNamed('Halfway Export Firm');
    await recordedCall(firm);
    await askFirmExport(db, firm, await staffId());
    const broken = openRecord(env.DB, clock, { kept: failingOn(files.kept, 'get'), inbox: files.inbox });
    await expect(makeFirmExport(broken, firm)).rejects.toThrow('Broken on purpose');
    expect((await listFirmExports(db, firm)).map((one) => one.state)).toEqual(['asked']);
    expect(await namesIn(files.kept, `firms/${firm}/exports/`)).toEqual([]);
    expect(await makeFirmExport(db, firm)).toBe('made');
    expect((await listFirmExports(db, firm)).map((one) => one.state)).toEqual(['ready']);
    expect(await makeFirmExport(db, firm)).toBe('nothing_to_do');
  });

  it('copes with a busy firm’s year of calls', async () => {
    clock.set(START);
    const { firm } = await firmNamed('Busy Example Firm');
    const transcript = 'Caller: invented words of a call. '.repeat(60);
    await insertManyCallsPastTheRecord(env.DB, firm, 5_500, instantFromIso('2025-10-15T08:00:00Z'), transcript);
    await askFirmExport(db, firm, await staffId());
    expect(await makeFirmExport(db, firm)).toBe('made');
    const zip = await downloaded(firm);
    const everything = JSON.parse(strFromU8(zip['everything.json'] ?? new Uint8Array(0))) as { tables: Record<string, unknown[]> };
    // The example's own calls, and the year's.
    expect(everything.tables.calls?.length).toBe((await firmRows(env.DB, firm)).calls?.length);
    expect(everything.tables.calls?.length).toBeGreaterThan(5_500);
    expect(strFromU8(zip['calls.csv'] ?? new Uint8Array(0)).split('\r\n').length).toBeGreaterThan(5_500);
  }, 60_000);
});

describe('a firm leaving', () => {
  it('is refused unless its name is typed as held, and changes nothing', async () => {
    clock.set(START);
    const { firm } = await firmNamed('Typed Example Firm');
    const before = await firmRows(env.DB, firm);
    await expect(markLeaving(db, firm, await staffId(), 'Tidewell Heating')).rejects.toThrow(Refused);
    expect((await open(`/control/firms/${firm}/leaving`, controlForm({ name: 'Typed' }))).status).toBe(400);
    expect(await firmRows(env.DB, firm)).toEqual(before);
  });

  it('turns the stop button on and every service off, cancels the texts still waiting, asks for its export, and is deleted 30 days on', async () => {
    clock.set(START);
    const { firm, number } = await firmNamed('Leaving Example Firm');
    const staff = await staffId();
    const waiting = await addDue(db, firm, { action: 'send_reminder', runAt: instant(START + DAY), latestAt: instant(START + 2 * DAY) });
    expect((await open(`/control/firms/${firm}/leaving`, controlForm({ name: ' leaving example FIRM ' }))).status).toBe(303);

    const leaving = await getFirm(db, firm);
    expect(leaving).toMatchObject({ stopped: true, leaving: { at: START, by: staff } });
    expect(Object.values(leaving?.services ?? {})).toEqual([false, false, false, false, false]);
    expect((await getDue(db, firm, waiting))?.state).toBe('cancelled');
    expect((await listFirmExports(db, firm)).map((one) => one.state)).toEqual(['asked']);
    expect(await dueRowsFor(env.DB, firm, 'delete_firm')).toMatchObject([{ state: 'waiting', run_at: START + 30 * DAY, latest_at: 8_640_000_000_000_000 }]);
    expect((await staffLogRows(env.DB)).at(-1)).toMatchObject({ firm_id: firm, what: 'marked_leaving', staff_id: staff });
    // Its calls are no longer kept: its number finds nothing.
    expect(await findFirmByNumber(db, ukMobile(number))).toBeNull();
    expect((await send(createApp(() => deps), report('supplier', number))).status).toBe(404);
    // Marked twice, it is refused.
    await expect(markLeaving(db, firm, staff, 'Leaving Example Firm')).rejects.toThrow(Refused);
  });

  it('can be cancelled while the firm is still there', async () => {
    clock.set(START);
    const { firm, number } = await firmNamed('Staying Example Firm');
    const staff = await staffId();
    await markLeaving(db, firm, staff, 'Staying Example Firm');
    expect((await open(`/control/firms/${firm}/leaving/cancel`, controlForm({}))).status).toBe(303);
    expect((await getFirm(db, firm))?.leaving).toBeNull();
    expect((await dueRowsFor(env.DB, firm, 'delete_firm')).map((row) => row.state)).toEqual(['cancelled']);
    expect(await findFirmByNumber(db, ukMobile(number))).toBe(firm);
    await expect(cancelLeaving(db, firm, staff)).rejects.toThrow(Refused);
    await minute(instant(START + 31 * DAY));
    expect(await getFirm(db, firm)).not.toBeNull();
    clock.set(START);
  });
});

describe('deleting a firm', () => {
  it('is refused for a firm that is not leaving, by the record and by the database itself', async () => {
    clock.set(START);
    const { firm } = await firmNamed('Steady Example Firm');
    await everyKindOfRow(firm);
    const before = await firmRows(env.DB, firm);
    // A row in every table a firm's delete removes, so a statement that
    // lost its check would have something to delete.
    for (const table of FIRM_TABLES) {
      expect(before[table]?.length, table).toBeGreaterThan(0);
    }
    await expect(deleteFirm(db, firm, await staffId(), 'Steady Example Firm')).rejects.toThrow(Refused);
    expect(await deleteLeftFirm(db, firm)).toBe('nothing_to_do');
    // Even its delete's own statements, run past every check above, delete nothing.
    await runTogether(db.d1, eraseFirmStatements(db, firm, 'leaving'));
    expect(await firmRows(env.DB, firm)).toEqual(before);
  });

  it('by staff before its 30 days, needs its export made and its name typed, and leaves nothing of it', async () => {
    clock.set(START);
    const { firm } = await firmNamed('Going Example Firm');
    const other = await firmNamed('Other Example Firm');
    const call = await recordedCall(firm);
    await recordedCall(other.firm);
    const staff = await staffId();
    await markLeaving(db, firm, staff, 'Going Example Firm');
    // Not until its export is made.
    expect((await open(`/control/firms/${firm}/delete`)).status).toBe(200);
    await expect(deleteFirm(db, firm, staff, 'Going Example Firm')).rejects.toThrow(Refused);
    expect(await makeFirmExport(db, firm)).toBe('made');
    expect((await open(`/control/firms/${firm}/delete`, controlForm({ name: 'Other Example Firm' }))).status).toBe(400);
    expect(await getFirm(db, firm)).not.toBeNull();
    const otherBefore = await firmRows(env.DB, other.firm);

    const answer = await open(`/control/firms/${firm}/delete`, controlForm({ name: 'going example firm' }));
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain('The firm and everything it held is deleted.');

    // Nothing of it is left, in the database or either file store, apart
    // from the staff log and the note that it was deleted.
    const left = Object.entries(await firmRows(env.DB, firm)).filter(([, rows]) => rows.length > 0).map(([table]) => table);
    expect(left.sort()).toEqual(['deleted_firms', 'staff_log']);
    expect(await namesIn(files.kept, `firms/${firm}/`)).toEqual([]);
    expect(await namesIn(files.inbox, `firms/${firm}/`)).toEqual([]);
    expect(await wasFirmDeleted(db, firm)).toEqual({ deletedAt: START, by: 'staff' });
    expect((await staffLogRows(env.DB)).at(-1)).toMatchObject({ firm_id: firm, what: 'deleted_firm', staff_id: staff });
    await expect(tryToDeleteDeletedFirm(env.DB, firm)).rejects.toThrow(/never deleted/);
    expect(call).not.toBe('');
    // The other firm is untouched, and its recording kept.
    expect(await firmRows(env.DB, other.firm)).toEqual(otherBefore);
    expect(await namesIn(files.kept, `firms/${other.firm}/calls/`)).toHaveLength(1);
  });

  it('by the clock at the end of its 30 days, whether or not its export was downloaded, and again after stopping halfway', async () => {
    clock.set(START);
    const { firm } = await firmNamed('Lapsed Example Firm');
    await recordedCall(firm);
    await markLeaving(db, firm, await staffId(), 'Lapsed Example Firm');
    // Its export is made in the first minute; nobody downloads it.
    await minute();
    expect(await getFirm(db, firm)).not.toBeNull();
    await minute(instant(START + 30 * DAY - 60_000));
    expect(await getFirm(db, firm)).not.toBeNull();

    // The first try stops halfway through deleting its files.
    const [row] = await dueRowsFor(env.DB, firm, 'delete_firm');
    clock.set(instant(START + 30 * DAY));
    const broken = openRecord(env.DB, clock, { kept: failingOn(files.kept, 'delete'), inbox: files.inbox });
    await expect(runDue(broken, deps, firm, String(row?.id) as never)).rejects.toThrow('Broken on purpose');
    expect(await getFirm(db, firm)).not.toBeNull();

    // Its claim runs out, and the clock runs it again.
    await minute(instant(START + 30 * DAY + 11 * 60_000));
    expect(await getFirm(db, firm)).toBeNull();
    expect(await wasFirmDeleted(db, firm)).toEqual({ deletedAt: START + 30 * DAY + 11 * 60_000, by: 'clock' });
    expect(await namesIn(files.kept, `firms/${firm}/`)).toEqual([]);
    clock.set(START);
  });
});

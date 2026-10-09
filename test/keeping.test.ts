// Keeping and deleting (slice H of docs/build-brief.md): a call's recording
// moved into Front-line's own file store and deleted at the end of its
// period while the call stays, the periods as rows in the due list, the bin
// of files the record has let go of, and deletes done again after a restore.
//
// "Done when: with the pretend clock moved 31 days on, a recording is gone
// and its call remains."

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instant, instantFromIso, pretendClock, type Instant } from '../src/clock';
import { everyMinute, runDue } from '../src/due';
import { loadExample } from '../src/example/load';
import { historyLine } from '../src/history-lines';
import { newId } from '../src/ids';
import { ukMobile } from '../src/phone';
import {
  addMissingSweeps,
  askFirmExport,
  createLoginLink,
  createVisit,
  deleteCustomer,
  deleteRecording,
  emptyBin,
  findCallByProviderId,
  findOrAddStaff,
  getCall,
  getCallRecording,
  historyForJob,
  holdTime,
  linkForDue,
  listCustomers,
  listDueForCall,
  listJobsForCustomer,
  listOwners,
  logInWithLink,
  logStaff,
  moveRecording,
  needsALook,
  placeInInbox,
  recordCall,
  recordOwnerMessage,
  recordTextIn,
  setExampleClock,
  sweepFirm,
  addDue,
  getCustomer,
  getJob,
} from '../src/record';
import { openRecord, Refused } from '../src/record/db';
import { END_OF_TIME } from '../src/record/due';
import { ledgerSince } from '../src/record/files';
import { makeFirmExport } from '../src/firm-export';
import { nextSweepAt, SWEEP_LIMIT } from '../src/record/keeping';
import { PERIODS } from '../src/record/periods';
import type { CallId, FirmId, JobId } from '../src/record/types';
import { controlForm, controlOpener } from './helpers/control';
import { dueRowsFor, firmRows, insertSweepPastTheRecord, putBackAsARestore, staffLogRows, tryToDeleteStaffLog } from './helpers/db';
import { testDeps } from './helpers/deps';
import { failingOn, fileText, localFiles, namesIn, putFile, removeFile } from './helpers/files';
import { asAnotherCall, report, send, tidewell, type ReportName } from './helpers/vapi';

const START = instantFromIso('2026-10-15T08:10:00+01:00');
const DAY = 24 * 60 * 60_000;
const clock = pretendClock(START);
const deps = testDeps(clock);
const db = openRecord(env.DB, clock, deps.files);
const app = createApp(() => deps);
const files = localFiles();
const RECORDING = 'Invented bytes, not a real recording.';

/** The clock's minute at `at`: every row now due, for every firm, goes on the queue, and the worker runs each. */
async function minute(at: Instant = clock.now()): Promise<void> {
  clock.set(at);
  const before = deps.queue.bodies.length;
  await everyMinute(env.DB, deps);
  for (const body of deps.queue.bodies.slice(before)) {
    await runDue(db, deps, body.firm, body.due);
  }
}

/**
 * A call to the firm's number as Vapi sends it: its recording first written
 * into the inbox under the firm's own path, then the report as the call
 * ends, naming it. Gives the call and the inbox's name for its recording.
 */
async function ring(firm: FirmId, number: string, options: { fixture?: ReportName; place?: boolean; under?: FirmId } = {}): Promise<{ call: CallId; name: string }> {
  const callId = `keeping-${newId()}`;
  const name = `firms/${options.under ?? firm}/${callId}-mono.mp3`;
  if (options.place !== false) {
    await placeInInbox(db, options.under ?? firm, name, new TextEncoder().encode(RECORDING));
  }
  const body = asAnotherCall(report(options.fixture ?? 'mrs-ahmed-booked', number), callId);
  (body.message.artifact as Record<string, unknown>).recordingUrl = `https://frontline-practice-calls-in.example.invalid/${name}`;
  // The call ends now, by the pretend clock.
  body.message.startedAt = new Date(clock.now() - 120_000).toISOString();
  body.message.endedAt = new Date(clock.now()).toISOString();
  expect((await send(app, body)).status).toBe(200);
  const call = await findCallByProviderId(db, firm, 'vapi', callId);
  if (call === null) throw new Error('No call');
  return { call, name };
}

/** The lines the owner reads on a job's page. */
async function jobLines(firm: FirmId, job: JobId): Promise<string[]> {
  return (await historyForJob(db, firm, job)).map((entry) => historyLine(entry, 'job')).filter((line): line is string => line !== null);
}

describe('done when: with the pretend clock moved 31 days on, a recording is gone and its call remains', () => {
  it('moves the recording into the file store as the call ends, and deletes it 30 days on, keeping the call, its summary and its transcript', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900110');
    const { call, name } = await ring(firm, '+447700900110');
    await minute();

    // Kept in Front-line's own file store, under the firm's path, and gone from the inbox.
    const kept = `firms/${firm}/calls/${call}.mp3`;
    expect(await namesIn(files.kept, `firms/${firm}/`)).toEqual([kept]);
    expect(await fileText(files.kept, kept)).toBe(RECORDING);
    expect(await namesIn(files.inbox, `firms/${firm}/`)).toEqual([]);
    expect(name).not.toBe(kept);
    const held = await getCall(db, firm, call);
    expect(await getCallRecording(db, firm, call)).toEqual({
      state: 'kept',
      from: null,
      key: kept,
      until: instant((held?.endedAt ?? 0) + 30 * DAY),
      goneAt: null,
    });
    const job = held?.job;
    if (job == null) throw new Error('No job');
    const linesBefore = await jobLines(firm, job);

    // 30 days on, not yet; 31 days on, gone.
    expect(held?.endedAt).toBe(START);
    await minute(instant(START + 30 * DAY - 60_000));
    expect(await namesIn(files.kept, `firms/${firm}/`)).toEqual([kept]);
    await minute(instant(START + 31 * DAY));
    expect(await namesIn(files.kept, `firms/${firm}/`)).toEqual([]);

    // The call remains, with its summary and its transcript.
    const after = await getCall(db, firm, call);
    expect(after).toMatchObject({ id: call, summary: held?.summary, transcript: held?.transcript, job });
    expect(after?.transcript).toEqual(expect.any(String));
    expect(await getCallRecording(db, firm, call)).toMatchObject({ state: 'deleted', key: null, goneAt: expect.any(Number) as number });
    // History says Front-line deleted it; the owner reads nothing new.
    const entries = await historyForJob(db, firm, job);
    expect(entries.filter((entry) => entry.kind === 'recording_deleted')).toMatchObject([{ by: { kind: 'frontline' }, call: { id: call } }]);
    expect(await jobLines(firm, job)).toEqual(linesBefore);
  });

  it('runs on the demo firm’s own clock: moved 31 days on, its recording is gone, and another firm’s recording of the same day stays', async () => {
    clock.set(START);
    const demo = await loadExample(env.DB, { name: 'Tidewell Heating', isExample: true, number: '07700 900111' });
    const other = await tidewell(db, '07700 900112');
    const ofDemo = await ring(demo, '+447700900111');
    const ofOther = await ring(other, '+447700900112');
    await minute();
    expect((await getCallRecording(db, demo, ofDemo.call))?.state).toBe('kept');
    expect((await getCallRecording(db, other, ofOther.call))?.state).toBe('kept');

    const staff = (await findOrAddStaff(db, 'staff@example.com')).id;
    await setExampleClock(db, demo, instant(START + 31 * DAY), staff, 'move_on');
    await minute();

    expect(await getCallRecording(db, demo, ofDemo.call)).toMatchObject({ state: 'deleted' });
    expect(await namesIn(files.kept, `firms/${demo}/`)).toEqual([]);
    expect(await getCall(db, demo, ofDemo.call)).not.toBeNull();
    // The real clock has not moved: the other firm's is still kept.
    expect(await getCallRecording(db, other, ofOther.call)).toMatchObject({ state: 'kept' });
    expect(await namesIn(files.kept, `firms/${other}/`)).toEqual([`firms/${other}/calls/${ofOther.call}.mp3`]);
  });
});

describe('moving a recording', () => {
  it('moves once, however many times it runs', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900120');
    const { call } = await ring(firm, '+447700900120');
    expect(await moveRecording(db, firm, call)).toBe('kept');
    expect(await moveRecording(db, firm, call)).toBe('nothing_to_do');
    const [move] = (await listDueForCall(db, firm, call)).filter((due) => due.action === 'move_recording');
    if (move === undefined) throw new Error('No row');
    expect(await runDue(db, deps, firm, move.id)).toEqual({ ran: 'done', outcome: 'nothing_to_do' });
    expect(await runDue(db, deps, firm, move.id)).toEqual({ ran: 'not_ours' });
    expect(await namesIn(files.kept, `firms/${firm}/`)).toEqual([`firms/${firm}/calls/${call}.mp3`]);
  });

  it('stopped after the copy is kept and before the inbox’s is deleted, runs again and finishes', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900121');
    const { call, name } = await ring(firm, '+447700900121');
    const broken = openRecord(env.DB, clock, { kept: files.kept, inbox: failingOn(files.inbox, 'delete') });
    await expect(moveRecording(broken, firm, call)).rejects.toThrow('Broken on purpose');
    // Halfway: a whole copy kept, the inbox's still there, the call still waiting.
    expect(await namesIn(files.kept, `firms/${firm}/`)).toEqual([`firms/${firm}/calls/${call}.mp3`]);
    expect(await namesIn(files.inbox, `firms/${firm}/`)).toEqual([name]);
    expect((await getCallRecording(db, firm, call))?.state).toBe('waiting');

    expect(await moveRecording(db, firm, call)).toBe('kept');
    expect(await namesIn(files.inbox, `firms/${firm}/`)).toEqual([]);
    expect(await fileText(files.kept, `firms/${firm}/calls/${call}.mp3`)).toBe(RECORDING);
  });

  it('stopped after the inbox’s copy is deleted and before the call is marked, runs again and marks it', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900122');
    const { call, name } = await ring(firm, '+447700900122');
    // The copy kept and the inbox's deleted, the call still waiting: as a run that stopped there leaves them.
    await putFile(files.kept, `firms/${firm}/calls/${call}.mp3`, RECORDING);
    await removeFile(files.inbox, name);
    expect((await getCallRecording(db, firm, call))?.state).toBe('waiting');
    expect(await moveRecording(db, firm, call)).toBe('kept');
    expect(await getCallRecording(db, firm, call)).toMatchObject({ state: 'kept', key: `firms/${firm}/calls/${call}.mp3`, from: null });
  });

  it('waits while the recording is not in the inbox yet, and after a day marks the call as not kept, for staff to see', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900123');
    const { call, name } = await ring(firm, '+447700900123', { place: false });
    const [move] = (await listDueForCall(db, firm, call)).filter((due) => due.action === 'move_recording');
    if (move === undefined) throw new Error('No row');
    expect(await runDue(db, deps, firm, move.id)).toEqual({ ran: 'held' });
    expect((await getCallRecording(db, firm, call))?.state).toBe('waiting');

    // It arrives a little later: the next run moves it.
    await placeInInbox(db, firm, name, new TextEncoder().encode(RECORDING));
    clock.set(instant(START + 10 * 60_000));
    expect(await runDue(db, deps, firm, move.id)).toEqual({ ran: 'done', outcome: 'kept' });

    // Another that never arrives: past its latest time, the call is not kept.
    clock.set(START);
    const never = await ring(firm, '+447700900123', { place: false });
    const [stuck] = (await listDueForCall(db, firm, never.call)).filter((due) => due.action === 'move_recording');
    if (stuck === undefined) throw new Error('No row');
    clock.set(instant(START + PERIODS.recordingMove + 60_000));
    expect(await runDue(db, deps, firm, stuck.id)).toEqual({ ran: 'skipped', outcome: 'too_late' });
    expect((await getCallRecording(db, firm, never.call))?.state).toBe('not_kept');
    const look = await needsALook(db, firm, instant(START - DAY));
    expect(look.filter((item) => item.kind === 'recording_not_kept').map((item) => item.call)).toEqual([never.call]);
  });

  it('keeps nothing named under another firm’s path, and leaves that firm’s file alone', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900124');
    const other = await tidewell(db, '07700 900125');
    const { call, name } = await ring(firm, '+447700900124', { under: other });
    expect((await getCallRecording(db, firm, call))?.state).toBe('not_kept');
    expect(await listDueForCall(db, firm, call)).toEqual([]);
    expect(await namesIn(files.inbox, `firms/${other}/`)).toEqual([name]);
    expect(await namesIn(files.kept, `firms/${firm}/`)).toEqual([]);
    // The record itself refuses one too.
    await expect(
      recordCall(db, firm, {
        provider: 'vapi',
        providerCallId: `keeping-${newId()}`,
        startedAt: START,
        endedAt: null,
        from: null,
        for: { kind: 'details_missing' },
        urgentItem: null,
        summary: null,
        transcript: null,
        recording: { kind: 'waiting', from: name },
      }),
    ).rejects.toThrow(Refused);
  });

  it('fetches nothing a report names outside the inbox, such as Vapi’s own storage, and shows staff it was not kept', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900126');
    const callId = `keeping-${newId()}`;
    const body = asAnotherCall(report('supplier', '+447700900126'), callId);
    (body.message.artifact as Record<string, unknown>).recordingUrl = 'https://storage.vapi.example.invalid/recordings/one-mono.wav';
    expect((await send(app, body)).status).toBe(200);
    const call = await findCallByProviderId(db, firm, 'vapi', callId);
    if (call === null) throw new Error('No call');
    expect((await getCallRecording(db, firm, call))?.state).toBe('not_kept');
    expect(await listDueForCall(db, firm, call)).toEqual([]);
  });

  it('gives a call with no recording no rows, and leaves calls from before this slice as they were', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900127');
    expect((await send(app, asAnotherCall(report('supplier', '+447700900127'), `keeping-${newId()}`))).status).toBe(200);
    const [call] = (await firmRows(env.DB, firm)).calls as { id: CallId; recording_state: string }[];
    expect(call?.recording_state).toBe('none');
    expect(await listDueForCall(db, firm, call?.id ?? ('' as CallId))).toEqual([]);
  });
});

describe('deleting a recording', () => {
  it('is never too late: its latest time is the end of time, and it runs even ten years on', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900130');
    const { call } = await ring(firm, '+447700900130');
    await minute();
    const [row] = (await listDueForCall(db, firm, call)).filter((due) => due.action === 'delete_recording');
    expect(row?.latestAt).toBe(END_OF_TIME);
    expect(END_OF_TIME).toBe(8_640_000_000_000_000);
    clock.set(instant(START + 10 * 365 * DAY));
    expect(await runDue(db, deps, firm, row?.id ?? ('' as never))).toEqual({ ran: 'done', outcome: 'deleted' });
    expect(await namesIn(files.kept, `firms/${firm}/`)).toEqual([]);
  });

  it('stopped after its file is gone and before the call is marked, runs again and finishes, with one history entry', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900131');
    const { call } = await ring(firm, '+447700900131');
    await minute();
    const failing = openRecord(env.DB, clock, { kept: failingOn(files.kept, 'delete'), inbox: files.inbox });
    await expect(deleteRecording(failing, firm, call)).rejects.toThrow('Broken on purpose');
    expect((await getCallRecording(db, firm, call))?.state).toBe('kept');
    // The file goes, as a run that stopped straight after would leave it.
    await removeFile(files.kept, `firms/${firm}/calls/${call}.mp3`);
    expect(await deleteRecording(db, firm, call)).toBe('deleted');
    expect(await deleteRecording(db, firm, call)).toBe('nothing_to_do');
    const job = (await getCall(db, firm, call))?.job;
    expect((await historyForJob(db, firm, job ?? ('' as JobId))).filter((entry) => entry.kind === 'recording_deleted')).toHaveLength(1);
  });
});

describe('the daily sweep', () => {
  it('is a row in the due list for every firm, at 3:15am UK time, never too late, and one at a time', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900140');
    await Promise.all([addMissingSweeps(db), addMissingSweeps(db)]);
    const sweeps = await dueRowsFor(env.DB, firm, 'sweep');
    expect(sweeps).toMatchObject([{ state: 'waiting', run_at: instantFromIso('2026-10-16T03:15:00+01:00'), latest_at: END_OF_TIME }]);
    // The database refuses a second.
    await expect(insertSweepPastTheRecord(env.DB, firm, newId())).rejects.toThrow(/UNIQUE constraint failed/);
    // In winter, 3:15am UK time is 3:15 UTC.
    expect(nextSweepAt(instantFromIso('2026-12-01T12:00:00Z'))).toBe(instantFromIso('2026-12-02T03:15:00Z'));

    // Once run, the next minute adds the next day's.
    await minute(instantFromIso('2026-10-16T03:15:00+01:00'));
    await minute(instantFromIso('2026-10-16T03:16:00+01:00'));
    expect((await dueRowsFor(env.DB, firm, 'sweep')).map((row) => [row.state, row.outcome, row.run_at])).toEqual([
      ['done', 'swept', instantFromIso('2026-10-16T03:15:00+01:00')],
      ['waiting', null, instantFromIso('2026-10-17T03:15:00+01:00')],
    ]);
  });

  it('deletes each thing at the end of its period, and nothing before', async () => {
    const thirteenMonthsAgo = instantFromIso('2025-09-01T10:00:00+01:00');
    const elevenMonthsAgo = instantFromIso('2025-11-20T10:00:00Z');
    clock.set(thirteenMonthsAgo);
    const firm = await tidewell(db, '07700 900141');
    const staff = (await findOrAddStaff(db, 'staff@example.com')).id;
    const [owner] = await listOwners(db, firm);
    if (owner === undefined) throw new Error('No owner');
    let calls = 0;
    const call = (forWhom: Parameters<typeof recordCall>[2]['for'], from = '+447700900400', urgentItem: string | null = null) => {
      calls += 1;
      return recordCall(db, firm, {
        provider: 'vapi',
        providerCallId: `sweep-${firm}-${String(calls)}`,
        startedAt: clock.now(),
        endedAt: null,
        from: ukMobile(from),
        for: forWhom,
        urgentItem,
        summary: 'Invented summary.',
        transcript: 'Invented transcript.',
      });
    };
    const job = (name: string, mobile: string) =>
      call({ kind: 'new_customer', name, mobile: ukMobile(mobile), landline: null, noText: null, about: 'A cold radiator', place: '1 Mill Lane' }, mobile);

    // Thirteen months ago: an enquiry that went nowhere, from a customer with nothing else.
    const lone = await job('Mr Lone', '+447700900401');
    // One customer's enquiry, though they have a later job.
    const twoJobs = await job('Mrs Two', '+447700900402');
    // A job with a visit, and an urgent one: both real jobs, kept.
    const visited = await job('Mr Visited', '+447700900403');
    await createVisit(db, firm, { job: visited.job ?? ('' as JobId), startsAt: instant(thirteenMonthsAgo + DAY), kind: 'quote_visit' });
    const urgent = await call({ kind: 'new_customer', name: 'Mr Urgent', mobile: ukMobile('+447700900404'), landline: null, noText: null, about: 'A leak', place: '2 Mill Lane' }, '+447700900404', 'a leak');
    // A call with no job, and a text from a number that is not a customer's.
    const missing = await call({ kind: 'details_missing' }, '+447700900405');
    await recordTextIn(db, firm, { provider: 'fake', providerId: `sweep-in-${firm}`, from: '+447700900406', words: 'Who is this?', consent: null });
    // What the owner wrote, a held time, a link, a login link and a login, and the staff log.
    await recordOwnerMessage(db, firm, owner.id, 'Old words.');
    const hold = await holdTime(db, firm, { provider: 'vapi', providerCallId: `sweep-hold-${firm}`, kind: 'quote_visit', startsAt: instant(thirteenMonthsAgo + 2 * DAY), endsAt: instant(thirteenMonthsAgo + 2 * DAY + 3_600_000) });
    expect(hold).not.toBeNull();

    // Eleven months ago: another call with no job, and Mrs Two's later job.
    clock.set(elevenMonthsAgo);
    const recent = await call({ kind: 'details_missing' }, '+447700900407');
    const [mrsTwo] = (await listCustomers(db, firm)).filter((one) => one.name === 'Mrs Two');
    const later = await call({ kind: 'customer', customer: mrsTwo?.id ?? ('' as never), about: 'Another radiator', place: '1 Mill Lane' }, '+447700900402');

    // A month ago: a link and a login link that expired, a login that has
    // not been used since (so ended after 30 days), and an export.
    clock.set(instant(START - 32 * DAY));
    const due = await addDue(db, firm, { action: 'send_confirmation', runAt: clock.now(), latestAt: clock.now() });
    await linkForDue(db, firm, { due, customer: mrsTwo?.id ?? ('' as never), job: later.job ?? ('' as JobId) });
    const { token } = await createLoginLink(db, firm, { owner: owner.id, job: null });
    expect(await logInWithLink(db, token)).not.toBeNull();
    await askFirmExport(db, firm, staff);
    expect(await makeFirmExport(db, firm)).toBe('made');
    // A staff log row from seven years ago.
    clock.set(instantFromIso('2019-06-01T10:00:00Z'));
    const ancient = await logStaff(db, firm, staff, 'viewed_firm');
    clock.set(START);
    const fresh = await logStaff(db, firm, staff, 'viewed_firm');
    // Outside the sweep, the database refuses to delete any of it.
    await expect(tryToDeleteStaffLog(env.DB, ancient)).rejects.toThrow(/never deleted/);

    const swept = await sweepFirm(db, firm);
    expect(swept.more).toBe(false);
    const rows = await firmRows(env.DB, firm);
    const names = (await listCustomers(db, firm)).map((one) => one.name).sort();
    // Mr Lone's enquiry went, and he with it. Mrs Two's old enquiry went,
    // and she stays with her later job. A job with a visit, and an urgent
    // one, are jobs, and stay.
    expect(names).toEqual(['Mr Urgent', 'Mr Visited', 'Mrs Two']);
    expect(await getCustomer(db, firm, lone.customer ?? ('' as never))).toBeNull();
    expect(await getJob(db, firm, twoJobs.job ?? ('' as JobId))).toBeNull();
    expect((await listJobsForCustomer(db, firm, mrsTwo?.id ?? ('' as never))).map((one) => one.id)).toEqual([later.job]);
    expect(await getJob(db, firm, visited.job ?? ('' as JobId))).not.toBeNull();
    expect(await getJob(db, firm, urgent.job ?? ('' as JobId))).not.toBeNull();
    // Their history went with them.
    expect((rows.history as { job_id: string | null }[]).map((row) => row.job_id)).not.toContain(twoJobs.job);
    // The call with no job from thirteen months ago went; the one from eleven stays.
    expect(await getCall(db, firm, missing.call)).toBeNull();
    expect(await getCall(db, firm, recent.call)).not.toBeNull();
    // And everything else past its period.
    expect(rows.texts_in).toEqual([]);
    expect(rows.owner_messages).toEqual([]);
    expect(rows.holds).toEqual([]);
    expect(rows.links).toEqual([]);
    expect(rows.login_links).toEqual([]);
    expect(rows.sessions).toEqual([]);
    expect(rows.firm_exports).toEqual([]);
    expect(await namesIn(files.kept, `firms/${firm}/exports/`)).toEqual([]);
    const log = await staffLogRows(env.DB);
    expect(log.map((row) => row.id)).not.toContain(ancient);
    expect(log.map((row) => row.id)).toContain(fresh);
  });

  it('runs on the demo firm’s own clock: moved 13 months on, its enquiries go, and another firm’s of the same shape stay', async () => {
    clock.set(START);
    const demo = await loadExample(env.DB, { name: 'Tidewell Heating', isExample: true, number: '07700 900143' });
    const same = await loadExample(env.DB, { name: 'Same Shape Firm', isExample: false, number: '07700 900144' });
    const before = (await listCustomers(db, demo)).length;
    // Each firm's sweep, waiting for 3:15am tomorrow on its own clock.
    await addMissingSweeps(db);
    const staff = (await findOrAddStaff(db, 'staff@example.com')).id;
    await setExampleClock(db, demo, instant(START + 400 * DAY), staff, 'move_on');
    await minute();
    expect((await listCustomers(db, demo)).length).toBeLessThan(before);
    expect(await listCustomers(db, same)).toHaveLength(before);
  });

  it('deletes at most so many enquiries a run, and runs again soon for the rest', async () => {
    const longAgo = instantFromIso('2025-01-10T10:00:00Z');
    clock.set(longAgo);
    const firm = await tidewell(db, '07700 900142');
    for (let at = 0; at <= SWEEP_LIMIT; at += 1) {
      await recordCall(db, firm, {
        provider: 'vapi',
        providerCallId: `cap-${firm}-${String(at)}`,
        startedAt: longAgo,
        endedAt: null,
        from: null,
        for: { kind: 'details_missing' },
        urgentItem: null,
        summary: null,
        transcript: null,
      });
    }
    clock.set(START);
    await addMissingSweeps(db);
    const [sweep] = await dueRowsFor(env.DB, firm, 'sweep');
    clock.set(instantFromIso('2026-10-16T03:15:00+01:00'));
    expect(await runDue(db, deps, firm, String(sweep?.id) as never)).toEqual({ ran: 'held' });
    expect((await firmRows(env.DB, firm)).calls).toHaveLength(1);
    clock.set(instantFromIso('2026-10-16T03:25:00+01:00'));
    expect(await runDue(db, deps, firm, String(sweep?.id) as never)).toEqual({ ran: 'done', outcome: 'swept' });
    expect((await firmRows(env.DB, firm)).calls).toEqual([]);
  });
});

describe('a customer’s delete, with their recording', () => {
  it('stopped after the database step and before the files are deleted, leaves the bin naming them, and the next run empties it', async () => {
    clock.set(START);
    const firm = await tidewell(db, '07700 900150');
    const { call } = await ring(firm, '+447700900150');
    await minute();
    const kept = `firms/${firm}/calls/${call}.mp3`;
    const customer = (await getCall(db, firm, call))?.customer;
    if (customer == null) throw new Error('No customer');
    const staff = (await findOrAddStaff(db, 'staff@example.com')).id;
    const broken = openRecord(env.DB, clock, { kept: failingOn(files.kept, 'delete'), inbox: files.inbox });
    await expect(deleteCustomer(broken, firm, customer.id, staff, customer.name)).rejects.toThrow('Broken on purpose');
    // The customer is gone from the record; the bin names her file, which is still there.
    expect(await getCustomer(db, firm, customer.id)).toBeNull();
    expect((await firmRows(env.DB, firm)).files_to_delete).toMatchObject([{ bucket: 'kept', key: kept }]);
    expect(await namesIn(files.kept, `firms/${firm}/`)).toEqual([kept]);
    // The next run (here the delete page's; otherwise the daily sweep) empties it.
    expect(await emptyBin(db, firm)).toBe(1);
    expect(await namesIn(files.kept, `firms/${firm}/`)).toEqual([]);
    expect((await firmRows(env.DB, firm)).files_to_delete).toEqual([]);
    expect(await emptyBin(db, firm)).toBe(0);
  });
});

describe('after a restore', () => {
  it('does again every customer delete noted since the restore point, and marks calls whose recording is gone', async () => {
    // Two days on from the other tests' deletes, so the restore point comes after them.
    const RESTORED = instant(START + 2 * DAY);
    clock.set(RESTORED);
    const firm = await tidewell(db, '07700 900160');
    const first = await ring(firm, '+447700900160');
    const second = await ring(firm, '+447700900160', { fixture: 'supplier' });
    await minute();
    const customer = (await getCall(db, firm, first.call))?.customer;
    if (customer == null) throw new Error('No customer');
    const restorePoint = clock.now();
    const snapshot = await firmRows(env.DB, firm);

    // After the restore point: staff delete her, and the clock deletes the other recording.
    clock.set(instant(RESTORED + 60_000));
    const staff = (await findOrAddStaff(db, 'staff@example.com')).id;
    expect(await deleteCustomer(db, firm, customer.id, staff, customer.name)).not.toBeNull();
    expect(await deleteRecording(db, firm, second.call)).toBe('deleted');
    expect(await ledgerSince(db, restorePoint)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'customer', firm, customer: customer.id })]));

    // The database goes back to the restore point; the file store does not.
    await putBackAsARestore(env.DB, snapshot);
    expect(await getCustomer(db, firm, customer.id)).not.toBeNull();
    expect((await getCallRecording(db, firm, second.call))?.state).toBe('kept');

    const open = controlOpener(createApp(() => deps));
    const typed = '2026-10-17T08:10';
    const page = await open(`/control/after-restore?since=${typed}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('1 deletes noted since then.');
    const done = await open('/control/after-restore', controlForm({ since: typed }));
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('Done again: 1 customers and 0 firms deleted; 1 calls marked as having lost their recording.');

    expect(await getCustomer(db, firm, customer.id)).toBeNull();
    expect(await getCallRecording(db, firm, second.call)).toMatchObject({ state: 'deleted' });
    expect((await staffLogRows(env.DB)).slice(-3)).toEqual(
      expect.arrayContaining([expect.objectContaining({ what: 'replayed_deletions', firm_id: firm, customer_id: customer.id })]),
    );
    // Done again, it notes nothing new.
    expect(await ledgerSince(db, restorePoint)).toHaveLength(1);
  });
});

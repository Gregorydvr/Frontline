// The control room (slice G of docs/build-brief.md): the screens Front-line's
// own staff use. Every request:
// - must come to the control room's own address (CONTROL_ADDRESS), or it is
//   "not found": the owner's and customers' addresses never serve it
// - must carry a member of staff the gate vouches for: Cloudflare Access's
//   signed note on practice and live, a stand-in on this machine. Otherwise
//   it is refused, and with no gate set up, the room is shut
// - for a form, must be posted from the control room's own pages
// - is written to the staff log: every view and every action (rule 15)
//
// Staff read across every firm, but one firm at a time: the firm is in the
// address, and every record function is given it, so another firm's
// customer under this firm's address is "not found" (rule 8).
//
// The demo firm's clock and its reset are only on this machine and practice.
// On live (and when the copy's setting is missing) their addresses are "not
// found" and their buttons are not drawn.

import type { Context, Hono } from 'hono';
import type { AppEnv } from './app';
import { instant, instantFromIso, type Instant } from './clock';
import { everyMinute } from './due';
import { loadExample } from './example/load';
import { EXAMPLE_NOW } from './example/tidewell';
import { historyLine } from './history-lines';
import { isId } from './ids';
import { londonDayAround, londonInstant } from './london';
import { log } from './log';
import {
  askFirmExport,
  cancelLeaving,
  customerFile,
  customerFileCounts,
  deleteCustomer,
  deleteExampleFirm,
  deleteFirm,
  downloadFirmExport,
  ledgerSince,
  listFirmExports,
  logStaffAcrossFirms,
  markLeaving,
  markMissingRecordings,
  readCallRecording,
  redoCustomerDelete,
  redoFirmDelete,
  exampleFirms,
  findCustomers,
  findOrAddStaff,
  firmWording,
  getCustomer,
  getFirm,
  historyForCustomer,
  listCallsBetween,
  listFailedTexts,
  listFirms,
  listJobsForCustomer,
  listOwnerMessages,
  listTextsInBetween,
  logStaff,
  needsALook,
  setExampleClock,
  setService,
  setStopButton,
} from './record';
import { openRecord, Refused, withFirmClock, type RecordDb } from './record/db';
import { SERVICES, type CallId, type CustomerId, type Firm, type FirmExportId, type FirmId, type Service, type StaffId } from './record/types';
import {
  afterRestoreScreen,
  CONTROL_HEADERS,
  CONTROL_WORDS,
  controlPage,
  customerScreen,
  deletedScreen,
  deleteScreen,
  findScreen,
  firmDeletedScreen,
  firmDeleteScreen,
  firmScreen,
  firmsScreen,
  leavingScreen,
  messageScreen,
  resetScreen,
  type FirmLine,
} from './screens/control';
import { zipInMemory } from './zip';
import type { Html } from './screens/html';

/** How far back a firm's page looks for failed texts, texts in and what needs a look. */
const WEEK = 7 * 24 * 60 * 60_000;
/** The longest form the control room takes. */
const FORM_LIMIT = 1_024;

/** The member of staff looking, with the record as the system reads the time. */
interface Looking {
  db: RecordDb;
  staff: StaffId;
}

/** The firm being looked at, with the record as that firm reads the time. */
interface AtFirm extends Looking {
  firm: Firm;
  firmDb: RecordDb;
}

export function controlRoutes(app: Hono<AppEnv>): void {
  app.get('/control', (c) =>
    asStaff(c, 'view', async (who) => {
      const firms = await listFirms(who.db, who.staff);
      const lines: FirmLine[] = [];
      for (const firm of firms) {
        const db = withFirmClock(who.db, firm);
        const now = db.clock.now();
        const today = londonDayAround(now);
        lines.push({
          firm,
          callsToday: (await listCallsBetween(db, firm.id, today.from, today.to)).length,
          failedThisWeek: (await listFailedTexts(db, firm.id, instant(now - WEEK))).length,
          textsInToday: (await listTextsInBetween(db, firm.id, today.from, today.to)).length,
          unread: (await listOwnerMessages(db, firm.id)).filter((message) => message.unread).length,
        });
      }
      const canLoad = practiceTools(c) && (await exampleFirms(who.db)).length === 0;
      return drawn(c, CONTROL_WORDS.firms, firmsScreen(lines, canLoad));
    }),
  );

  // Practice and this machine only: load the demo firm when there is none.
  app.post('/control/example', (c) =>
    asStaff(c, 'form', async (who) => {
      if (!practiceTools(c)) return c.notFound();
      const [already] = await exampleFirms(who.db);
      const firm = already ?? (await loadExample(c.env.DB));
      if (already === undefined) {
        await setExampleClock(who.db, firm, instantFromIso(EXAMPLE_NOW), who.staff, 'start');
        log('example_loaded', { firm, staff: who.staff });
      }
      return c.redirect(`/control/firms/${firm}`, 303);
    }),
  );

  app.get('/control/firms/:firm', (c) =>
    atFirm(c, 'view', async (at) => {
      const now = at.firmDb.clock.now();
      const today = londonDayAround(now);
      const since = instant(now - WEEK);
      const view = {
        firm: at.firm,
        now,
        calls: await listCallsBetween(at.firmDb, at.firm.id, today.from, today.to),
        failed: await listFailedTexts(at.firmDb, at.firm.id, since),
        textsIn: (await listTextsInBetween(at.firmDb, at.firm.id, since, instant(now + 1))).reverse(),
        // Read before this view is logged, so what was unread shows as such.
        ownerMessages: await listOwnerMessages(at.firmDb, at.firm.id),
        look: await needsALook(at.firmDb, at.firm.id, since),
        exampleTools: at.firm.isExample && practiceTools(c),
        exports: await listFirmExports(at.firmDb, at.firm.id),
      };
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_firm');
      return drawn(c, at.firm.name, firmScreen(view));
    }),
  );

  app.post('/control/firms/:firm/service', (c) =>
    atFirm(c, 'form', async (at) => {
      const form = await readForm(c.req.raw);
      const service = form.get('service') as Service | null;
      const on = form.get('on');
      if (service === null || !SERVICES.includes(service) || (on !== '1' && on !== '0')) {
        return c.body(null, 400);
      }
      await setService(at.firmDb, at.firm.id, service, on === '1', { kind: 'staff', staff: at.staff });
      await logStaff(at.firmDb, at.firm.id, at.staff, on === '1' ? 'service_on' : 'service_off', { service });
      log('staff_changed_firm', { firm: at.firm.id, staff: at.staff });
      return c.redirect(`/control/firms/${at.firm.id}`, 303);
    }),
  );

  app.post('/control/firms/:firm/stop', (c) =>
    atFirm(c, 'form', async (at) => {
      const on = (await readForm(c.req.raw)).get('on');
      if (on !== '1' && on !== '0') {
        return c.body(null, 400);
      }
      await setStopButton(at.firmDb, at.firm.id, on === '1', { kind: 'staff', staff: at.staff });
      await logStaff(at.firmDb, at.firm.id, at.staff, on === '1' ? 'stop_on' : 'stop_off');
      log('staff_changed_firm', { firm: at.firm.id, staff: at.staff });
      return c.redirect(`/control/firms/${at.firm.id}`, 303);
    }),
  );

  app.get('/control/firms/:firm/customers', (c) =>
    atFirm(c, 'view', async (at) => {
      const typed = (c.req.query('q') ?? '').slice(0, 60);
      const found = await findCustomers(at.firmDb, at.firm.id, typed);
      await logStaff(at.firmDb, at.firm.id, at.staff, 'searched_customers');
      return drawn(c, CONTROL_WORDS.findCustomer, findScreen(at.firm, typed, found));
    }),
  );

  app.get('/control/firms/:firm/customers/:customer', (c) =>
    atCustomer(c, 'view', async (at, customer) => {
      const found = await getCustomer(at.firmDb, at.firm.id, customer);
      const counts = await customerFileCounts(at.firmDb, at.firm.id, customer);
      if (found === null || counts === null) return notFound(c);
      const jobs = await listJobsForCustomer(at.firmDb, at.firm.id, customer);
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_customer', { customer });
      return drawn(c, found.name, customerScreen(at.firm, found, jobs, counts.counts));
    }),
  );

  // The export: a zip of everything held about the customer, with their
  // recordings, to the browser of the member of staff who asked. Front-line
  // keeps no copy.
  app.post('/control/firms/:firm/customers/:customer/export', (c) =>
    atCustomer(c, 'form', async (at, customer) => {
      const file = await customerFile(at.firmDb, at.firm.id, customer);
      if (file === null) return notFound(c);
      const wording = await firmWording(at.firmDb, at.firm.id);
      const lines = (await historyForCustomer(at.firmDb, at.firm.id, customer)).map((entry) => ({
        at: new Date(entry.at).toISOString(),
        line: historyLine(entry, 'job', wording) ?? historyLine(entry, 'feed', wording),
      }));
      const kept = (file.tables.calls ?? []).filter((row) => row.recording_state === 'kept').map((row) => String(row.id) as CallId);
      await logStaff(at.firmDb, at.firm.id, at.staff, 'exported_customer', { customer });
      const zip = await zipInMemory(at.firmDb.clock.now(), async (writer) => {
        const missing: CallId[] = [];
        for (const call of kept) {
          const recording = await readCallRecording(at.firmDb, at.firm.id, call);
          if (recording === null) missing.push(call);
          else await writer.stream(`recordings/${call}${recordingEnding(recording.key)}`, recording.body);
        }
        await writer.text('customer.json', JSON.stringify({ ...file, historyAsTheOwnerReadsIt: lines, recordingsMissing: missing }, null, 2));
      });
      log('customer_exported', { firm: at.firm.id, customer, staff: at.staff });
      return c.body(zip, 200, {
        ...CONTROL_HEADERS,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="frontline-export-${at.firm.id}-${customer}.zip"`,
      });
    }),
  );

  app.get('/control/firms/:firm/customers/:customer/delete', (c) =>
    atCustomer(c, 'view', async (at, customer) => {
      const shown = await deletePage(at, customer, false);
      if (shown === null) return notFound(c);
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_delete', { customer });
      return drawn(c, CONTROL_WORDS.delete, shown);
    }),
  );

  // Pressed twice, or for a customer not this firm's, it finds nothing,
  // deletes nothing, and says so.
  app.post('/control/firms/:firm/customers/:customer/delete', (c) =>
    atFirm(c, 'form', async (at) => {
      const asked = c.req.param('customer');
      if (!isId(asked)) return notFound(c);
      const customer = asked as CustomerId;
      const typed = ((await readForm(c.req.raw)).get('name') ?? '').slice(0, 60);
      let deleted;
      try {
        deleted = await deleteCustomer(at.firmDb, at.firm.id, customer, at.staff, typed);
      } catch (thrown) {
        if (!(thrown instanceof Refused)) throw thrown;
        // Not their name as held: nothing was deleted.
        const shown = await deletePage(at, customer, true);
        return shown === null ? notFound(c) : drawn(c, CONTROL_WORDS.delete, shown, 400);
      }
      if (deleted !== null) {
        log('customer_deleted', { firm: at.firm.id, customer, staff: at.staff });
      }
      return drawn(c, CONTROL_WORDS.deletedTitle, deletedScreen(at.firm, deleted?.removed ?? null));
    }),
  );

  // The firm's records: an export made by a row in the due list, and
  // downloading one once it is made.
  app.post('/control/firms/:firm/export', (c) =>
    atFirm(c, 'form', async (at) => {
      await askFirmExport(at.firmDb, at.firm.id, at.staff);
      log('firm_export_asked', { firm: at.firm.id, staff: at.staff });
      return c.redirect(`/control/firms/${at.firm.id}`, 303);
    }),
  );

  app.get('/control/firms/:firm/export/:export', (c) =>
    atFirm(c, 'view', async (at) => {
      const id = c.req.param('export');
      const file = isId(id) ? await downloadFirmExport(at.firmDb, at.firm.id, id as FirmExportId, at.staff) : null;
      if (file === null) return notFound(c);
      log('firm_export_downloaded', { firm: at.firm.id, staff: at.staff });
      return c.body(file.body, 200, {
        ...CONTROL_HEADERS,
        'Content-Type': 'application/zip',
        'Content-Length': String(file.size),
        'Content-Disposition': `attachment; filename="frontline-firm-export-${at.firm.id}-${id}.zip"`,
      });
    }),
  );

  // A firm leaving: its name typed to go on.
  app.get('/control/firms/:firm/leaving', (c) =>
    atFirm(c, 'view', async (at) => {
      if (at.firm.leaving !== null) return c.redirect(`/control/firms/${at.firm.id}`, 303);
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_leaving');
      return drawn(c, CONTROL_WORDS.markLeaving, leavingScreen(at.firm, false));
    }),
  );

  app.post('/control/firms/:firm/leaving', (c) =>
    atFirm(c, 'form', async (at) => {
      const typed = ((await readForm(c.req.raw)).get('name') ?? '').slice(0, 120);
      try {
        await markLeaving(at.firmDb, at.firm.id, at.staff, typed);
      } catch (thrown) {
        if (!(thrown instanceof Refused)) throw thrown;
        // Not its name as held, or already leaving: nothing changed.
        return at.firm.leaving === null
          ? drawn(c, CONTROL_WORDS.markLeaving, leavingScreen(at.firm, true), 400)
          : c.redirect(`/control/firms/${at.firm.id}`, 303);
      }
      log('firm_leaving', { firm: at.firm.id, staff: at.staff });
      return c.redirect(`/control/firms/${at.firm.id}`, 303);
    }),
  );

  app.post('/control/firms/:firm/leaving/cancel', (c) =>
    atFirm(c, 'form', async (at) => {
      try {
        await cancelLeaving(at.firmDb, at.firm.id, at.staff);
        log('firm_leaving_cancelled', { firm: at.firm.id, staff: at.staff });
      } catch (thrown) {
        if (!(thrown instanceof Refused)) throw thrown;
      }
      return c.redirect(`/control/firms/${at.firm.id}`, 303);
    }),
  );

  // Deleting a leaving firm before its 30 days are up, once its export is made.
  app.get('/control/firms/:firm/delete', (c) =>
    atFirm(c, 'view', async (at) => {
      if (at.firm.leaving === null) return c.redirect(`/control/firms/${at.firm.id}`, 303);
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_firm_delete');
      return drawn(c, CONTROL_WORDS.deleteFirm, firmDeleteScreen(at.firm, await exportMade(at), false));
    }),
  );

  app.post('/control/firms/:firm/delete', (c) =>
    atFirm(c, 'form', async (at) => {
      const typed = ((await readForm(c.req.raw)).get('name') ?? '').slice(0, 120);
      try {
        await deleteFirm(at.firmDb, at.firm.id, at.staff, typed);
      } catch (thrown) {
        if (!(thrown instanceof Refused)) throw thrown;
        if (at.firm.leaving === null) return c.redirect(`/control/firms/${at.firm.id}`, 303);
        return drawn(c, CONTROL_WORDS.deleteFirm, firmDeleteScreen(at.firm, await exportMade(at), true), 400);
      }
      log('firm_deleted', { firm: at.firm.id, staff: at.staff });
      return drawn(c, CONTROL_WORDS.firmDeletedTitle, firmDeletedScreen());
    }),
  );

  // After the database is restored to an earlier point: every customer and
  // firm deleted since then is deleted again (docs/restore.md).
  app.get('/control/after-restore', (c) =>
    asStaff(c, 'view', async (who) => {
      await logStaffAcrossFirms(who.db, who.staff, 'viewed_after_restore');
      const typed = (c.req.query('since') ?? '').slice(0, 20);
      const since = ukTime(typed);
      const count = since === null ? null : (await ledgerSince(who.db, since)).length;
      return drawn(c, CONTROL_WORDS.afterRestore, afterRestoreScreen({ typed, since: count, done: null }));
    }),
  );

  app.post('/control/after-restore', (c) =>
    asStaff(c, 'form', async (who) => {
      const typed = ((await readForm(c.req.raw)).get('since') ?? '').slice(0, 20);
      const since = ukTime(typed);
      if (since === null) return c.redirect('/control/after-restore', 303);
      const done = await replayDeletions(who, since);
      log('deletions_replayed', { staff: who.staff, ...done });
      return drawn(c, CONTROL_WORDS.afterRestore, afterRestoreScreen({ typed, since: null, done }));
    }),
  );

  // Practice and this machine only, for an example firm: move its clock on,
  // then put whatever has come due on the queue at once.
  app.post('/control/firms/:firm/clock', (c) =>
    atFirm(c, 'form', async (at) => {
      if (!practiceTools(c) || !at.firm.isExample) return c.notFound();
      const form = await readForm(c.req.raw);
      const now = at.firmDb.clock.now();
      const by = form.get('by');
      const to = by === 'hour' ? instant(now + 60 * 60_000) : by === 'day' ? instant(now + 24 * 60 * 60_000) : ukTime(form.get('to'));
      if (to === null || to <= now) {
        return c.redirect(`/control/firms/${at.firm.id}`, 303);
      }
      await setExampleClock(at.db, at.firm.id, to, at.staff, 'move_on');
      log('example_clock_moved', { firm: at.firm.id, staff: at.staff });
      await everyMinute(c.env.DB, c.get('deps'));
      return c.redirect(`/control/firms/${at.firm.id}`, 303);
    }),
  );

  app.get('/control/firms/:firm/reset', (c) =>
    atFirm(c, 'view', (at) => {
      if (!practiceTools(c) || !at.firm.isExample) return Promise.resolve(c.notFound());
      return Promise.resolve(drawn(c, CONTROL_WORDS.reset, resetScreen(at.firm)));
    }),
  );

  app.post('/control/firms/:firm/reset', (c) =>
    atFirm(c, 'form', async (at) => {
      if (!practiceTools(c) || !at.firm.isExample) return c.notFound();
      await deleteExampleFirm(at.db, at.firm.id, at.staff);
      const firm = await loadExample(c.env.DB);
      await setExampleClock(at.db, firm, instantFromIso(EXAMPLE_NOW), at.staff, 'start');
      log('example_reset', { firm, staff: at.staff });
      return c.redirect(`/control/firms/${firm}`, 303);
    }),
  );
}

/** Whether this copy has the demo firm's tools: this machine and practice, never live. */
function practiceTools(c: Context<AppEnv>): boolean {
  const { copy } = c.get('deps');
  return copy === 'local' || copy === 'practice';
}

/**
 * Runs a control-room page for the member of staff the gate vouches for, at
 * the control room's own address, or refuses. A form must be posted from the
 * control room's own pages.
 */
async function asStaff(c: Context<AppEnv>, kind: 'view' | 'form', draw: (who: Looking) => Promise<Response>): Promise<Response> {
  const deps = c.get('deps');
  const address = deps.controlAddress;
  if (address === null || new URL(c.req.url).host !== new URL(address).host) {
    return c.notFound();
  }
  const email = await deps.staff.whoIs(c.req.raw, deps.clock.now());
  if (email === null) {
    log('staff_refused');
    return refused(c);
  }
  if (kind === 'form' && c.req.header('Origin') !== new URL(address).origin) {
    log('staff_request_refused');
    return refused(c);
  }
  const db = openRecord(c.env.DB, deps.clock, deps.files);
  const staff = await findOrAddStaff(db, email);
  return draw({ db, staff: staff.id });
}

/** A page about one firm, named in the address. A firm that is not there is "not found". */
function atFirm(c: Context<AppEnv>, kind: 'view' | 'form', draw: (at: AtFirm) => Promise<Response>): Promise<Response> {
  return asStaff(c, kind, async (who) => {
    const id = c.req.param('firm') ?? '';
    const firm = isId(id) ? await getFirm(who.db, id as FirmId) : null;
    if (firm === null) return notFound(c);
    return draw({ ...who, firm, firmDb: withFirmClock(who.db, firm) });
  });
}

/** A page about one of the firm's customers. Another firm's customer is "not found", as one that never was. */
function atCustomer(c: Context<AppEnv>, kind: 'view' | 'form', draw: (at: AtFirm, customer: CustomerId) => Promise<Response>): Promise<Response> {
  return atFirm(c, kind, async (at) => {
    const id = c.req.param('customer') ?? '';
    if (!isId(id) || (await getCustomer(at.firmDb, at.firm.id, id as CustomerId)) === null) return notFound(c);
    return draw(at, id as CustomerId);
  });
}

async function deletePage(at: AtFirm, customer: CustomerId, wrongName: boolean): Promise<Html | null> {
  const found = await getCustomer(at.firmDb, at.firm.id, customer);
  const counts = await customerFileCounts(at.firmDb, at.firm.id, customer);
  if (found === null || counts === null) return null;
  return deleteScreen({ firm: at.firm, customer: found, counts: counts.counts, othersOnTheirNumbers: counts.othersOnTheirNumbers, wrongName });
}

function drawn(c: Context<AppEnv>, title: string, screen: Html, status: 200 | 400 = 200): Response {
  return c.html(controlPage(title, screen), status, CONTROL_HEADERS);
}

function notFound(c: Context<AppEnv>): Response {
  return c.html(controlPage(CONTROL_WORDS.notFound, messageScreen(CONTROL_WORDS.notFound)), 404, CONTROL_HEADERS);
}

function refused(c: Context<AppEnv>): Response {
  return c.html(controlPage(CONTROL_WORDS.notAllowed, messageScreen(CONTROL_WORDS.notAllowed)), 403, CONTROL_HEADERS);
}

/** A form, read up to a size no control-room page sends past. */
async function readForm(request: Request): Promise<URLSearchParams> {
  const length = Number(request.headers.get('Content-Length') ?? '0');
  const body = Number.isFinite(length) && length <= FORM_LIMIT ? await request.text() : '';
  return new URLSearchParams(body.length > FORM_LIMIT ? '' : body);
}

/** A UK date and time as a browser's date-and-time field sends it, such as 2026-10-16T13:00, or null. */
function ukTime(typed: string | null): Instant | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(typed ?? '');
  if (parts === null) return null;
  const [, year, month, day, hour, minute] = parts.map(Number);
  try {
    return londonInstant(year ?? 0, month ?? 0, day ?? 0, hour ?? 0, minute ?? 0);
  } catch {
    return null;
  }
}

/** Whether one of the firm's exports is made. */
async function exportMade(at: AtFirm): Promise<boolean> {
  return (await listFirmExports(at.firmDb, at.firm.id)).some((made) => made.state === 'ready');
}

/** A recording's ending in an export, from the name it is kept under. */
function recordingEnding(key: string): string {
  const ending = /\.(mp3|wav)$/.exec(key)?.[1];
  return ending === undefined ? '' : `.${ending}`;
}

/**
 * Does again every delete the restore ledger noted since an instant, for
 * customers and firms the database holds again after a restore, then marks
 * every call whose recording file is gone. Each delete is recorded in the
 * staff log as done again, by the member of staff who asked.
 */
async function replayDeletions(who: Looking, since: Instant): Promise<{ customers: number; firms: number; recordings: number }> {
  const done = { customers: 0, firms: 0, recordings: 0 };
  for (const entry of await ledgerSince(who.db, since)) {
    const firm = await getFirm(who.db, entry.firm);
    if (firm === null) continue;
    const firmDb = withFirmClock(who.db, firm);
    if (entry.kind === 'customer') {
      if ((await redoCustomerDelete(firmDb, firm.id, entry.customer, who.staff)) !== null) done.customers += 1;
    } else if ((await redoFirmDelete(firmDb, firm.id, who.staff)) === 'deleted') {
      done.firms += 1;
    }
  }
  for (const firm of await listFirms(who.db, who.staff)) {
    done.recordings += await markMissingRecordings(withFirmClock(who.db, firm), firm.id);
  }
  return done;
}

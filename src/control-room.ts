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
import { DRAFT_WORDING, makeWords } from './messages';
import { segments } from './gsm';
import { callerNumber, nationalNumber } from './phone';
import {
  callsSetUpGaps,
  diaryRulesProblems,
  NAME_LIMITS,
  nameProblems,
  previewFacts,
  urgentListProblems,
  wordingProblems,
} from './set-up';
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
  createFirm,
  createOwner,
  getOwner,
  listOwners,
  listWording,
  setDiaryRules,
  setFirmNumber,
  setOwnerMobile,
  setUrgentList,
  setWording,
} from './record';
import { openRecord, Refused, withFirmClock, type RecordDb } from './record/db';
import {
  AGREED_HOW,
  MESSAGE_KINDS,
  SERVICES,
  VISIT_KINDS,
  type AgreedHow,
  type CallId,
  type CustomerId,
  type DiaryRules,
  type Firm,
  type FirmExportId,
  type FirmId,
  type MessageKind,
  type Owner,
  type OwnerId,
  type Service,
  type StaffId,
  type VisitKind,
  type WordingVersion,
} from './record/types';
import {
  addFirmScreen,
  afterRestoreScreen,
  CONTROL_HEADERS,
  diaryProblemWords,
  diaryScreen,
  minutesToTime,
  nameProblemWords,
  numberScreen,
  ownerMobileScreen,
  ownerScreen,
  urgentProblemWords,
  urgentScreen,
  wordingListScreen,
  wordingProblemWords,
  wordingScreen,
  type DiaryForm,
  type WordingView,
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
/**
 * The longest form for an urgent list, and for wording: 1,000 characters of
 * words, each up to 9 bytes once a browser has encoded it, such as a curly
 * apostrophe the check must still see to refuse.
 */
const LONG_FORM_LIMIT = 12 * 1_024;

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
        setUp: await setUpOf(at),
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

  // Setting up a firm (slice H2). Each change is recorded in the firm's
  // history, done by staff, and in the staff log, in the same step as the
  // change itself. Each view is in the staff log.
  app.get('/control/add-firm', (c) =>
    asStaff(c, 'view', async (who) => {
      await logStaffAcrossFirms(who.db, who.staff, 'viewed_add_firm');
      return drawn(c, CONTROL_WORDS.addFirm, addFirmScreen('', []));
    }),
  );

  app.post('/control/add-firm', (c) =>
    asStaff(c, 'form', async (who) => {
      const name = ((await readForm(c.req.raw)).get('name') ?? '').trim().slice(0, 200);
      const problems = nameProblems(name, NAME_LIMITS.firm);
      if (problems.length > 0) {
        await logStaffAcrossFirms(who.db, who.staff, 'viewed_add_firm');
        return drawn(c, CONTROL_WORDS.addFirm, addFirmScreen(name, nameProblemWords(problems)), 400);
      }
      const firm = await createFirm(who.db, { name, isExample: false }, { kind: 'staff', staff: who.staff });
      log('firm_added', { firm, staff: who.staff });
      return c.redirect(`/control/firms/${firm}`, 303);
    }),
  );

  app.get('/control/firms/:firm/owner', (c) =>
    atFirm(c, 'view', async (at) => {
      if ((await listOwners(at.firmDb, at.firm.id)).length > 0) return c.redirect(`/control/firms/${at.firm.id}`, 303);
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_set_up_owner');
      return drawn(c, CONTROL_WORDS.addOwner, ownerScreen(at.firm, { name: '', mobile: '' }, []));
    }),
  );

  // One owner from the control room: a firm that has one is sent back to its page.
  app.post('/control/firms/:firm/owner', (c) =>
    atFirm(c, 'form', async (at) => {
      if ((await listOwners(at.firmDb, at.firm.id)).length > 0) return c.redirect(`/control/firms/${at.firm.id}`, 303);
      const form = await readForm(c.req.raw);
      const typed = { name: (form.get('name') ?? '').trim().slice(0, 100), mobile: (form.get('mobile') ?? '').slice(0, 30) };
      const mobile = callerNumber(typed.mobile);
      const problems = nameProblemWords(nameProblems(typed.name, NAME_LIMITS.owner));
      if (mobile.kind !== 'mobile') problems.push(CONTROL_WORDS.notAMobile);
      else if (mobile.number === at.firm.phoneNumber) problems.push(CONTROL_WORDS.mobileIsFirmsNumber);
      if (problems.length > 0 || mobile.kind !== 'mobile') {
        await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_set_up_owner');
        return drawn(c, CONTROL_WORDS.addOwner, ownerScreen(at.firm, typed, problems), 400);
      }
      await createOwner(at.firmDb, at.firm.id, { name: typed.name, mobile: mobile.number }, { kind: 'staff', staff: at.staff });
      log('firm_set_up_changed', { firm: at.firm.id, staff: at.staff });
      return c.redirect(`/control/firms/${at.firm.id}`, 303);
    }),
  );

  app.get('/control/firms/:firm/owners/:owner/mobile', (c) =>
    atOwner(c, 'view', async (at, owner) => {
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_set_up_owner', { owner: owner.id });
      return drawn(c, CONTROL_WORDS.changeMobile, ownerMobileScreen(at.firm, owner, '', []));
    }),
  );

  app.post('/control/firms/:firm/owners/:owner/mobile', (c) =>
    atOwner(c, 'form', async (at, owner) => {
      const typed = ((await readForm(c.req.raw)).get('mobile') ?? '').slice(0, 30);
      const mobile = callerNumber(typed);
      const problem =
        mobile.kind !== 'mobile' ? CONTROL_WORDS.notAMobile : mobile.number === at.firm.phoneNumber ? CONTROL_WORDS.mobileIsFirmsNumber : null;
      if (problem !== null || mobile.kind !== 'mobile') {
        await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_set_up_owner', { owner: owner.id });
        return drawn(c, CONTROL_WORDS.changeMobile, ownerMobileScreen(at.firm, owner, typed, problem === null ? [] : [problem]), 400);
      }
      await setOwnerMobile(at.firmDb, at.firm.id, owner.id, mobile.number, { kind: 'staff', staff: at.staff });
      log('firm_set_up_changed', { firm: at.firm.id, staff: at.staff });
      return c.redirect(`/control/firms/${at.firm.id}`, 303);
    }),
  );

  app.get('/control/firms/:firm/number', (c) =>
    atFirm(c, 'view', async (at) => {
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_set_up_number');
      const typed = at.firm.phoneNumber === null ? '' : nationalNumber(at.firm.phoneNumber);
      return drawn(c, CONTROL_WORDS.number, numberScreen(at.firm, typed, []));
    }),
  );

  app.post('/control/firms/:firm/number', (c) =>
    atFirm(c, 'form', async (at) => {
      const typed = ((await readForm(c.req.raw)).get('number') ?? '').slice(0, 30);
      const number = callerNumber(typed);
      const done = number.kind === 'mobile' ? await setFirmNumber(at.firmDb, at.firm.id, number.number, { kind: 'staff', staff: at.staff }) : 'not_mobile';
      if (done !== 'set') {
        await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_set_up_number');
        return drawn(c, CONTROL_WORDS.number, numberScreen(at.firm, typed, [CONTROL_WORDS.numberProblems[done]]), 400);
      }
      log('firm_set_up_changed', { firm: at.firm.id, staff: at.staff });
      return c.redirect(`/control/firms/${at.firm.id}`, 303);
    }),
  );

  app.get('/control/firms/:firm/urgent', (c) =>
    atFirm(c, 'view', async (at) => {
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_set_up_urgent');
      return drawn(c, CONTROL_WORDS.urgent, urgentScreen(at.firm, at.firm.urgentList.join('\n'), []));
    }),
  );

  app.post('/control/firms/:firm/urgent', (c) =>
    atFirm(c, 'form', async (at) => {
      const typed = ((await readForm(c.req.raw, LONG_FORM_LIMIT)).get('items') ?? '').replace(/\r\n?/g, '\n');
      const items = typed
        .split('\n')
        .map((item) => item.trim())
        .filter((item) => item !== '');
      const problems = urgentListProblems(items);
      if (problems.length > 0) {
        await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_set_up_urgent');
        return drawn(c, CONTROL_WORDS.urgent, urgentScreen(at.firm, typed, urgentProblemWords(problems)), 400);
      }
      await setUrgentList(at.firmDb, at.firm.id, items, { kind: 'staff', staff: at.staff });
      log('firm_set_up_changed', { firm: at.firm.id, staff: at.staff });
      return c.redirect(`/control/firms/${at.firm.id}`, 303);
    }),
  );

  app.get('/control/firms/:firm/diary', (c) =>
    atFirm(c, 'view', async (at) => {
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_set_up_diary');
      return drawn(c, CONTROL_WORDS.diary, diaryScreen(at.firm, diaryFormOf(at.firm.diaryRules), []));
    }),
  );

  app.post('/control/firms/:firm/diary', (c) =>
    atFirm(c, 'form', async (at) => {
      const form = await readForm(c.req.raw);
      const typed = diaryFormFrom(form);
      const rules = diaryRulesFrom(typed);
      const problems = diaryRulesProblems(rules);
      if (problems.length > 0) {
        await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_set_up_diary');
        return drawn(c, CONTROL_WORDS.diary, diaryScreen(at.firm, typed, diaryProblemWords(problems)), 400);
      }
      await setDiaryRules(at.firmDb, at.firm.id, rules, { kind: 'staff', staff: at.staff });
      log('firm_set_up_changed', { firm: at.firm.id, staff: at.staff });
      return c.redirect(`/control/firms/${at.firm.id}`, 303);
    }),
  );

  app.get('/control/firms/:firm/wording', (c) =>
    atFirm(c, 'view', async (at) => {
      const current: Partial<Record<MessageKind, WordingVersion>> = {};
      for (const kind of Object.keys(MESSAGE_KINDS) as MessageKind[]) {
        const [newest] = await listWording(at.firmDb, at.firm.id, `text:${kind}`);
        if (newest !== undefined) current[kind] = newest;
      }
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_wording');
      return drawn(c, CONTROL_WORDS.wording, wordingListScreen(at.firm, current));
    }),
  );

  app.get('/control/firms/:firm/wording/:kind', (c) =>
    atKind(c, 'view', async (at, kind) => {
      const versions = await listWording(at.firmDb, at.firm.id, `text:${kind}`);
      const words = versions[0]?.words ?? DRAFT_WORDING[kind] ?? '';
      await logStaff(at.firmDb, at.firm.id, at.staff, 'viewed_wording', { messageKind: kind });
      return drawn(c, CONTROL_WORDS.textKinds[kind], wordingScreen(await wordingView(c, at, kind, words, versions, null, { owner: '', how: '' })));
    }),
  );

  // Check shows what is wrong, or the text as a customer or the owner would
  // get it, and saves nothing. Save as agreed saves the words, as the owner
  // agreed them, only once they pass the check and staff tick that the owner
  // agreed these exact words.
  app.post('/control/firms/:firm/wording/:kind', (c) =>
    atKind(c, 'form', async (at, kind) => {
      const form = await readForm(c.req.raw, LONG_FORM_LIMIT);
      const words = (form.get('words') ?? '').replace(/\r\n?/g, '\n');
      const chosen = { owner: form.get('owner') ?? '', how: form.get('how') ?? '' };
      const problems = wordingProblemWords(wordingProblems(`text:${kind}`, words));
      const versions = await listWording(at.firmDb, at.firm.id, `text:${kind}`);
      if (form.get('intent') !== 'save') {
        await logStaff(at.firmDb, at.firm.id, at.staff, 'checked_wording', { messageKind: kind });
        return drawn(c, CONTROL_WORDS.textKinds[kind], wordingScreen(await wordingView(c, at, kind, words, versions, problems, chosen)));
      }
      const owner = isId(chosen.owner) ? await getOwner(at.firmDb, at.firm.id, chosen.owner as OwnerId) : null;
      const how = AGREED_HOW.find((one) => one === chosen.how);
      if (problems.length === 0 && (owner === null || how === undefined || form.get('agreed') !== '1')) {
        problems.push(owner === null ? CONTROL_WORDS.needOwner : CONTROL_WORDS.needTick);
      }
      if (problems.length > 0 || owner === null || how === undefined) {
        if (!problems.includes(CONTROL_WORDS.needTick)) problems.push(CONTROL_WORDS.nothingSaved);
        await logStaff(at.firmDb, at.firm.id, at.staff, 'checked_wording', { messageKind: kind });
        return drawn(c, CONTROL_WORDS.textKinds[kind], wordingScreen(await wordingView(c, at, kind, words, versions, problems, chosen)), 400);
      }
      await setWording(at.firmDb, at.firm.id, `text:${kind}`, words, { kind: 'staff', staff: at.staff }, { owner: owner.id, how });
      log('wording_agreed', { firm: at.firm.id, staff: at.staff });
      return c.redirect(`/control/firms/${at.firm.id}/wording/${kind}`, 303);
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

/** One of the firm's owners, named in the address. Another firm's owner is "not found", as one that never was. */
function atOwner(c: Context<AppEnv>, kind: 'view' | 'form', draw: (at: AtFirm, owner: Owner) => Promise<Response>): Promise<Response> {
  return atFirm(c, kind, async (at) => {
    const id = c.req.param('owner') ?? '';
    const owner = isId(id) ? await getOwner(at.firmDb, at.firm.id, id as OwnerId) : null;
    if (owner === null) return notFound(c);
    return draw(at, owner);
  });
}

/** One kind of text, named in the address. Anything else is "not found". */
function atKind(c: Context<AppEnv>, kind: 'view' | 'form', draw: (at: AtFirm, kind: MessageKind) => Promise<Response>): Promise<Response> {
  return atFirm(c, kind, async (at) => {
    const named = c.req.param('kind') ?? '';
    if (!Object.hasOwn(MESSAGE_KINDS, named)) return notFound(c);
    return draw(at, named as MessageKind);
  });
}

/** How far the firm is set up, for its page. */
async function setUpOf(at: AtFirm): Promise<{ gaps: ReturnType<typeof callsSetUpGaps>; owners: Owner[] }> {
  const owners = await listOwners(at.firmDb, at.firm.id);
  return { gaps: callsSetUpGaps(at.firm, owners, await firmWording(at.firmDb, at.firm.id)), owners };
}

/** A kind of text's wording page: the words, what a check found, and the text with example details when it can go. */
async function wordingView(
  c: Context<AppEnv>,
  at: AtFirm,
  kind: MessageKind,
  words: string,
  versions: readonly WordingVersion[],
  problems: string[] | null,
  chosen: { owner: string; how: string },
): Promise<WordingView> {
  const owners = await listOwners(at.firmDb, at.firm.id);
  const deps = c.get('deps');
  const addresses = { links: deps.linkAddress, app: deps.appAddress };
  let preview: WordingView['preview'] = null;
  if (wordingProblems(`text:${kind}`, words).length === 0) {
    const text = makeWords(words, previewFacts(kind, at.firm, owners[0] ?? null, addresses, false));
    const longest = makeWords(words, previewFacts(kind, at.firm, owners[0] ?? null, addresses, true));
    // Every character a text carries is one of these, so its length is its count.
    preview = { text, segments: segments(text), characters: text.length, longest: segments(longest) };
  }
  return {
    firm: at.firm,
    kind,
    owners,
    words,
    fromDraft: versions.length === 0,
    problems,
    preview,
    versions,
    chosen: { owner: chosen.owner === '' ? (owners[0]?.id ?? '') : chosen.owner, how: AGREED_HOW.includes(chosen.how as AgreedHow) ? chosen.how : 'phone' },
  };
}

/** The diary form filled from the firm's rules, or empty but for likely times between starts and days ahead. */
function diaryFormOf(rules: DiaryRules | null): DiaryForm {
  const lengths = Object.fromEntries(VISIT_KINDS.map((kind) => [kind, rules?.lengths[kind] === undefined ? '' : String(rules.lengths[kind])])) as Record<VisitKind, string>;
  return rules === null
    ? { days: [], opens: '', closes: '', every: '60', daysAhead: '14', lengths }
    : {
        days: rules.days,
        opens: minutesToTime(rules.opens),
        closes: minutesToTime(rules.closes),
        every: String(rules.every),
        daysAhead: String(rules.daysAhead),
        lengths,
      };
}

/** The diary form as it was posted. */
function diaryFormFrom(form: URLSearchParams): DiaryForm {
  const field = (name: string) => (form.get(name) ?? '').slice(0, 10);
  return {
    days: form.getAll('day').map(Number),
    opens: field('opens'),
    closes: field('closes'),
    every: field('every'),
    daysAhead: field('daysAhead'),
    lengths: Object.fromEntries(VISIT_KINDS.map((kind) => [kind, field(`length_${kind}`)])) as Record<VisitKind, string>,
  };
}

/** Diary rules from the form. Whatever does not read as a number is left to diaryRulesProblems() to refuse. */
function diaryRulesFrom(form: DiaryForm): DiaryRules {
  const lengths: Partial<Record<VisitKind, number>> = {};
  for (const kind of VISIT_KINDS) {
    if (form.lengths[kind].trim() !== '') lengths[kind] = whole(form.lengths[kind]);
  }
  return { days: form.days, opens: timeToMinutes(form.opens), closes: timeToMinutes(form.closes), every: whole(form.every), daysAhead: whole(form.daysAhead), lengths };
}

/** A whole number as typed, or NaN. */
function whole(typed: string): number {
  return /^\d{1,5}$/.test(typed.trim()) ? Number(typed.trim()) : NaN;
}

/** A time as a time field sends it, such as 08:00, in minutes after midnight, or NaN. */
function timeToMinutes(typed: string): number {
  const parts = /^(\d{2}):(\d{2})$/.exec(typed);
  if (parts === null) return NaN;
  const [hours, minutes] = [Number(parts[1]), Number(parts[2])];
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : NaN;
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
async function readForm(request: Request, limit = FORM_LIMIT): Promise<URLSearchParams> {
  const length = Number(request.headers.get('Content-Length') ?? '0');
  const body = Number.isFinite(length) && length <= limit ? await request.text() : '';
  return new URLSearchParams(body.length > limit ? '' : body);
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

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
  customerFile,
  customerFileCounts,
  deleteCustomer,
  deleteExampleFirm,
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
import { SERVICES, type CustomerId, type Firm, type FirmId, type Service, type StaffId } from './record/types';
import {
  CONTROL_HEADERS,
  CONTROL_WORDS,
  controlPage,
  customerScreen,
  deletedScreen,
  deleteScreen,
  findScreen,
  firmScreen,
  firmsScreen,
  messageScreen,
  resetScreen,
  type FirmLine,
} from './screens/control';
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

  // The export: a file of everything held about the customer, to the
  // browser of the member of staff who asked. Front-line keeps no copy.
  app.post('/control/firms/:firm/customers/:customer/export', (c) =>
    atCustomer(c, 'form', async (at, customer) => {
      const file = await customerFile(at.firmDb, at.firm.id, customer);
      if (file === null) return notFound(c);
      const wording = await firmWording(at.firmDb, at.firm.id);
      const lines = (await historyForCustomer(at.firmDb, at.firm.id, customer)).map((entry) => ({
        at: new Date(entry.at).toISOString(),
        line: historyLine(entry, 'job', wording) ?? historyLine(entry, 'feed', wording),
      }));
      await logStaff(at.firmDb, at.firm.id, at.staff, 'exported_customer', { customer });
      log('customer_exported', { firm: at.firm.id, customer, staff: at.staff });
      return c.body(JSON.stringify({ ...file, historyAsTheOwnerReadsIt: lines }, null, 2), 200, {
        ...CONTROL_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="frontline-export-${at.firm.id}-${customer}.json"`,
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

  app.post('/control/firms/:firm/customers/:customer/delete', (c) =>
    atCustomer(c, 'form', async (at, customer) => {
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
  const db = openRecord(c.env.DB, deps.clock);
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

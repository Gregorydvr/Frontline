import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { version } from '../package.json';
import { act, type ActionContext } from './actions';
import { answerFreeTimes } from './booking';
import type { Deps } from './deps';
import { ownDiary } from './diary/own';
import { errorName, log } from './log';
import { isUkMobile } from './phone';
import { formField, isFromTwilio, readTwilioForm } from './providers/texts/twilio';
import {
  findFirmByNumber,
  findLink,
  getCustomer,
  getFirm,
  getJob,
  listVisitsForJob,
} from './record';
import { controlRoutes } from './control-room';
import { ownerRoutes } from './owner-app';
import { openRecord, withFirmClock, type RecordDb } from './record/db';
import { CUSTOMER_LIMITS, TEXT_LIMITS } from './record/types';
import { DETAILS_HEADERS, detailsPage, detailsSavedPage, formFromRecord, linkExpiredPage, type DetailsForm } from './screens/details';
import { bearerToken, sameSecret } from './secret';
import { readVapiMessage, text } from './vapi-report';
import { readToolCalls, TOOL_NAMES } from './vapi-tools';

/** The answer to Twilio for a text that came in: empty, so Twilio sends no reply. */
const NO_REPLY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export interface AppEnv {
  Bindings: Env;
  Variables: { deps: Deps };
}

/**
 * The Worker's routes. `makeDeps` builds what each request is given: the real
 * clock and providers in the Worker, pretend ones in tests. `extend` adds to
 * the app before its own routes, so anything it adds sees every request; only
 * the version for this machine (src/local.ts) uses it.
 */
export function createApp(makeDeps: (env: Env) => Deps, extend?: (app: Hono<AppEnv>) => void): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    c.set('deps', makeDeps(c.env));
    await next();
  });

  extend?.(app);

  app.get('/health', (c) => c.json({ version }, 200, { 'Cache-Control': 'no-store' }));

  // Where Vapi sends its messages about a firm's calls (docs/vapi.md). It is
  // outside the practice gate, so it checks Vapi's secret before it reads
  // anything, and refuses everything when no secret is set up.
  app.post('/vapi/server', async (c) => {
    if (!(await sameSecret(bearerToken(c.req.header('Authorization')), c.env.VAPI_SECRET))) {
      log('call_report_refused');
      return c.body(null, 401);
    }
    const message = readVapiMessage(await c.req.json().catch(() => null));
    switch (message.kind) {
      case 'other':
        return c.json({});
      case 'unreadable':
        log('call_report_unreadable');
        return c.json({}, 400);
      case 'report': {
        // An urgent call alerts the owner at once, before Vapi gets its answer.
        const landed = await act(bySystem(c), 'land_call', { report: message.report });
        return c.json({}, landed.result === 'unknown_number' ? 404 : 200);
      }
    }
  });

  // Where the voice agent asks for free times, and books one, during a call
  // (docs/vapi.md). Outside the practice gate, so each checks Vapi's secret
  // before it reads anything. Each works only in the diary of the firm whose
  // number was rung.
  app.post('/vapi/free-times', (c) => toolRoute(c, TOOL_NAMES.freeTimes));
  app.post('/vapi/book', (c) => toolRoute(c, TOOL_NAMES.book));

  // The page a customer opens from the link in their first text, to check
  // their details. No login: the token in the address is the key (rule 13).
  app.get('/d/:token', async (c) => {
    if (!onLinkAddress(c)) return c.notFound();
    const db = openRecord(c.env.DB, c.get('deps').clock);
    const found = await linkedDetails(db, c.req.param('token'));
    if (found === null) {
      return c.html(linkExpiredPage(), 404, DETAILS_HEADERS);
    }
    return c.html(detailsPage(found.firmName, found.visit, formFromRecord(found.customer, found.place)), 200, DETAILS_HEADERS);
  });

  app.post('/d/:token', async (c) => {
    if (!onLinkAddress(c)) return c.notFound();
    const db = openRecord(c.env.DB, c.get('deps').clock);
    const found = await linkedDetails(db, c.req.param('token'));
    if (found === null) {
      return c.html(linkExpiredPage(), 404, DETAILS_HEADERS);
    }
    const form = await readDetailsForm(c.req.raw);
    if (form.problem !== null) {
      log('details_refused', { firm: found.firm, customer: found.customer.id });
      return c.html(detailsPage(found.firmName, found.visit, form), 400, DETAILS_HEADERS);
    }
    await act({ ...bySystem(c), db, by: { kind: 'customer' } }, 'confirm_details', {
      firm: found.firm,
      customer: found.customer.id,
      job: found.job,
      details: { name: form.name, address: form.address, email: form.email === '' ? null : form.email },
    });
    return c.html(detailsSavedPage(found.firmName), 200, DETAILS_HEADERS);
  });

  // Where Twilio sends a text that came in to a firm's number
  // (docs/twilio.md). Outside the practice gate, so it checks Twilio's
  // signature before it reads anything. The text is stored against the
  // customer and shown on their job's page. A STOP or START opts the number
  // out or back in. Nothing answers it in Release 1.
  app.post('/twilio/texts', async (c) => {
    const form = await readTwilioForm(c.req.raw);
    if (form === null) {
      log('twilio_too_large');
      return c.body(null, 413);
    }
    if (!(await isFromTwilio(c.env.TWILIO_AUTH_TOKEN, c.req.url, form, c.req.header('X-Twilio-Signature')))) {
      log('twilio_refused');
      return c.body(null, 401);
    }
    const to = formField(form, 'To');
    const providerId = formField(form, 'MessageSid');
    const words = formField(form, 'Body') ?? '';
    if (to === null || !isUkMobile(to) || providerId === null || providerId.length > TEXT_LIMITS.providerId || words.length > TEXT_LIMITS.textIn) {
      log('twilio_unreadable');
      return c.body(null, 400);
    }
    const db = openRecord(c.env.DB, c.get('deps').clock);
    const firm = await findFirmByNumber(db, to);
    if (firm === null) {
      log('text_in_for_unknown_number');
      return c.body(null, 404);
    }
    await act({ ...bySystem(c), db }, 'take_text_in', { firm, provider: 'twilio', providerId, from: formField(form, 'From'), words });
    return c.body(NO_REPLY, 200, { 'Content-Type': 'text/xml' });
  });

  // Where Twilio reports on the delivery of a text sent from a firm's number.
  // Outside the practice gate, so it checks Twilio's signature first. A text
  // only moves forward: delivered, or failed.
  app.post('/twilio/status', async (c) => {
    const form = await readTwilioForm(c.req.raw);
    if (form === null) {
      log('twilio_too_large');
      return c.body(null, 413);
    }
    if (!(await isFromTwilio(c.env.TWILIO_AUTH_TOKEN, c.req.url, form, c.req.header('X-Twilio-Signature')))) {
      log('twilio_refused');
      return c.body(null, 401);
    }
    const from = formField(form, 'From');
    const providerId = formField(form, 'MessageSid');
    const status = formField(form, 'MessageStatus');
    if (from === null || !isUkMobile(from) || providerId === null || status === null) {
      log('twilio_unreadable');
      return c.body(null, 400);
    }
    const db = openRecord(c.env.DB, c.get('deps').clock);
    const firm = await findFirmByNumber(db, from);
    // Twilio's other statuses (queued, sending, sent and the rest) say it is
    // still on its way, which the record already knows.
    const report =
      status === 'delivered'
        ? ({ delivered: true } as const)
        : status === 'failed' || status === 'undelivered'
          ? ({ delivered: false, errorCode: errorCode(formField(form, 'ErrorCode')) } as const)
          : null;
    if (firm === null || report === null) {
      return c.body(null, 200);
    }
    await act({ ...bySystem(c), db }, 'record_delivery', { firm, provider: 'twilio', providerId, report });
    return c.body(null, 200);
  });

  // The owner's app: logging in, and the owner's screens (src/owner-app.ts).
  ownerRoutes(app);

  // The control room, for Front-line's own staff (src/control-room.ts).
  controlRoutes(app);

  app.onError((thrown, c) => {
    // A refusal on purpose, such as a 401 from an auth check, keeps its own
    // answer and is not an error.
    if (thrown instanceof HTTPException) {
      return thrown.getResponse();
    }
    // Hono's own handler would log the error's message, which can hold a
    // customer's details. Log only its type (rule 11).
    log('unhandled_error', { error: errorName(thrown) });
    return c.text('Internal Server Error', 500);
  });

  return app;
}

/**
 * Whether a request for a customer's page came to the address for customers'
 * links. When this copy serves the app and customers' links from two
 * addresses, a customer's page answers only on the links' address, so it
 * never shares an address with the owner's login. On this machine the two
 * are the same.
 */
function onLinkAddress(c: Context<AppEnv>): boolean {
  const { appAddress, linkAddress } = c.get('deps');
  if (appAddress === null || linkAddress === null || new URL(appAddress).host === new URL(linkAddress).host) {
    return true;
  }
  return new URL(c.req.url).host === new URL(linkAddress).host;
}

function errorCode(text: string | null): number | null {
  return text !== null && /^\d{1,9}$/.test(text) ? Number(text) : null;
}

/**
 * Answers a message from Vapi for one of Front-line's tools. Each tool call
 * in it for this address gets its answer; one for another tool is told so.
 */
async function toolRoute(c: Context<AppEnv>, tool: (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES]): Promise<Response> {
  if (!(await sameSecret(bearerToken(c.req.header('Authorization')), c.env.VAPI_SECRET))) {
    log('tool_call_refused');
    return c.body(null, 401);
  }
  const message = readToolCalls(await c.req.json().catch(() => null));
  if (message.kind === 'unreadable') {
    log('tool_call_unreadable');
    return c.json({}, 400);
  }
  const db = openRecord(c.env.DB, c.get('deps').clock);
  const firmId = message.firmNumber === null ? null : await findFirmByNumber(db, message.firmNumber);
  const firm = firmId === null ? null : await getFirm(db, firmId);
  if (firm === null) {
    log('tool_call_for_unknown_number');
    return c.json({}, 404);
  }
  const diary = ownDiary(withFirmClock(db, firm));
  const call = message.providerCallId === null ? null : { provider: 'vapi', providerCallId: message.providerCallId } as const;
  const results = [];
  for (const toolCall of message.calls) {
    if (toolCall.name !== tool) {
      results.push({ name: toolCall.name, toolCallId: toolCall.id, error: 'This tool is not answered here.' });
      continue;
    }
    const answer =
      tool === TOOL_NAMES.freeTimes
        ? await answerFreeTimes(diary, firm, call, toolCall.args)
        : await act({ ...bySystem(c), db }, 'book_on_call', { diary, firm, call, args: toolCall.args, from: message.from });
    results.push({ name: toolCall.name, toolCallId: toolCall.id, result: answer });
  }
  return c.json({ results });
}

/** What an action the system takes for a request from Vapi, Twilio or a customer's link is given (src/actions.ts). */
function bySystem(c: Context<AppEnv>): ActionContext {
  const deps = c.get('deps');
  return { db: openRecord(c.env.DB, deps.clock), d1: c.env.DB, deps, by: { kind: 'frontline' } };
}

/** What a customer's link is for, with what its page shows, or null for a link that has expired or never was. */
async function linkedDetails(db: RecordDb, token: string) {
  const link = await findLink(db, token);
  const firm = link === null ? null : await getFirm(db, link.firm);
  const customer = link === null ? null : await getCustomer(db, link.firm, link.customer);
  const job = link === null ? null : await getJob(db, link.firm, link.job);
  if (link === null || firm === null || customer === null || job === null) {
    log('link_not_found');
    return null;
  }
  const now = db.clock.now();
  const visit = (await listVisitsForJob(db, link.firm, link.job)).find((one) => one.state === 'booked' && one.startsAt >= now) ?? null;
  return { firm: link.firm, firmName: firm.name, customer, job: link.job, place: job.place, visit };
}

/** The longest form the details page takes. Its three fields are a few hundred characters. */
const DETAILS_FORM_LIMIT = 4_096;

/** Reads what the customer sent from their details page, and what is wrong with it, if anything. */
async function readDetailsForm(request: Request): Promise<DetailsForm> {
  const length = Number(request.headers.get('Content-Length') ?? '0');
  const body = Number.isFinite(length) && length <= DETAILS_FORM_LIMIT ? await request.text() : '';
  const fields = new URLSearchParams(body.length > DETAILS_FORM_LIMIT ? '' : body);
  const sent = (name: string, longest: number) => (fields.get(name) ?? '').replace(/\s+/g, ' ').trim().slice(0, longest);
  const form = {
    name: sent('name', CUSTOMER_LIMITS.name),
    address: sent('address', CUSTOMER_LIMITS.address),
    email: sent('email', CUSTOMER_LIMITS.email),
  };
  if (text(form.name, CUSTOMER_LIMITS.name) === null || text(form.address, CUSTOMER_LIMITS.address) === null) {
    return { ...form, problem: 'missing' };
  }
  if (form.email !== '' && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(form.email)) {
    return { ...form, problem: 'bad_email' };
  }
  return { ...form, problem: null };
}

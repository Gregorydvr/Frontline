// The owner's app (slice F of docs/build-brief.md): logging in by a link sent
// by text, and the owner's screens, drawn from the record.
//
// Every screen takes the firm from the owner's login and from nothing else,
// so an id in an address is only ever looked for in that firm's records:
// another firm's job is "not found", the same as one that never was (rule 8).
// A page asked for without a login goes to the login page, keeping the job
// it was for, so an urgent alert's link lands on its job once logged in.
//
// Every form posts only from the app's own pages: a post from anywhere else
// is refused. The login's cookie is sent only by the app's own address,
// cannot be read by a script, and comes with a link followed from a text.

import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from './app';
import { instant } from './clock';
import { runDue } from './due';
import { isId } from './ids';
import { errorName, log } from './log';
import { ukMobile, type UkMobile } from './phone';
import {
  countLoginLinks,
  createLoginLink,
  endSession,
  findLoginLink,
  findOwnersByMobile,
  findSession,
  getFirm,
  getJob,
  getOwner,
  logInWithLink,
  recordOwnerMessage,
} from './record';
import { openRecord, type RecordDb } from './record/db';
import { LOGIN_LASTS, LOGIN_LINK_LIMITS, type SessionToken } from './record/logins';
import { OWNER_MESSAGE_LIMIT } from './record/owner-messages';
import type { Firm, JobId, OwnerId } from './record/types';
import { APP_SCRIPT } from './screens/app-script';
import { callsScreen } from './screens/calls';
import { doneScreen } from './screens/done';
import type { Html } from './screens/html';
import { homeScreen } from './screens/home';
import { jobScreen } from './screens/job';
import { FIND_LIMIT, jobsScreen } from './screens/jobs';
import { loginExpiredPage, loginLinkPage, loginPage, loginSentPage, notFoundScreen } from './screens/login';
import { messageSentSheet, messageSheet } from './screens/message';
import { rulesScreen } from './screens/rules';
import { OWNER_HEADERS, ownerPage, SCREEN_ADDRESSES, shownServices, type Place, type ScreenName } from './screens/shell';
import { APP_WORDS, SERVICE_WORDS } from './words';

/** The longest form the app takes: Message us, with room to spare. */
const FORM_LIMIT = 4 * OWNER_MESSAGE_LIMIT;

/** Who is logged in, with what every screen needs. */
interface Owner {
  db: RecordDb;
  firm: Firm;
  owner: OwnerId;
  cookie: SessionToken;
}

export function ownerRoutes(app: Hono<AppEnv>): void {
  app.get('/app.js', (c) =>
    c.body(APP_SCRIPT, 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    }),
  );

  // Asking for a link. The page says the same whatever number was typed, so
  // nobody can use it to find out whether a number is an owner's. The text
  // goes to the mobile on the owner's record, never to the number typed.
  app.get('/login', (c) => {
    if (!onAppAddress(c)) return c.notFound();
    const job = c.req.query('job') ?? '';
    return c.html(loginPage({ mobile: '', job: isId(job) ? job : null, badMobile: false }), 200, OWNER_HEADERS);
  });

  app.post('/login', async (c) => {
    if (!onAppAddress(c)) return c.notFound();
    if (!fromTheApp(c)) return refused(c);
    const form = await readForm(c.req.raw);
    const typed = (form.get('mobile') ?? '').slice(0, 30);
    const jobAsked = form.get('job') ?? '';
    const job = isId(jobAsked) ? (jobAsked as JobId) : null;
    let mobile: UkMobile;
    try {
      mobile = ukMobile(typed);
    } catch {
      return c.html(loginPage({ mobile: typed, job, badMobile: true }), 400, OWNER_HEADERS);
    }
    const deps = c.get('deps');
    const db = openRecord(c.env.DB, deps.clock);
    const now = db.clock.now();
    log('login_asked');
    for (const { firm, owner } of await findOwnersByMobile(db, mobile)) {
      if (
        (await countLoginLinks(db, firm, owner, instant(now - 60 * 60_000))) >= LOGIN_LINK_LIMITS.hour ||
        (await countLoginLinks(db, firm, owner, instant(now - 24 * 60 * 60_000))) >= LOGIN_LINK_LIMITS.day
      ) {
        log('login_link_limit', { firm, owner });
        continue;
      }
      // A job to land on only if it is this firm's.
      const landOn = job === null ? null : ((await getJob(db, firm, job))?.id ?? null);
      const { due } = await createLoginLink(db, firm, { owner, job: landOn });
      log('login_link_made', { firm, due });
      // Sent at once. If this fails, the clock runs the row again shortly,
      // and the text still cannot go twice.
      try {
        await runDue(db, deps, firm, due);
      } catch (thrown) {
        log('due_failed', { firm, due, error: errorName(thrown) });
      }
    }
    return c.html(loginSentPage(), 200, OWNER_HEADERS);
  });

  // The page a login link opens: a button, and nothing else. Opening it
  // changes nothing, so a phone's link preview cannot use the link up.
  app.get('/in/:token', async (c) => {
    if (!onAppAddress(c)) return c.notFound();
    const db = openRecord(c.env.DB, c.get('deps').clock);
    if ((await findLoginLink(db, c.req.param('token'))) === null) {
      log('login_link_not_found');
      return c.html(loginExpiredPage(), 404, OWNER_HEADERS);
    }
    return c.html(loginLinkPage(), 200, OWNER_HEADERS);
  });

  // The tap on the button: the link is used up, and the owner is logged in.
  app.post('/in/:token', async (c) => {
    if (!onAppAddress(c)) return c.notFound();
    if (!fromTheApp(c)) return refused(c);
    const db = openRecord(c.env.DB, c.get('deps').clock);
    const login = await logInWithLink(db, c.req.param('token'));
    if (login === null) {
      log('login_link_not_found');
      return c.html(loginExpiredPage(), 404, OWNER_HEADERS);
    }
    const secure = isHttps(c);
    setCookie(c, cookieName(secure), login.session, {
      path: '/',
      secure,
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: LOGIN_LASTS.longest / 1000,
    });
    log('logged_in', { firm: login.firm, owner: login.owner });
    return c.redirect(login.job === null ? '/' : `/jobs/${login.job}`, 303);
  });

  app.post('/logout', async (c) => {
    if (!onAppAddress(c)) return c.notFound();
    if (!fromTheApp(c)) return refused(c);
    const who = await loggedIn(c);
    if (!(who instanceof Response)) {
      await endSession(who.db, who.firm.id, who.cookie);
      log('logged_out', { firm: who.firm.id, owner: who.owner });
    }
    deleteCookie(c, cookieName(isHttps(c)), { path: '/', secure: isHttps(c) });
    return c.redirect('/login', 303);
  });

  // The screens.
  app.get('/', (c) =>
    screen(c, 'home', async (who) => ({ title: APP_WORDS.home, html: await homeScreen(who.db, who.firm, who.db.clock.now()), wide: true })),
  );
  app.get('/calls', (c) =>
    screen(c, 'calls', async (who) =>
      shownServices(who.firm).includes('calls') ? { title: SERVICE_WORDS.calls, html: await callsScreen(who.db, who.firm.id, who.db.clock.now()) } : null,
    ),
  );
  app.get('/jobs', (c) =>
    screen(c, 'jobs', async (who) => ({
      title: APP_WORDS.allJobs,
      html: await jobsScreen(who.db, who.firm, who.db.clock.now(), (c.req.query('q') ?? '').slice(0, FIND_LIMIT)),
    })),
  );
  app.get('/jobs/:job', async (c) => {
    const job = c.req.param('job');
    return screen(
      c,
      'job',
      async (who) => {
        const found = isId(job) ? await jobScreen(who.db, who.firm, job as JobId, who.db.clock.now()) : null;
        return found === null ? null : { title: found.title, html: found.screen };
      },
      isId(job) ? job : null,
    );
  });
  app.get('/done', (c) =>
    screen(c, 'done', async (who) => ({ title: APP_WORDS.doneForYou, html: await doneScreen(who.db, who.firm, who.db.clock.now()) })),
  );
  app.get('/rules', (c) => screen(c, 'rules', (who) => Promise.resolve({ title: APP_WORDS.yourRules, html: rulesScreen(who.firm) })));

  // Message us: a panel over the screen it was opened from.
  app.get('/message', async (c) => {
    const from = screenName(c.req.query('from'));
    return withSheet(c, from, () => messageSheet(from, '', false), 200);
  });

  app.post('/message', async (c) => {
    if (!onAppAddress(c)) return c.notFound();
    if (!fromTheApp(c)) return refused(c);
    const from = screenName(c.req.query('from'));
    const who = await loggedIn(c);
    if (who instanceof Response) return who;
    const words = ((await readForm(c.req.raw)).get('words') ?? '').trim().slice(0, OWNER_MESSAGE_LIMIT);
    if (words === '') {
      return withSheet(c, from, () => messageSheet(from, '', true), 400);
    }
    const message = await recordOwnerMessage(who.db, who.firm.id, who.owner, words);
    log('owner_message_stored', { firm: who.firm.id, message });
    return withSheet(c, from, () => messageSentSheet(from), 200);
  });
}

/** What a screen shows, or null for "not found". */
interface Drawn {
  title: string;
  html: Html;
  wide?: boolean;
}

/** Draws one of the owner's screens, for the owner logged in, or sends them to log in. */
async function screen(
  c: Context<AppEnv>,
  place: Place,
  draw: (who: Owner) => Promise<Drawn | null>,
  job: string | null = null,
): Promise<Response> {
  if (!onAppAddress(c)) return c.notFound();
  const who = await loggedIn(c, job);
  if (who instanceof Response) return who;
  const drawn = await draw(who);
  if (drawn === null) {
    return c.html(ownerPage({ title: APP_WORDS.notFoundTitle, firm: who.firm, place: null }, notFoundScreen()), 404, OWNER_HEADERS);
  }
  return c.html(ownerPage({ title: drawn.title, firm: who.firm, place, wide: drawn.wide ?? false }, drawn.html), 200, OWNER_HEADERS);
}

/** A screen with a panel over it, such as Message us over the screen it was opened from. */
async function withSheet(c: Context<AppEnv>, from: ScreenName, sheet: () => Html, status: 200 | 400): Promise<Response> {
  if (!onAppAddress(c)) return c.notFound();
  const who = await loggedIn(c);
  if (who instanceof Response) return who;
  const now = who.db.clock.now();
  const behind: Drawn = await (async () => {
    switch (from) {
      case 'calls':
        return shownServices(who.firm).includes('calls')
          ? { title: SERVICE_WORDS.calls, html: await callsScreen(who.db, who.firm.id, now) }
          : { title: APP_WORDS.home, html: await homeScreen(who.db, who.firm, now), wide: true };
      case 'jobs':
        return { title: APP_WORDS.allJobs, html: await jobsScreen(who.db, who.firm, now, '') };
      case 'done':
        return { title: APP_WORDS.doneForYou, html: await doneScreen(who.db, who.firm, now) };
      case 'rules':
        return { title: APP_WORDS.yourRules, html: rulesScreen(who.firm) };
      case 'home':
        return { title: APP_WORDS.home, html: await homeScreen(who.db, who.firm, now), wide: true };
    }
  })();
  return c.html(
    ownerPage({ title: APP_WORDS.messageUs, firm: who.firm, place: from, wide: behind.wide ?? false, sheet: sheet() }, behind.html),
    status,
    OWNER_HEADERS,
  );
}

/**
 * The owner logged in on this browser, or the way to the login page. Given
 * a job, the login page keeps it, so the owner lands on it once logged in.
 */
async function loggedIn(c: Context<AppEnv>, job: string | null = null): Promise<Owner | Response> {
  const db = openRecord(c.env.DB, c.get('deps').clock);
  const cookie = getCookie(c, cookieName(isHttps(c))) ?? '';
  const found = await findSession(db, cookie);
  const firm = found === null ? null : await getFirm(db, found.firm);
  const owner = found === null ? null : await getOwner(db, found.firm, found.owner);
  if (found === null || firm === null || owner === null) {
    return c.redirect(job === null ? '/login' : `/login?job=${job}`, 303);
  }
  return { db, firm, owner: owner.id, cookie: cookie as SessionToken };
}

/** The screen a Message us panel was opened over: one of the app's own, or Home. */
function screenName(asked: string | undefined): ScreenName {
  return asked !== undefined && Object.hasOwn(SCREEN_ADDRESSES, asked) ? (asked as ScreenName) : 'home';
}

/** A form, read up to a size no page of the app sends past. */
async function readForm(request: Request): Promise<URLSearchParams> {
  const length = Number(request.headers.get('Content-Length') ?? '0');
  const body = Number.isFinite(length) && length <= FORM_LIMIT ? await request.text() : '';
  return new URLSearchParams(body.length > FORM_LIMIT ? '' : body);
}

/**
 * Whether a form was posted from one of the app's own pages: the browser
 * says where it came from, and it must be here. Anything else is refused,
 * so another site cannot post a form in the owner's name.
 */
function fromTheApp(c: Context<AppEnv>): boolean {
  return c.req.header('Origin') === new URL(c.req.url).origin;
}

function refused(c: Context<AppEnv>): Response {
  log('owner_request_refused');
  return c.body(null, 403);
}

/**
 * Whether the request came to the app's own address. When this copy serves
 * the app and customers' links from two addresses, the owner's pages answer
 * only on the app's, so the owner's cookie is never sent to a page a
 * customer opens. On this machine the two are the same.
 */
function onAppAddress(c: Context<AppEnv>): boolean {
  const { appAddress, linkAddress } = c.get('deps');
  if (appAddress === null || linkAddress === null || hostOf(appAddress) === hostOf(linkAddress)) {
    return true;
  }
  return new URL(c.req.url).host === hostOf(appAddress);
}

function hostOf(address: string): string {
  return new URL(address).host;
}

function isHttps(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

/**
 * The login's cookie. Over https it carries the __Host- prefix, which tells
 * the browser to send it only to this address and only over https. This
 * machine answers over http, where the prefix cannot be used.
 */
function cookieName(secure: boolean): string {
  return secure ? '__Host-login' : 'login';
}

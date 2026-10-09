// Logging an owner in by a link sent by text (slice F of docs/build-brief.md):
// the text goes only to the mobile on an owner's record, in the firm's agreed
// words, and only as often as the limits allow; the link works once, for 15
// minutes, and only the tap on its button logs in; a login lasts 30 days
// unused and 90 days at most; logging out ends it. All of it is recorded.

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { segments } from '../src/gsm';
import { DRAFT_WORDING } from '../src/messages';
import { ukMobile } from '../src/phone';
import { createJob, createCustomer, listMessagesBetween, listOwners, setOwnerMobile, setWording } from '../src/record';
import { openRecord } from '../src/record/db';
import { LOGIN_LASTS, LOGIN_LINK_LASTS } from '../src/record/logins';
import type { FirmId } from '../src/record/types';
import { historyKinds } from './helpers/db';
import { APP_ADDRESS, testDeps } from './helpers/deps';
import { agreedByOwner, form, opener } from './helpers/owner';
import { tidewell } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-10-15T16:00:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const app = createApp(() => deps);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;

let firm: FirmId;
let mobile: string;
let firms = 0;

/** A firm of its own for each test, with an owner on a mobile of their own, so links and limits do not mix. */
beforeEach(async () => {
  clock.set(instantFromIso('2026-10-15T16:00:00+01:00'));
  firms += 1;
  firm = await tidewell(db, `07700 9003${String(firms).padStart(2, '0')}`);
  mobile = `07700 9005${String(firms).padStart(2, '0')}`;
  const [owner] = await listOwners(db, firm);
  if (owner === undefined) throw new Error('No owner');
  await setOwnerMobile(db, firm, owner.id, ukMobile(mobile), { kind: 'frontline' });
});

const open = opener(app, null);

async function askForLink(typed: string, job?: string): Promise<Response> {
  return open('/login', form(job === undefined ? { mobile: typed } : { mobile: typed, job }));
}

/** The link in the last text sent, as the owner's phone shows it. */
function lastLink(): string {
  const body = deps.texts.sent[deps.texts.sent.length - 1]?.body ?? '';
  const link = /https:\/\/app\.example(\/in\/[0-9a-z]{26})$/.exec(body)?.[1];
  if (link === undefined) throw new Error('No link in the last text');
  return link;
}

/** The cookie a response sets, as the browser would send it back. */
function cookieFrom(answer: Response): string {
  const set = answer.headers.get('Set-Cookie') ?? '';
  return set.split(';')[0] ?? '';
}

describe('asking for a link', () => {
  it('shows a page to type a mobile, which posts back to it', async () => {
    const page = await open('/login');
    expect(page.status).toBe(200);
    const words = await page.text();
    expect(words).toContain('<h1>Log in</h1>');
    expect(words).toContain('<form class="stack" method="post" action="/login">');
    expect(words).toContain('<label for="fl-mobile">Your mobile</label>');
    expect(page.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(page.headers.get('Content-Security-Policy')).toContain("form-action 'self'");
  });

  it('texts the owner a link, from the firm’s own number, in the words the firm agreed, in plain text characters', async () => {
    const before = deps.texts.sent.length;
    const answer = await askForLink(mobile);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain('If that mobile is on our list, a link is on its way. It works for 15 minutes.');

    const sent = deps.texts.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: '+4477009003' + String(firms).padStart(2, '0'), to: ukMobile(mobile) });
    expect(sent[0]?.body).toMatch(
      /^Front-line: here is your link to log in\. It works for 15 minutes\. If you did not ask for it, ignore this text\. https:\/\/app\.example\/in\/[0-9a-z]{26}$/,
    );
    const [text] = await listMessagesBetween(db, firm, ...allTime);
    expect(text).toMatchObject({ kind: 'login_link', state: 'sent', to: { kind: 'owner' }, segments: segments(sent[0]?.body ?? '') });
  });

  it('says "15 minutes" in the draft, as long as a link lasts, and fits two segments with a real address', () => {
    expect(DRAFT_WORDING.login_link).toContain(`${String(LOGIN_LINK_LASTS / 60_000)} minutes`);
    const words = (DRAFT_WORDING.login_link ?? '').replace('{link}', `https://app.example.co.uk/in/${'a'.repeat(26)}`);
    expect(segments(words)).toBe(2);
  });

  it('takes the mobile written in any usual way', async () => {
    const before = deps.texts.sent.length;
    const national = mobile.replace(' ', '');
    await askForLink(`+44 ${national.slice(1)}`);
    await askForLink(national);
    expect(deps.texts.sent.length).toBe(before + 2);
  });

  it('sends nothing for a number that is not an owner’s, and shows exactly the same page', async () => {
    const before = deps.texts.sent.length;
    const forOwner = await (await askForLink(mobile)).text();
    const forNobody = await askForLink('07700 900999');
    expect(forNobody.status).toBe(200);
    expect(await forNobody.text()).toBe(forOwner);
    expect(deps.texts.sent.length).toBe(before + 1);
    expect(deps.texts.sent.map((text) => text.to)).not.toContain(ukMobile('07700 900999'));
  });

  it('says so when what was typed is not a UK mobile, and sends nothing', async () => {
    const before = deps.texts.sent.length;
    for (const typed of ['', 'not a number', '01632 960001', '<b>07700</b>']) {
      const answer = await askForLink(typed);
      expect(answer.status).toBe(400);
      const words = await answer.text();
      expect(words).toContain('That doesn’t look like a UK mobile number. Please check it.');
      expect(words).not.toContain('<b>07700');
    }
    expect(deps.texts.sent.length).toBe(before);
  });

  it('sends one owner no more than 3 links in an hour and 10 in a day, and the page says the same', async () => {
    const before = deps.texts.sent.length;
    const pages = new Set<string>();
    for (let hour = 0; hour < 5; hour += 1) {
      for (let ask = 0; ask < 4; ask += 1) {
        pages.add(await (await askForLink(mobile)).text());
      }
      clock.advance(60 * 60_000);
    }
    expect(deps.texts.sent.length - before).toBe(10);
    expect(pages.size).toBe(1);
    clock.advance(24 * 60 * 60_000);
    await askForLink(mobile);
    expect(deps.texts.sent.length - before).toBe(11);
  });

  it('sends no login text while the firm has no agreed words for it, and the record says why', async () => {
    const without = await tidewell(db, '07700 900398', ['login_link']);
    const [owner] = await listOwners(db, without);
    if (owner === undefined) throw new Error('No owner');
    await setOwnerMobile(db, without, owner.id, ukMobile('07700 900598'), { kind: 'frontline' });
    const before = deps.texts.sent.length;
    await askForLink('07700 900598');
    expect(deps.texts.sent.length).toBe(before);
    expect(await listMessagesBetween(db, without, ...allTime)).toMatchObject([{ kind: 'login_link', state: 'not_sent', reason: 'no_wording' }]);
  });

  it('sends no login text while this copy has no address for the app, and the record says why', async () => {
    const before = deps.texts.sent.length;
    const noAddress = createApp(() => ({ ...deps, appAddress: null }));
    const init = form({ mobile });
    await noAddress.request('http://localhost/login', { ...init, headers: { ...(init.headers as Record<string, string>), Origin: 'http://localhost' } }, env);
    expect(deps.texts.sent.length).toBe(before);
    expect(await listMessagesBetween(db, firm, ...allTime)).toMatchObject([{ kind: 'login_link', state: 'not_sent', reason: 'no_link_address' }]);
  });

  it('refuses a form posted from another site', async () => {
    const before = deps.texts.sent.length;
    const init = form({ mobile });
    for (const origin of ['https://elsewhere.example', null]) {
      const headers = { ...(init.headers as Record<string, string>) };
      if (origin === null) delete headers.Origin;
      else headers.Origin = origin;
      expect((await open('/login', { ...init, headers })).status).toBe(403);
    }
    expect(deps.texts.sent.length).toBe(before);
  });

  it('keeps each firm’s words for the text as the firm agreed them', async () => {
    await setWording(db, firm, 'text:login_link', 'Front-line: log in here: {link}', { kind: 'frontline' }, await agreedByOwner(db, firm));
    await askForLink(mobile);
    expect(deps.texts.sent[deps.texts.sent.length - 1]?.body).toMatch(/^Front-line: log in here: https:\/\/app\.example\/in\/[0-9a-z]{26}$/);
  });
});

describe('the link', () => {
  it('opens a page with one button, which changes nothing, so a link preview cannot use it up', async () => {
    await askForLink(mobile);
    const link = lastLink();
    for (let preview = 0; preview < 3; preview += 1) {
      const page = await open(link);
      expect(page.status).toBe(200);
      expect(page.headers.get('Set-Cookie')).toBeNull();
      const words = await page.text();
      expect(words).toContain('<form method="post"><button class="btn btn-ink btn-lg btn-block" type="submit" data-busy="Logging in…">Log in</button></form>');
    }
    expect(await historyKinds(env.DB, firm)).not.toHaveProperty('logged_in');
    const answer = await open(link, form({}));
    expect(answer.status).toBe(303);
    expect(answer.headers.get('Location')).toBe('/');
  });

  it('logs in once with the tap, with a cookie only this address gets, over https only, that no script can read', async () => {
    await askForLink(mobile);
    const link = lastLink();
    const answer = await open(link, form({}));
    const cookie = answer.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^__Host-login=[0-9a-z]{26};/);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain(`Max-Age=${String(LOGIN_LASTS.longest / 1000)}`);
    expect(await historyKinds(env.DB, firm)).toMatchObject({ logged_in: 1 });

    // Used up: a second tap, or a second opening, finds an expired link.
    const again = await open(link, form({}));
    expect(again.status).toBe(404);
    expect(await again.text()).toContain('This link has expired');
    expect((await open(link)).status).toBe(404);
    expect(await historyKinds(env.DB, firm)).toMatchObject({ logged_in: 1 });
  });

  it('logs in only once when tapped twice at the same moment', async () => {
    await askForLink(mobile);
    const link = lastLink();
    const answers = await Promise.all([open(link, form({})), open(link, form({})), open(link, form({}))]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([303, 404, 404]);
    expect(await historyKinds(env.DB, firm)).toMatchObject({ logged_in: 1 });
  });

  it('has expired after 15 minutes', async () => {
    await askForLink(mobile);
    const link = lastLink();
    clock.advance(LOGIN_LINK_LASTS);
    expect((await open(link)).status).toBe(404);
    const answer = await open(link, form({}));
    expect(answer.status).toBe(404);
    expect(answer.headers.get('Set-Cookie')).toBeNull();
  });

  it('shows one expired page for a link used, expired or never made, saying nothing about which', async () => {
    const pages = await Promise.all(['/in/0aaaaaaaaaaaaaaaaaaaaaaaaa', '/in/not-a-token', '/in/AAAAAAAAAAAAAAAAAAAAAAAAAA'].map((path) => open(path)));
    const bodies = await Promise.all(pages.map((page) => page.text()));
    for (const [i, page] of pages.entries()) {
      expect(page.status).toBe(404);
      expect(bodies[i]).toBe(bodies[0]);
    }
    expect(bodies[0]).toContain('<a class="btn btn-ink btn-lg btn-block" href="/login">Text me a new link</a>');
  });

  it('refuses a tap posted from another site, and leaves the link to work', async () => {
    await askForLink(mobile);
    const link = lastLink();
    const init = form({});
    const answer = await open(link, { ...init, headers: { ...(init.headers as Record<string, string>), Origin: 'https://elsewhere.example' } });
    expect(answer.status).toBe(403);
    expect((await open(link, form({}))).status).toBe(303);
  });

  it('lands on the job it was asked for from, if it is the firm’s', async () => {
    const customer = await createCustomer(db, firm, { name: 'Mr Price', mobile: ukMobile('07700 900016') });
    const job = await createJob(db, firm, { customer, about: 'Leak under the sink', place: '6 Bridge Street', urgent: true });
    await askForLink(mobile, job);
    expect((await open(lastLink(), form({}))).headers.get('Location')).toBe(`/jobs/${job}`);

    // Another firm's job, or no job at all, lands on Home.
    const other = await tidewell(db, '07700 900397');
    const [someone] = await listOwners(db, other);
    const otherCustomer = await createCustomer(db, other, { name: 'Mr Price', mobile: ukMobile('07700 900016') });
    const otherJob = await createJob(db, other, { customer: otherCustomer, about: 'Leak', place: '6 Bridge Street', urgent: false });
    expect(someone).toBeDefined();
    await askForLink(mobile, otherJob);
    expect((await open(lastLink(), form({}))).headers.get('Location')).toBe('/');
  });
});

describe('a login', () => {
  async function logIn(): Promise<string> {
    await askForLink(mobile);
    return cookieFrom(await open(lastLink(), form({})));
  }

  it('opens the owner’s screens, and without it they go to the login page', async () => {
    const cookie = await logIn();
    expect((await opener(app, cookie)('/')).status).toBe(200);
    const without = await open('/');
    expect(without.status).toBe(303);
    expect(without.headers.get('Location')).toBe('/login');
    const withAnother = await opener(app, '__Host-login=0aaaaaaaaaaaaaaaaaaaaaaaaa')('/');
    expect(withAnother.headers.get('Location')).toBe('/login');
  });

  it('sends a job’s page to the login page keeping the job, so the owner lands on it', async () => {
    const answer = await open('/jobs/0aaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(answer.headers.get('Location')).toBe('/login?job=0aaaaaaaaaaaaaaaaaaaaaaaaa');
    const page = await (await open('/login?job=0aaaaaaaaaaaaaaaaaaaaaaaaa')).text();
    expect(page).toContain('<input type="hidden" name="job" value="0aaaaaaaaaaaaaaaaaaaaaaaaa">');
    // Anything that is not a job's id is not kept.
    expect(await (await open('/login?job=%2F%2Felsewhere.example')).text()).not.toContain('name="job"');
  });

  it('lasts 30 days after it was last used', async () => {
    const cookie = await logIn();
    const asOwner = opener(app, cookie);
    for (let i = 0; i < 3; i += 1) {
      clock.advance(LOGIN_LASTS.unused - 60_000);
      expect((await asOwner('/')).status).toBe(200);
    }
    clock.advance(LOGIN_LASTS.unused);
    expect((await asOwner('/')).status).toBe(303);
  });

  it('lasts no more than 90 days, however often it is used', async () => {
    const cookie = await logIn();
    const asOwner = opener(app, cookie);
    const day = 24 * 60 * 60_000;
    // Used every 20 days, up to the day before the 90th.
    for (let days = 20; days < 90; days += 20) {
      clock.advance(20 * day);
      expect((await asOwner('/')).status).toBe(200);
    }
    clock.advance(89 * day - 80 * day);
    expect((await asOwner('/')).status).toBe(200);
    clock.advance(day);
    expect((await asOwner('/')).status).toBe(303);
  });

  it('ends when the owner logs out, which is recorded', async () => {
    const cookie = await logIn();
    const asOwner = opener(app, cookie);
    const answer = await asOwner('/logout', form({}));
    expect(answer.status).toBe(303);
    expect(answer.headers.get('Location')).toBe('/login');
    expect(answer.headers.get('Set-Cookie')).toMatch(/^__Host-login=;/);
    expect((await asOwner('/')).status).toBe(303);
    expect(await historyKinds(env.DB, firm)).toMatchObject({ logged_in: 1, logged_out: 1 });
  });

  it('logs no mobile, name or token: ids only', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(line));
    try {
      const cookie = await logIn();
      await opener(app, cookie)('/logout', form({}));
      await askForLink('07700 900999');
    } finally {
      spy.mockRestore();
    }
    const logged = lines.join('\n');
    expect(logged).toContain('"event":"logged_in"');
    expect(logged).not.toMatch(/7700|Tom|Tidewell|__Host|https?:/);
  });
});

describe('the address', () => {
  it('answers the owner’s pages only at the app’s address, not at the one for customers’ links', async () => {
    const atLinks = await app.request('https://links.example/login', {}, env);
    expect(atLinks.status).toBe(404);
    expect((await app.request(`${APP_ADDRESS}/login`, {}, env)).status).toBe(200);
  });
});

// The owner's screens (slice F of docs/build-brief.md), drawn from the record
// for the demo firm on the example's "today", Thursday 15 October 2026 at
// 4pm, in the example's structure and words. A second firm of the same shape
// shows that a screen shows only the logged-in firm's records, and that the
// badge, the services and the rules come from each firm's own record.

import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { runDue } from '../src/due';
import { loadExample } from '../src/example/load';
import { ukLandline, ukMobile } from '../src/phone';
import {
  addDue,
  createCustomer,
  createFirm,
  createJob,
  createOwner,
  createVisit,
  findCustomersByMobile,
  listJobs,
  listJobsForCustomer,
  listVisitsForJob,
  setService,
} from '../src/record';
import { openRecord } from '../src/record/db';
import type { FirmId, JobId } from '../src/record/types';
import { firmRows, historyKinds } from './helpers/db';
import { testDeps } from './helpers/deps';
import { feedOf, form, opener, ownerCookie, rowsOf } from './helpers/owner';
import { report, send, withDetails } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-10-15T16:00:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);
const app = createApp(() => deps);
const frontline = { kind: 'frontline' } as const;

let tidewell: FirmId;
let second: FirmId;
let asTom: ReturnType<typeof opener>;
let asSecond: ReturnType<typeof opener>;

beforeAll(async () => {
  tidewell = await loadExample(env.DB);
  second = await loadExample(env.DB, { name: 'Second Example Firm', isExample: false, number: '07700 900200' });
  asTom = opener(app, await ownerCookie(db, tidewell));
  asSecond = opener(app, await ownerCookie(db, second));
});

async function page(path: string, as = asTom): Promise<string> {
  const answer = await as(path);
  expect(answer.status, path).toBe(200);
  return answer.text();
}

/** The job of the firm's customer on this mobile. */
async function jobOf(firm: FirmId, mobile: string): Promise<JobId> {
  const [customer] = await findCustomersByMobile(db, firm, ukMobile(mobile));
  const [job] = customer === undefined ? [] : await listJobsForCustomer(db, firm, customer.id);
  if (job === undefined) throw new Error('No job');
  return job.id;
}

describe('every screen', () => {
  it.each(['/', '/calls', '/jobs', '/done', '/rules', '/message'])(
    '%s tells search engines to keep out, browsers not to keep it, and runs only the app’s own script',
    async (path) => {
      const answer = await asTom(path);
      expect(answer.status).toBe(200);
      expect(answer.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
      expect(answer.headers.get('Cache-Control')).toBe('no-store');
      expect(answer.headers.get('Referrer-Policy')).toBe('same-origin');
      const policy = answer.headers.get('Content-Security-Policy') ?? '';
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("script-src 'self'");
      expect(policy).toContain("form-action 'self'");
      const words = await answer.text();
      expect(words).toContain('<meta name="robots" content="noindex, nofollow">');
      // The example's look, and nothing loaded from elsewhere.
      expect(words).toContain('--cream:#FBF4EB');
      expect(words).toContain('<script src="/app.js" defer></script>');
      expect(words).not.toMatch(/(src|href)="https?:/);
    },
  );

  it('has the side menu for a laptop: Home, the services shown, All jobs, Your rules and Message us', async () => {
    const words = await page('/jobs');
    const menu = /<aside class="side" aria-label="Menu">([\s\S]*?)<\/aside>/.exec(words)?.[1] ?? '';
    expect([...menu.matchAll(/<a class="(?:nav|btn[^"]*)" href="([^"]+)"/g)].map(([, href]) => href)).toEqual([
      '/',
      '/calls',
      '/jobs',
      '/rules',
      '/message?from=jobs',
    ]);
    expect(menu).toContain('<a class="nav" href="/jobs" aria-current="page">');
    expect(menu).toContain('<span>Tidewell Heating</span><span class="badge">Example</span>');
  });

  it('serves the app’s script, which sends nothing anywhere', async () => {
    const answer = await asTom('/app.js');
    expect(answer.headers.get('Content-Type')).toMatch(/^text\/javascript/);
    const script = await answer.text();
    expect(script).toContain('history.back()');
    expect(script).not.toMatch(/fetch|XMLHttpRequest|sendBeacon|localStorage|https?:/);
  });
});

describe('Home', () => {
  it('shows the firm with its "Example" badge, today, and the example’s blocks, drawn from the record', async () => {
    const words = await page('/');
    expect(words).toContain('<div class="firm"><h1>Tidewell Heating</h1><span class="badge">Example</span></div>');
    expect(words).toContain('<p class="meta">Thursday 15 October</p>');
    expect(words).toContain('<h2>Needs your OK</h2></div><div class="card"><p class="empty">Nothing needs you right now.</p></div>');
    expect(words).toContain('<a class="link" href="/done">See all 8</a>');
    expect(feedOf(words)).toEqual([
      '15:31 Booked Mr Evans’s install for Tuesday, 8:30am.',
      '11:02 Call from Mr Price. Passed straight to you.',
      '11:02 Call from Mr Price answered.',
    ]);
    expect(rowsOf(words)).toEqual(['Calls & bookings / 3 answered today', 'Your rules / Prices, wording and times']);
    expect(words).toContain('<form method="post" action="/logout"><button class="link" type="submit">Log out</button></form>');
    // Release 1 has no money and nothing for the owner to send in.
    expect(words.split('</style>')[1]).not.toMatch(/Money|Quoted|Send a voice note|Play the example job|Example settings/);
  });

  it('shows another firm’s own name, with no badge for a firm that is not an example', async () => {
    const words = await page('/', asSecond);
    expect(words).toContain('<div class="firm"><h1>Second Example Firm</h1></div>');
    expect(words).not.toContain('Tidewell Heating');
    expect(words).not.toContain('class="badge"');
  });

  it('says so when nothing has been done today yet', async () => {
    const quiet = await createFirm(db, { name: 'Quiet Heating', isExample: false });
    await createOwner(db, quiet, { name: 'Sam', mobile: ukMobile('07700 900301') });
    const words = await page('/', opener(app, await ownerCookie(db, quiet)));
    expect(words).toContain('<h2>Done for you today</h2></div><p class="empty">Nothing yet today.</p>');
    expect(words).not.toContain('See all');
    // Calls & bookings is off for a new firm, so neither its row nor its menu item is there.
    expect(words).not.toContain('Calls &amp; bookings');
  });
});

describe('a service switched off', () => {
  it('is not shown on Home or in the menu, and its screen is not found', async () => {
    const firm = await createFirm(db, { name: 'Off Heating', isExample: false });
    await createOwner(db, firm, { name: 'Sam', mobile: ukMobile('07700 900302') });
    await setService(db, firm, 'calls', true, frontline);
    const as = opener(app, await ownerCookie(db, firm));
    expect(await page('/', as)).toContain('href="/calls"');
    expect((await as('/calls')).status).toBe(200);

    await setService(db, firm, 'calls', false, frontline);
    const home = await page('/', as);
    expect(home).not.toContain('href="/calls"');
    expect(home).not.toContain('Calls &amp; bookings');
    expect(await page('/rules', as)).not.toContain('Calls &amp; bookings');
    const calls = await as('/calls');
    expect(calls.status).toBe(404);
    expect(await calls.text()).toContain('<h1>Not found</h1>');
  });

  it('shows no service the app has no screen for yet, even switched on', async () => {
    const firm = await createFirm(db, { name: 'Quotes Heating', isExample: false });
    await createOwner(db, firm, { name: 'Sam', mobile: ukMobile('07700 900303') });
    await setService(db, firm, 'quotes', true, frontline);
    const home = await page('/', opener(app, await ownerCookie(db, firm)));
    expect(home).not.toContain('<span>Quotes</span>');
    expect(home).not.toContain('href="/quotes"');
  });
});

describe('Calls & bookings', () => {
  it('shows the demo firm’s day in the example’s look and words, each call and visit leading to its job', async () => {
    const words = await page('/calls');
    expect(words).toContain('<a class="back" href="/">');
    expect(words).toContain('<h1>Calls &amp; bookings</h1><p class="meta">3 calls answered today.</p>');
    expect(words).toContain('<h2>Today’s calls</h2>');
    expect(words).toContain('<h2>Coming up</h2>');
    expect(rowsOf(words)).toEqual([
      'Mr Price · 11:02 / A leak under the kitchen sink. Passed straight to you. [Passed to you]',
      'A supplier · 08:26 / Your order is ready to collect. Message taken.',
      'Mrs Green · 08:10 / No hot water. Quote visit booked for Monday, 9am. [Booked]',
      'Fri 16 Oct, 10:00 / Mr Clarke · Quote visit',
      'Mon 19 Oct, 09:00 / Mrs Green · Quote visit',
      'Tue 20 Oct, 08:30 / Mr Evans · Boiler install',
      'Wed 21 Oct, 14:00 / Mrs Reid · Boiler service',
    ]);
    expect(words).toContain(`<a class="row" href="/jobs/${await jobOf(tidewell, '07700 900016')}">`);
    // The supplier has no job, so their row leads nowhere.
    expect(words).toContain('<div class="row"><span class="txt"><span class="t1">A supplier · 08:26</span>');
  });

  it('shows a new call once its report has landed, and a call with its details missing by its number', async () => {
    const firm = await loadExample(env.DB, { name: 'Third Example Firm', isExample: true, number: '07700 900203' });
    const as = opener(app, await ownerCookie(db, firm));
    expect((await send(app, report('landline-caller', '+447700900203'))).status).toBe(200);
    expect((await send(app, report('hang-up', '+447700900203'))).status).toBe(200);
    const words = await page('/calls', as);
    expect(words).toContain('5 calls answered today.');
    expect(rowsOf(words).slice(0, 2)).toEqual([
      '07700 900400 · 15:41 / Details missing.',
      'Mrs Hall · 14:47 / Boiler due a service before the winter. Message taken.',
    ]);
    expect(feedOf(await page('/done', as))).toContain('16:00 Call from 07700 900400. Details missing.');
  });

  it('shows what a caller said as plain text, never as part of the page', async () => {
    const firm = await loadExample(env.DB, { name: 'Fourth Example Firm', isExample: true, number: '07700 900204' });
    const as = opener(app, await ownerCookie(db, firm));
    await send(app, withDetails(report('withheld-caller', '+447700900204'), (data) => ({ ...data, name: 'Ms <b>Rowe</b>' })));
    const words = await page('/calls', as);
    expect(words).toContain('Ms &lt;b&gt;Rowe&lt;/b&gt; · 15:20');
    expect(words).not.toContain('<b>Rowe');
  });

  it('says so when nothing is booked yet', async () => {
    const firm = await createFirm(db, { name: 'Empty Heating', isExample: false });
    await createOwner(db, firm, { name: 'Sam', mobile: ukMobile('07700 900304') });
    await setService(db, firm, 'calls', true, frontline);
    const words = await page('/calls', opener(app, await ownerCookie(db, firm)));
    expect(words).toContain('<p class="meta">No calls yet today.</p>');
    expect(words).toContain('<p class="empty">Nothing booked yet.</p>');
  });
});

describe('a job’s page', () => {
  it('shows who and what, its state, and everything so far by day, with who did each thing', async () => {
    const words = await page(`/jobs/${await jobOf(tidewell, '07700 900015')}`);
    expect(words).toContain('<a class="back" href="/jobs">');
    expect(words).toContain('<h1>Mrs Green</h1><p class="meta">No hot water · 24 Beech Avenue</p><span class="chip chip-good">');
    expect(words).toContain('Booked</span>');
    expect(timeline(words)).toEqual([
      'Today',
      'Front-line 08:10 Answered the call.',
      'Front-line 08:10 Quote visit booked for Monday, 9am.',
      'Front-line 08:11 Sent a confirmation.',
    ]);
  });

  it('says what happens next: the job is with the owner, or a reminder is waiting', async () => {
    const price = await page(`/jobs/${await jobOf(tidewell, '07700 900016')}`);
    expect(price).toContain('<h2>What happens next</h2></div><div class="card pad"><p>This one is with you. Tell us what happened and we take it from there.</p></div>');
    expect(price).toContain('Passed to you</span>');

    const customer = await createCustomer(db, tidewell, { name: 'Mr Lane', mobile: ukMobile('07700 900030') });
    const job = await createJob(db, tidewell, { customer, about: 'Boiler service', place: '1 Lane End', urgent: false });
    const visit = await createVisit(db, tidewell, { job, startsAt: instantFromIso('2026-10-22T10:00:00+01:00'), kind: 'service' });
    expect(await page(`/jobs/${job}`)).not.toContain('What happens next');
    await addDue(db, tidewell, {
      action: 'send_reminder',
      visit,
      runAt: instantFromIso('2026-10-21T13:00:00+01:00'),
      latestAt: instantFromIso('2026-10-22T00:00:00+01:00'),
    });
    expect(await page(`/jobs/${job}`)).toContain('<p>We send a reminder the day before the visit.</p>');
  });

  it('says when a text did not reach the customer, in the error colour, where it happened', async () => {
    const clarke = await jobOf(tidewell, '07700 900005');
    const [visit] = await listVisitsForJob(db, tidewell, clarke);
    if (visit === undefined) throw new Error('No visit');
    const due = await addDue(db, tidewell, { action: 'send_reminder', visit: visit.id, runAt: clock.now(), latestAt: clock.now() });
    deps.texts.willAnswer('refused');
    await runDue(db, deps, tidewell, due);
    const words = await page(`/jobs/${clarke}`);
    expect(words).toContain(
      '<li class="tl-bad"><div class="tl-top"><span class="who who-fl">Front-line</span><time>16:00</time></div><span>The reminder did not reach them. We are looking into it.</span></li>',
    );
  });

  it('says when no text can reach a customer who rang from a landline', async () => {
    const customer = await createCustomer(db, tidewell, { name: 'Mrs Hall', mobile: null, landline: ukLandline('01632 960001'), noText: 'landline' });
    const job = await createJob(db, tidewell, { customer, about: 'Boiler service', place: '12 Kiln Lane', urgent: false });
    const visit = await createVisit(db, tidewell, { job, startsAt: instantFromIso('2026-10-23T10:00:00+01:00'), kind: 'quote_visit' });
    const due = await addDue(db, tidewell, { action: 'send_confirmation', visit, runAt: clock.now(), latestAt: clock.now() });
    await runDue(db, deps, tidewell, due);
    expect(timeline(await page(`/jobs/${job}`))).toContain('Front-line 16:00 No text can reach them: they rang from a landline.');
  });

  it('is not found for another firm’s job, the same as for one that never was, and changes nothing', async () => {
    const jobOfTidewell = await jobOf(tidewell, '07700 900015');
    const before = await firmRows(env.DB, tidewell);
    const answers = [await asSecond(`/jobs/${jobOfTidewell}`), await asSecond('/jobs/0aaaaaaaaaaaaaaaaaaaaaaaaa'), await asSecond('/jobs/not-a-job')];
    const bodies = await Promise.all(answers.map((answer) => answer.text()));
    for (const [i, answer] of answers.entries()) {
      expect(answer.status).toBe(404);
      expect(bodies[i]).toBe(bodies[0]);
    }
    expect(bodies[0]).not.toContain('Mrs Green');
    expect(await firmRows(env.DB, tidewell)).toEqual(before);
  });
});

describe('All jobs', () => {
  it('lists every job, newest first, with what, where and its state', async () => {
    const rows = rowsOf(await page('/jobs', asSecond));
    expect(rows).toHaveLength(16);
    expect(rows).toContain('Mr Price / Leak under the sink · 6 Bridge Street [Passed to you]');
    expect(rows).toContain('Mrs Green / No hot water · 24 Beech Avenue [Booked]');
    expect(rows).toContain('Mr Davies / Boiler service · 19 Elm Grove [On today]');
    expect(rows).toContain('Mr Wood / Cylinder replacement · 5 High Street');
  });

  it('finds a job by the customer’s name, what it is, or the street, in any capitals', async () => {
    expect(rowsOf(await page('/jobs?q=BEECH', asSecond))).toEqual(['Mrs Green / No hot water · 24 Beech Avenue [Booked]']);
    expect(rowsOf(await page('/jobs?q=mr%20price', asSecond))).toEqual(['Mr Price / Leak under the sink · 6 Bridge Street [Passed to you]']);
    expect(rowsOf(await page('/jobs?q=cylinder', asSecond)).map((row) => row.split(' / ')[0])).toEqual(expect.arrayContaining(['Mr Wood', 'Mr Turner']));
    const none = await page('/jobs?q=zzz', asSecond);
    expect(rowsOf(none)).toEqual([]);
    expect(none).toContain('<p class="empty" id="fl-none">No job or customer matches that.</p>');
    expect(none).toContain('value="zzz"');
  });

  it('keeps what was searched for as words, never as part of the page', async () => {
    const words = await page('/jobs?q=%22%3E%3Cscript%3E', asSecond);
    expect(words).toContain('value="&quot;&gt;&lt;script&gt;"');
    expect(words).not.toContain('"><script>');
  });

  it('says so when the firm has no jobs yet', async () => {
    const firm = await createFirm(db, { name: 'New Heating', isExample: false });
    await createOwner(db, firm, { name: 'Sam', mobile: ukMobile('07700 900305') });
    const words = await page('/jobs', opener(app, await ownerCookie(db, firm)));
    expect(words).toContain('<p class="empty">No jobs yet. Calls we answer for you show up here.</p>');
  });

  it('shows only the firm’s own jobs', async () => {
    const words = await page('/jobs', asSecond);
    for (const job of await listJobs(db, tidewell)) {
      expect(words).not.toContain(job.id);
    }
  });
});

describe('Done for you', () => {
  it('shows today and yesterday, newest first, with how many, each line leading to its job', async () => {
    const words = await page('/done', asSecond);
    expect(words).toContain('<h1>Done for you</h1><p class="meta">Everything Front-line did in your name.</p>');
    expect(words).toContain('<h2>Today</h2><span class="count">8</span>');
    expect(feedOf(words)).toEqual(
      expect.arrayContaining(['08:26 Call from a supplier. Your order is ready to collect.', '08:11 Sent Mrs Green a confirmation.']),
    );
    expect(words).toContain(`<a class="fb" href="/jobs/${await jobOf(second, '07700 900015')}">`);
    // The supplier's call has no job.
    expect(words).toContain('<li><div class="fb">');
    expect(words).toMatch(/<h2>Yesterday<\/h2><span class="count">\d+<\/span>/);
  });
});

describe('Your rules', () => {
  it('shows the firm’s rules from its record, and how texts reach customers, with no WhatsApp', async () => {
    const words = await page('/rules');
    expect(words).toContain('<h1>Your rules</h1><p class="meta">We set these up with you. To change one, tell us.</p>');
    const ticks = [...words.matchAll(/<li><svg[^>]*><use[^>]*><\/use><\/svg><span>(.*?)<\/span><\/li>/g)].map(([, line]) => line);
    expect(ticks).toEqual([
      'We answer when you can’t pick up.',
      'Quote visits go in Monday to Friday, 8am to 4pm.',
      'Anything urgent, like a leak, comes straight to you.',
      'They go by text from your own number, in your name.',
      'No texts go to customers between 8pm and 8am.',
    ]);
    expect(words).not.toMatch(/WhatsApp/i);
    expect(words).toContain('<a class="btn btn-line btn-lg" href="/message?from=rules">');
  });
});

describe('Message us', () => {
  it('opens over the screen it came from, and Close goes back to it', async () => {
    const words = await page('/message?from=rules');
    expect(words).toContain('<div class="sheet-wrap"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="fl-sheet-h">');
    expect(words).toContain('<h2 id="fl-sheet-h" tabindex="-1">Message Sophie or Greg</h2><a class="x" href="/rules" aria-label="Close">');
    expect(words).toContain('<h1>Your rules</h1>');
    expect(words).toContain('<main class="main" inert>');
    expect(words).toContain('<label for="fl-msg">What do you need?</label>');
    // Anything else it was opened from is Home.
    expect(await page('/message?from=elsewhere')).toContain('<a class="x" href="/" aria-label="Close">');
  });

  it('keeps what the owner wrote, as written, with who wrote it, and says who will come back', async () => {
    const firm = await loadExample(env.DB, { name: 'Fifth Example Firm', isExample: true, number: '07700 900205' });
    const as = opener(app, await ownerCookie(db, firm));
    const answer = await as('/message?from=home', form({ words: '  Put my day rate up to £320 from Monday.  ' }));
    expect(answer.status).toBe(200);
    const words = await answer.text();
    expect(words).toContain('<p>Sophie or Greg will come back to you.</p>');
    expect(words).toContain('<a class="btn btn-ink btn-lg btn-block" href="/">Done</a>');
    const rows = await firmRows(env.DB, firm);
    expect(rows.owner_messages).toMatchObject([{ words: 'Put my day rate up to £320 from Monday.' }]);
    expect(await historyKinds(env.DB, firm)).toMatchObject({ owner_message_sent: 1 });
  });

  it('asks again when nothing was written, and keeps nothing', async () => {
    const firm = await loadExample(env.DB, { name: 'Sixth Example Firm', isExample: true, number: '07700 900206' });
    const as = opener(app, await ownerCookie(db, firm));
    const answer = await as('/message', form({ words: '   ' }));
    expect(answer.status).toBe(400);
    expect(await answer.text()).toContain('<p class="problem" role="alert">Please write what you need.</p>');
    expect((await firmRows(env.DB, firm)).owner_messages).toEqual([]);
  });

  it('refuses a message posted from another site, or with no login', async () => {
    const firm = await loadExample(env.DB, { name: 'Seventh Example Firm', isExample: true, number: '07700 900207' });
    const as = opener(app, await ownerCookie(db, firm));
    const init = form({ words: 'Hello' });
    expect((await as('/message', { ...init, headers: { ...(init.headers as Record<string, string>), Origin: 'https://elsewhere.example' } })).status).toBe(403);
    expect((await opener(app, null)('/message', init)).status).toBe(303);
    expect((await firmRows(env.DB, firm)).owner_messages).toEqual([]);
  });
});

/** A job page's history as the owner reads it: the day, then "who time line". */
function timeline(page: string): string[] {
  const out: string[] = [];
  for (const [, day, items] of page.matchAll(/<p class="day">(.*?)<\/p><ul class="tl">(.*?)<\/ul>/g)) {
    out.push(day ?? '');
    for (const [, who, time, line] of (items ?? '').matchAll(/<span class="who [^"]*">(.*?)<\/span><time>(.*?)<\/time><\/div><span>(.*?)<\/span>/g)) {
      out.push(`${who ?? ''} ${time ?? ''} ${line ?? ''}`);
    }
  }
  return out;
}

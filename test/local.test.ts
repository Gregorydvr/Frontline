import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { createLocalApp } from '../src/local';
import { exampleFirms, listCustomers } from '../src/record';
import { openRecord } from '../src/record/db';
import { testDeps } from './helpers/deps';
import { report, send } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-10-15T16:00:00+01:00'));
const db = openRecord(env.DB, clock);
const deps = testDeps(clock);

describe('the version for this machine', () => {
  it('loads the demo firm the first time it is used, once, however many requests arrive', async () => {
    const app = createLocalApp(() => deps);
    expect(await exampleFirms(db)).toEqual([]);

    const answers = await Promise.all([
      app.request('/health', {}, env),
      app.request('/health', {}, env),
      app.request('/health', {}, env),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);

    const firms = await exampleFirms(db);
    expect(firms).toHaveLength(1);
    expect(await listCustomers(db, firms[0] as never)).toHaveLength(16);

    // A second app, as after a restart, finds it there.
    await createLocalApp(() => deps).request('/health', {}, env);
    expect(await exampleFirms(db)).toEqual(firms);
  });

  it('shows the demo firm in plain text at /local/example', async () => {
    const app = createLocalApp(() => deps);
    const answer = await app.request('/local/example', {}, env);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Content-Type')).toMatch(/^text\/plain/);
    const text = await answer.text();

    expect(text).toContain('Tidewell Heating (example)\nOwner: Tom\n');
    expect(text).toContain(
      'Services on: Calls & bookings\nStop button: off\n',
    );
    expect(text).toContain('As it stands on Thursday 15 October 2026 at 16:00.');
    expect(text).toContain(
      [
        'Mrs Green · No hot water · 24 Beech Avenue',
        'Booked',
        '  Thu 15 Oct  08:10  Front-line: Answered the call.',
        '  Thu 15 Oct  08:10  Front-line: Quote visit booked for Monday, 9am.',
        '  Thu 15 Oct  08:11  Front-line: Sent a confirmation.',
      ].join('\n'),
    );
    expect(text).toContain('Mr Price · Leak under the sink · 6 Bridge Street\nPassed to you\n');
    expect(text).toContain('Mr Wood · Cylinder replacement · 5 High Street\n(no state yet)\n');
    expect(text).toContain(
      [
        'DONE FOR YOU ON THURSDAY 15 OCTOBER 2026',
        '',
        '  15:31  Booked Mr Evans’s install for Tuesday, 8:30am.',
        '  11:02  Call from Mr Price. Passed straight to you.',
        '  11:02  Call from Mr Price answered.',
        '  08:34  Booked Mr Clarke’s quote visit for Friday, 10am.',
        '  08:26  Call from a supplier. Your order is ready to collect.',
        '  08:11  Sent Mrs Green a confirmation.',
        '  08:10  Booked Mrs Green’s quote visit for Monday, 9am.',
        '  08:10  Call from Mrs Green answered.',
      ].join('\n'),
    );
  });
});

describe('logging in on this machine', () => {
  const app = createLocalApp(() => deps);

  it('shows a button at /local/login that posts back to it', async () => {
    const answer = await app.request('/local/login', {}, env);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain('<form method="post">');
  });

  it('sends Tom a login link through the stand-in, shows it, and the link logs him in to the demo firm', async () => {
    clock.set(instantFromIso('2026-10-15T16:00:00+01:00'));
    const before = deps.texts.sent.length;
    const answer = await app.request('/local/login', { method: 'POST' }, env);
    expect(answer.status).toBe(200);
    const words = await answer.text();
    expect(deps.texts.sent.slice(before)).toMatchObject([{ to: '+447700900101' }]);
    const link = /href="(https:\/\/app\.example\/in\/[0-9a-z]{26})"/.exec(words)?.[1];
    if (link === undefined) throw new Error('No link');
    expect(words).toContain('Front-line: here is your link to log in.');
    const tapped = await app.request(link, { method: 'POST', headers: { Origin: 'https://app.example' }, redirect: 'manual' }, env);
    expect(tapped.status).toBe(303);
    const cookie = (tapped.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
    const home = await app.request('https://app.example/', { headers: { Cookie: cookie } }, env);
    expect(await home.text()).toContain('<h1>Tidewell Heating</h1><span class="badge">Example</span>');
  });
});

describe('texts on this machine', () => {
  const app = createLocalApp(() => deps);

  it('lists the demo firm’s texts from the record: an urgent call’s alert to Tom, through the stand-in', async () => {
    const before = deps.texts.sent.length;
    expect((await send(app, report('mr-price-leak'))).status).toBe(200);
    const answer = await app.request('/local/texts', {}, env);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(await answer.text()).toContain(
      [
        'Thu 15 Oct  16:00  urgent_alert to the owner, Tom: sent',
        '    Front-line: urgent call from Mr Price, 6 Bridge Street. A leak under the kitchen sink. Their number: 07700 900016. https://app.example/jobs/',
      ].join('\n'),
    );
    expect(deps.texts.sent.length).toBe(before + 1);
  });
});

describe('playing a booking call on this machine', () => {
  const app = createLocalApp(() => deps);

  it('shows a button at /local/book that posts back to it', async () => {
    const answer = await app.request('/local/book', {}, env);
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain('<form method="post">');
    expect(answer.headers.get('Content-Security-Policy')).toContain("form-action 'self'");
  });

  it('books Mrs Ahmed a quote visit through the real addresses, sends her confirmation, and gives her link, which opens her page', async () => {
    // A weekday morning, so the text is not held for quiet hours.
    clock.set(instantFromIso('2026-10-15T10:00:00+01:00'));
    const answer = await app.request('/local/book', { method: 'POST' }, env);
    expect(answer.status).toBe(200);
    const words = await answer.text();
    expect(words).toContain('Quote visit booked for Friday 16 October at 8am. Her confirmation: sent.');
    const link = /href="(https:\/\/links\.example\/d\/[0-9a-z]{26})"/.exec(words)?.[1];
    if (link === undefined) throw new Error('No link');
    const page = await app.request(link, {}, env);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('value="Mrs Ahmed"');
  });
});

describe('the deployed version', () => {
  it('has no /local/example, /local/login, /local/texts or /local/book page and does not load the demo firm', async () => {
    const before = await exampleFirms(db);
    for (const path of ['/local/example', '/local/login', '/local/texts', '/local/book']) {
      const answer = await exports.default.fetch(`http://localhost${path}`);
      expect(answer.status).toBe(404);
    }
    expect(await exampleFirms(db)).toEqual(before);
  });
});

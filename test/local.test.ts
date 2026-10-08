import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { createLocalApp } from '../src/local';
import { exampleFirms, listCustomers } from '../src/record';
import { openRecord } from '../src/record/db';
import { testDeps } from './helpers/deps';
import { report, send, withDetails } from './helpers/vapi';

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
      'Services on: Calls & bookings, Quotes, Follow-ups, Job paperwork, Invoices & reminders\nStop button: off\n',
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

/** The rows of a Calls & bookings page, as the owner reads them. */
function rowsOf(page: string): string[] {
  return [...page.matchAll(/<div class="row"><span class="txt">(.*?)<\/span><\/div>/g)].map(([, row]) =>
    (row ?? '')
      .replace(/<span class="chip[^"]*">(.*?)<\/span>/g, ' [$1]')
      .replace(/<span class="t2">/g, ' / ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&'),
  );
}

describe('Calls & bookings on this machine', () => {
  const app = createLocalApp(() => deps);

  it('shows the demo firm’s day in the example’s look and words', async () => {
    const answer = await app.request('/local/calls', {}, env);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Content-Type')).toMatch(/^text\/html/);
    const page = await answer.text();

    expect(page).toContain('<h1>Calls &amp; bookings</h1><p class="meta">3 calls answered today.</p>');
    expect(page).toContain('<h2>Today’s calls</h2>');
    expect(page).toContain('<h2>Coming up</h2>');
    expect(rowsOf(page)).toEqual([
      'Mr Price · 11:02 / A leak under the kitchen sink. Passed straight to you. [Passed to you]',
      'A supplier · 08:26 / Your order is ready to collect. Message taken.',
      'Mrs Green · 08:10 / No hot water. Quote visit booked for Monday, 9am. [Booked]',
      'Fri 16 Oct, 10:00 / Mr Clarke · Quote visit',
      'Mon 19 Oct, 09:00 / Mrs Green · Quote visit',
      'Tue 20 Oct, 08:30 / Mr Evans · Boiler install',
      'Wed 21 Oct, 14:00 / Mrs Reid · Boiler service',
    ]);
    // The example's look, its font and its chips' icons, and nothing from elsewhere.
    expect(page).toContain('--cream:#FBF4EB');
    expect(page).toContain("font-family: 'Archivo'");
    expect(page).toContain('<symbol id="i-alert"');
    expect(page).not.toMatch(/<script|https?:\/\//);
  });

  it('tells search engines to keep out and browsers not to keep a copy', async () => {
    const answer = await app.request('/local/calls', {}, env);
    expect(answer.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    expect(answer.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(await answer.text()).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('shows a new call once its report has landed, and the same report again changes nothing', async () => {
    expect((await send(app, report('landline-caller'))).status).toBe(200);
    expect((await send(app, report('landline-caller'))).status).toBe(200);
    const page = await (await app.request('/local/calls', {}, env)).text();
    expect(page).toContain('4 calls answered today.');
    expect(rowsOf(page)[0]).toBe('Mrs Hall · 14:47 / Boiler due a service before the winter. Message taken.');
  });

  it('shows a call with its details missing by its number', async () => {
    await send(app, report('hang-up'));
    const page = await (await app.request('/local/calls', {}, env)).text();
    expect(rowsOf(page)[0]).toBe('07700 900400 · 15:41 / Details missing.');
  });

  it('shows what a caller said as plain text, never as part of the page', async () => {
    const body = withDetails(report('withheld-caller'), (data) => ({ ...data, name: 'Ms <b>Rowe</b>' }));
    await send(app, body);
    const page = await (await app.request('/local/calls', {}, env)).text();
    expect(page).toContain('Ms &lt;b&gt;Rowe&lt;/b&gt; · 15:20');
    expect(page).not.toContain('<b>Rowe');
  });
});

describe('texts on this machine', () => {
  const app = createLocalApp(() => deps);

  it('lists the demo firm’s texts from the record: an urgent call’s alert is not sent while its words are not agreed', async () => {
    const before = deps.texts.sent.length;
    expect((await send(app, report('mr-price-leak'))).status).toBe(200);
    const answer = await app.request('/local/texts', {}, env);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Content-Type')).toMatch(/^text\/plain/);
    expect(await answer.text()).toContain('Thu 15 Oct  16:00  urgent_alert to the owner, Tom: not_sent (no_wording)\n');
    expect(deps.texts.sent.length).toBe(before);
  });
});

describe('the deployed version', () => {
  it('has no /local/example, /local/calls or /local/texts page and does not load the demo firm', async () => {
    const before = await exampleFirms(db);
    for (const path of ['/local/example', '/local/calls', '/local/texts']) {
      const answer = await exports.default.fetch(`http://localhost${path}`);
      expect(answer.status).toBe(404);
    }
    expect(await exampleFirms(db)).toEqual(before);
  });
});

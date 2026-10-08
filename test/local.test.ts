import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { instantFromIso, pretendClock } from '../src/clock';
import { createLocalApp } from '../src/local';
import { exampleFirms, listCustomers } from '../src/record';
import { openRecord } from '../src/record/db';

const clock = pretendClock(instantFromIso('2026-10-15T16:00:00+01:00'));
const db = openRecord(env.DB, clock);

describe('the version for this machine', () => {
  it('loads the demo firm the first time it is used, once, however many requests arrive', async () => {
    const app = createLocalApp(() => ({ clock }));
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
    await createLocalApp(() => ({ clock })).request('/health', {}, env);
    expect(await exampleFirms(db)).toEqual(firms);
  });

  it('shows the demo firm in plain text at /local/example', async () => {
    const app = createLocalApp(() => ({ clock }));
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
        '  08:11  Sent Mrs Green a confirmation.',
        '  08:10  Booked Mrs Green’s quote visit for Monday, 9am.',
        '  08:10  Call from Mrs Green answered.',
      ].join('\n'),
    );
  });
});

describe('the deployed version', () => {
  it('has no /local/example page and does not load the demo firm', async () => {
    const before = await exampleFirms(db);
    const answer = await exports.default.fetch('http://localhost/local/example');
    expect(answer.status).toBe(404);
    expect(await exampleFirms(db)).toEqual(before);
  });
});

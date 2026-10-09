// The confirm-your-details page a customer opens from the link in their first
// text (slice E). No login: the token is the key, it cannot be guessed, and
// it expires (rule 13 in CLAUDE.md).

import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { historyLine } from '../src/history-lines';
import { ukMobile } from '../src/phone';
import {
  addDue,
  createCustomer,
  createJob,
  createVisit,
  getCustomer,
  getJob,
  historyForCustomer,
  historyForJob,
  linkForDue,
  listCustomers,
} from '../src/record';
import { openRecord } from '../src/record/db';
import { LINK_LASTS } from '../src/record/links';
import type { CustomerId, FirmId, JobId } from '../src/record/types';
import { newId } from '../src/ids';
import { APP_ADDRESS, LINK_ADDRESS, testDeps } from './helpers/deps';
import { firmRows } from './helpers/db';
import { tidewell } from './helpers/vapi';

const clock = pretendClock(instantFromIso('2026-09-28T18:30:00+01:00'));
const db = openRecord(env.DB, clock);
const app = createApp(() => testDeps(clock));

let firm: FirmId;
let customer: CustomerId;
let job: JobId;
let token: string;
let numbers = 800;

beforeEach(async () => {
  clock.set(instantFromIso('2026-09-28T18:30:00+01:00'));
  numbers += 1;
  firm = await tidewell(db, `+447700900${String(numbers)}`);
  customer = await createCustomer(db, firm, { name: 'Mrs Ahmed', mobile: ukMobile('07700 900003'), address: '27 Station Road' });
  job = await createJob(db, firm, { customer, about: 'Boiler replacement', place: '27 Station Road', urgent: false });
  const visit = await createVisit(db, firm, { job, startsAt: instantFromIso('2026-10-01T15:00:00+01:00'), kind: 'quote_visit' });
  const due = await addDue(db, firm, { action: 'send_confirmation', visit, runAt: clock.now(), latestAt: clock.now() });
  token = await linkForDue(db, firm, { due, customer, job });
});

/** Opens the page at the address for customers' links, as a customer does. */
function open(path = `/d/${token}`): Promise<Response> {
  return Promise.resolve(app.request(`${LINK_ADDRESS}${path}`, {}, env));
}

function post(fields: Record<string, string>, path = `/d/${token}`): Promise<Response> {
  const body = new URLSearchParams(fields).toString();
  return Promise.resolve(
    app.request(`${LINK_ADDRESS}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(body.length) }, body }, env),
  );
}

describe('the page', () => {
  it('shows what was taken on the call, and the visit', async () => {
    const page = await open();
    expect(page.status).toBe(200);
    const words = await page.text();
    expect(words).toContain('Tidewell Heating took these down when you rang.');
    expect(words).toContain('value="Mrs Ahmed"');
    expect(words).toContain('value="27 Station Road"');
    expect(words).toContain('Thursday 1 October at 3pm');
    expect(words).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('tells search engines to keep out, browsers not to keep it, and posts only to itself', async () => {
    const page = await open();
    expect(page.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(page.headers.get('Cache-Control')).toBe('no-store');
    expect(page.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(page.headers.get('Content-Security-Policy')).toContain("form-action 'self'");
    expect(page.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('answers only at the address for customers’ links, never at the owner’s app', async () => {
    const atTheApp = await app.request(`${APP_ADDRESS}/d/${token}`, {}, env);
    expect(atTheApp.status).toBe(404);
    expect(await atTheApp.text()).not.toContain('Mrs Ahmed');
    // A copy that serves both from one address, such as this machine, answers at any.
    const oneAddress = createApp(() => ({ ...testDeps(clock), appAddress: LINK_ADDRESS }));
    expect((await oneAddress.request(`http://localhost:8787/d/${token}`, {}, env)).status).toBe(200);
  });

  it('holds nothing personal in its address: only the token', () => {
    expect(token).toMatch(/^[0-9a-z]{26}$/);
  });

  it('shows the one expired page for a link that has expired, never was, or is not a token at all', async () => {
    const pages = [await open(`/d/${newId()}`), await open('/d/mrs-ahmed'), await open(`/d/${token.toUpperCase()}`)];
    clock.advance(LINK_LASTS);
    pages.push(await open());
    const bodies = await Promise.all(pages.map((page) => page.text()));
    for (const [i, page] of pages.entries()) {
      expect(page.status).toBe(404);
      expect(bodies[i]).toBe(bodies[0]);
    }
    expect(bodies[0]).toContain('This link has expired');
    expect(bodies[0]).not.toContain('Mrs Ahmed');
  });

  it('escapes what the customer gave, so it shows as words', async () => {
    await post({ name: '<b>Mrs Ahmed</b>', address: '27 Station Road', email: '' });
    const words = await (await open()).text();
    expect(words).toContain('value="&lt;b&gt;Mrs Ahmed&lt;/b&gt;"');
    expect(words).not.toContain('<b>Mrs Ahmed</b>');
  });
});

describe('saving', () => {
  it('corrects her name, address and email, moves the job with the address, and records it as hers', async () => {
    const saved = await post({ name: 'Mrs S Ahmed', address: '27a Station Road', email: 'ahmed@example.com' });
    expect(saved.status).toBe(200);
    expect(await saved.text()).toContain('Your details are saved. Tidewell Heating can see them now.');
    expect(await getCustomer(db, firm, customer)).toMatchObject({
      name: 'Mrs S Ahmed',
      address: '27a Station Road',
      email: 'ahmed@example.com',
      detailsConfirmedAt: clock.now(),
    });
    expect((await getJob(db, firm, job))?.place).toBe('27a Station Road');
    const [entry] = (await historyForCustomer(db, firm, customer)).filter((one) => one.kind.startsWith('details_'));
    expect(entry).toMatchObject({ kind: 'details_corrected', by: { kind: 'customer' } });
    if (entry === undefined) throw new Error('No entry');
    expect(historyLine(entry, 'feed')).toBe('Mrs S Ahmed corrected their details.');
    // On the job the link is about, where the owner sees it.
    expect((await historyForJob(db, firm, job)).map((one) => historyLine(one, 'job'))).toEqual(['They corrected their details.']);
  });

  it('records her details as confirmed when nothing changed', async () => {
    await post({ name: 'Mrs Ahmed', address: '27 Station Road', email: '' });
    const kinds = (await historyForCustomer(db, firm, customer)).map((one) => one.kind);
    expect(kinds).toEqual(['details_confirmed']);
    expect((await getCustomer(db, firm, customer))?.detailsConfirmedAt).toBe(clock.now());
  });

  it.each([
    ['no name', { name: '  ', address: '27 Station Road', email: '' }, 'Please give your name and the address for the visit.'],
    ['no address', { name: 'Mrs Ahmed', address: '', email: '' }, 'Please give your name and the address for the visit.'],
    ['an email that is not one', { name: 'Mrs Ahmed', address: '27 Station Road', email: 'ahmed at home' }, 'That email address doesn’t look right.'],
  ])('refuses %s, says what is wrong, and changes nothing', async (_, fields, problem) => {
    const before = await firmRows(env.DB, firm);
    const answer = await post(fields);
    expect(answer.status).toBe(400);
    expect(await answer.text()).toContain(problem);
    expect(await firmRows(env.DB, firm)).toEqual(before);
  });

  it('changes nothing through a link that has expired', async () => {
    clock.advance(LINK_LASTS);
    const before = await firmRows(env.DB, firm);
    expect((await post({ name: 'Someone Else', address: '1 Other Road', email: '' })).status).toBe(404);
    expect(await firmRows(env.DB, firm)).toEqual(before);
  });

  it('refuses a form far longer than the page sends', async () => {
    const answer = await post({ name: 'Mrs Ahmed', address: '27 Station Road', email: '', padding: 'x'.repeat(5_000) });
    expect(answer.status).toBe(400);
    expect((await listCustomers(db, firm))[0]?.name).toBe('Mrs Ahmed');
  });
});

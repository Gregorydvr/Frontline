// Every web address the system answers (rule 9 in CLAUDE.md). A route that
// reads or writes a firm's data needs a cross-firm case here, trying the
// other firm's ids. A route not listed fails this test, so a new one cannot
// skip the wall.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instant, instantFromIso, pretendClock } from '../src/clock';
import { loadExample } from '../src/example/load';
import { createLocalApp } from '../src/local';
import { runDue } from '../src/due';
import { ukMobile } from '../src/phone';
import {
  addDue,
  createLoginLink,
  findCustomersByMobile,
  linkForDue,
  listTakenTimes,
  listCallsBetween,
  listCustomers,
  listJobs,
  listJobsForCustomer,
  listOwners,
  listMessagesBetween,
  listTextsInBetween,
  listVisitsForJob,
  setOwnerMobile,
} from '../src/record';
import { openRecord } from '../src/record/db';
import type { FirmId } from '../src/record/types';
import { firmRows } from './helpers/db';
import { LINK_ADDRESS, testDeps } from './helpers/deps';
import { form, opener, ownerCookie } from './helpers/owner';
import { postToTwilioRoute, pretendTwilio, twilioFields } from './helpers/twilio';
import { report, send, sendTool, toolAnswer, toolCall, withDetails } from './helpers/vapi';

/** Routes that take no firm from the request, and why. */
const TAKES_NO_FIRM: Record<string, string> = {
  'GET /health': 'Answers with the version. Holds no firm data.',
  'GET /local/example': 'This machine only. Shows the example firm and takes nothing from the request.',
  'GET /local/login': 'This machine only. Shows a button, and takes nothing from the request.',
  'POST /local/login': 'This machine only. Sends the example firm’s owner a login link, and takes nothing from the request.',
  'GET /app.js': 'The app’s script. The same for everyone, and holds no firm data.',
  'GET /login': 'Shows the form to ask for a link. Holds no firm data; a job named in the address is only written back into the form, unread.',
  'GET /local/texts': 'This machine only. Shows the example firm and takes nothing from the request.',
  'GET /local/book': 'This machine only. Shows a button, and takes nothing from the request.',
  'POST /local/book': 'This machine only. Plays a call to the example firm through the real addresses, and takes nothing from the request.',
};

const clock = pretendClock(instantFromIso('2026-10-15T16:00:00+01:00'));
const pretendDeps = testDeps(clock);
const allTime = [instantFromIso('2000-01-01T00:00:00Z'), instantFromIso('2100-01-01T00:00:00Z')] as const;
const deps = () => pretendDeps;

const db = openRecord(env.DB, clock);
let firms: Promise<{ a: FirmId; b: FirmId }> | null = null;

/**
 * Tidewell Heating and a firm of the same shape, loaded once for every case.
 * The first firm has sent a reminder, so it has a text Twilio could report on.
 */
function twoFirms(): Promise<{ a: FirmId; b: FirmId }> {
  firms ??= (async () => {
    // The first firm is not marked as an example here, so its texts go
    // through Twilio's version, as a real firm's do: an example firm's texts
    // only ever go to the stand-in.
    const a = await loadExample(env.DB, { name: 'Tidewell Heating', isExample: false, number: '07700 900100' });
    const b = await loadExample(env.DB, { name: 'Second Example Firm', isExample: false, number: '07700 900200' });
    // The second firm's owner has a mobile of their own, so a login link asked
    // for on it can only be the second firm's.
    const [ownerOfB] = await listOwners(db, b);
    if (ownerOfB === undefined) throw new Error('No owner');
    await setOwnerMobile(db, b, ownerOfB.id, ukMobile(OWNER_OF_B), { kind: 'frontline' });
    const [clarke] = await findCustomersByMobile(db, a, ukMobile('07700 900005'));
    const [job] = clarke === undefined ? [] : await listJobsForCustomer(db, a, clarke.id);
    const [visit] = job === undefined ? [] : await listVisitsForJob(db, a, job.id);
    if (visit === undefined) throw new Error('Mr Clarke has no visit');
    const reminder = await addDue(db, a, { action: 'send_reminder', visit: visit.id, runAt: clock.now(), latestAt: clock.now() });
    // Sent through the Twilio version, on a pretend network, so Twilio could report on it.
    await runDue(db, { texts: pretendTwilio() }, a, reminder);
    return { a, b };
  })();
  return firms;
}

/** The second firm's owner's mobile. */
const OWNER_OF_B = '07700 900201';

/**
 * A screen of the owner's app, opened by the second firm's owner: it holds
 * nothing of the first firm's, and leaves the first firm as it was.
 */
async function screenOfB(path: string): Promise<void> {
  const { a, b } = await twoFirms();
  const before = await firmRows(env.DB, a);
  const answer = await opener(createApp(deps), await ownerCookie(db, b))(path);
  expect(answer.status).toBe(200);
  const words = await answer.text();
  expect(words).not.toContain('Tidewell Heating');
  for (const job of await listJobs(db, a)) {
    expect(words).not.toContain(job.id);
  }
  expect(await firmRows(env.DB, a)).toEqual(before);
}

/** Routes that take a firm, each with its cross-firm case. */
const CROSS_FIRM_CASES: Record<string, () => Promise<void>> = {
  // The owner's screens take the firm from the login, and nothing else.
  'GET /': () => screenOfB('/'),
  'GET /calls': () => screenOfB('/calls'),
  'GET /jobs': () => screenOfB('/jobs?q=mrs'),
  'GET /done': () => screenOfB('/done'),
  'GET /rules': () => screenOfB('/rules'),
  'GET /message': () => screenOfB('/message?from=calls'),

  // A job's page looks for the job only in the logged-in firm: the first
  // firm's jobs are not found, however they are asked for.
  'GET /jobs/:job': async () => {
    const { a, b } = await twoFirms();
    const before = await firmRows(env.DB, a);
    const asB = opener(createApp(deps), await ownerCookie(db, b));
    for (const job of await listJobs(db, a)) {
      const answer = await asB(`/jobs/${job.id}`);
      expect(answer.status).toBe(404);
      expect(await answer.text()).not.toContain('Tidewell Heating');
    }
    expect(await firmRows(env.DB, a)).toEqual(before);
  },

  // Message us keeps what was written for the logged-in firm only.
  'POST /message': async () => {
    const { a, b } = await twoFirms();
    const before = await firmRows(env.DB, a);
    const answer = await opener(createApp(deps), await ownerCookie(db, b))('/message', form({ words: 'Please call me.' }));
    expect(answer.status).toBe(200);
    expect(await firmRows(env.DB, a)).toEqual(before);
    expect((await firmRows(env.DB, b)).owner_messages).toMatchObject([{ words: 'Please call me.' }]);
  },

  // The firm comes from the owner whose mobile it is. Asked for on the
  // second firm's owner's mobile, with the first firm's job to land on: the
  // second firm's owner gets a link, which lands on their Home, and the
  // first firm is left as it was.
  'POST /login': async () => {
    const { a, b } = await twoFirms();
    const [jobOfA] = await listJobs(db, a);
    if (jobOfA === undefined) throw new Error('No job');
    const before = await firmRows(env.DB, a);
    const linksOfB = (await firmRows(env.DB, b)).login_links ?? [];
    // Two days on, past the limits the cases above used up for this owner.
    const later = pretendClock(instant(clock.now() + 2 * 24 * 60 * 60_000));
    const answer = await opener(createApp(() => ({ ...pretendDeps, clock: later })), null)('/login', form({ mobile: OWNER_OF_B, job: jobOfA.id }));
    expect(answer.status).toBe(200);
    expect(await firmRows(env.DB, a)).toEqual(before);
    const after = (await firmRows(env.DB, b)).login_links ?? [];
    expect(after).toHaveLength(linksOfB.length + 1);
    expect(after[after.length - 1]).toMatchObject({ job_id: null });
  },

  // The firm comes from the link's token. The second firm's link opens, and
  // logs in to, the second firm only; nothing in the address names a firm.
  'GET /in/:token': async () => {
    const { a, b } = await twoFirms();
    const before = await firmRows(env.DB, a);
    const [ownerOfB] = await listOwners(db, b);
    if (ownerOfB === undefined) throw new Error('No owner');
    const { token } = await createLoginLink(db, b, { owner: ownerOfB.id, job: null });
    const answer = await opener(createApp(deps), null)(`/in/${token}`);
    expect(answer.status).toBe(200);
    expect(await answer.text()).not.toContain('Tidewell Heating');
    expect(await firmRows(env.DB, a)).toEqual(before);
  },
  'POST /in/:token': async () => {
    const { a, b } = await twoFirms();
    const before = await firmRows(env.DB, a);
    const [ownerOfB] = await listOwners(db, b);
    if (ownerOfB === undefined) throw new Error('No owner');
    const { token } = await createLoginLink(db, b, { owner: ownerOfB.id, job: null });
    const app = createApp(deps);
    const tapped = await opener(app, null)(`/in/${token}`, form({}));
    expect(tapped.status).toBe(303);
    expect(await firmRows(env.DB, a)).toEqual(before);
    const home = await opener(app, (tapped.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '')('/');
    expect(await home.text()).toContain('<h1>Second Example Firm</h1>');
  },

  // The firm comes from the login. The second firm's owner logging out
  // ends their own login, and the first firm's stays.
  'POST /logout': async () => {
    const { a, b } = await twoFirms();
    const app = createApp(deps);
    const cookieOfA = await ownerCookie(db, a);
    const before = await firmRows(env.DB, a);
    expect((await opener(app, await ownerCookie(db, b))('/logout', form({}))).status).toBe(303);
    expect(await firmRows(env.DB, a)).toEqual(before);
    expect((await opener(app, cookieOfA)('/')).status).toBe(200);
  },

  // The firm comes from the number that was rung. A report to the second
  // firm's number, from Mrs Ahmed's mobile, finds the second firm's own Mrs
  // Ahmed and leaves the first firm exactly as it was.
  'POST /vapi/server': async () => {
    const { a, b } = await twoFirms();
    const before = await firmRows(env.DB, a);

    const body = withDetails(report('mr-price-leak', '+447700900200'), (data) => ({
      ...data,
      name: 'Mrs Ahmed',
      about: 'Boiler replacement',
      address: '27 Station Road',
      urgentMatch: null,
    }));
    body.message.customer = { number: '+447700900003' };
    expect((await send(createApp(deps), body)).status).toBe(200);

    expect(await firmRows(env.DB, a)).toEqual(before);
    const mrsAhmedOfB = (await listCustomers(db, b)).find((customer) => customer.name === 'Mrs Ahmed');
    const calls = await listCallsBetween(db, b, instantFromIso('2026-10-15T11:00:00+01:00'), instantFromIso('2026-10-15T12:00:00+01:00'));
    expect(calls.map((call) => call.customer?.id)).toContain(mrsAhmedOfB?.id);
    // Found, not made again.
    expect(await listCustomers(db, b)).toHaveLength(16);
  },

  // The firm comes from the number that was rung. The second firm's agent,
  // on the same call id, sees only the second firm's diary, and holds a
  // time there, leaving the first firm exactly as it was.
  'POST /vapi/free-times': async () => {
    const { a } = await twoFirms();
    const app = createApp(deps);
    const ask = async (to: string, callId: string) =>
      (await toolAnswer(await sendTool(app, '/vapi/free-times', toolCall('free-times', { day: '2026-10-22' }, { to, callId })))).times as { start: string }[];
    // A time the first firm holds counts in the first firm's diary only.
    await sendTool(app, '/vapi/book', toolCall('book', { start: '2026-10-22T08:00' }, { to: '+447700900100', callId: 'routes-a' }));
    expect((await ask('+447700900100', 'routes-a2'))[0]?.start).toBe('2026-10-22T09:00');
    const before = await firmRows(env.DB, a);
    expect((await ask('+447700900200', 'routes-b'))[0]?.start).toBe('2026-10-22T08:00');
    expect(await firmRows(env.DB, a)).toEqual(before);
  },
  'POST /vapi/book': async () => {
    const { a, b } = await twoFirms();
    const before = await firmRows(env.DB, a);
    const answer = await toolAnswer(
      await sendTool(createApp(deps), '/vapi/book', toolCall('book', { start: '2026-10-19T11:00' }, { to: '+447700900200', callId: 'routes-call' })),
    );
    expect(answer).toMatchObject({ booked: true });
    expect(await firmRows(env.DB, a)).toEqual(before);
    expect(await listTakenTimes(db, b, ...allTime)).toContainEqual({
      startsAt: instantFromIso('2026-10-19T11:00:00+01:00'),
      endsAt: instantFromIso('2026-10-19T12:00:00+01:00'),
    });
  },

  // The firm comes from the link's token. The first firm's link shows only
  // the first firm's customer; nothing in the address names a firm, so there
  // is no other firm's id to try. The second firm's link cannot change the
  // first firm.
  'GET /d/:token': async () => {
    const { a, b } = await twoFirms();
    const linkOfB = await clarkesLink(b);
    const page = await createApp(deps).request(`${LINK_ADDRESS}/d/${linkOfB}`, {}, env);
    expect(page.status).toBe(200);
    const words = await page.text();
    expect(words).toContain('Second Example Firm');
    expect(words).not.toContain('Tidewell Heating');
    const [clarkeOfA] = await findCustomersByMobile(db, a, ukMobile('07700 900005'));
    expect(words).not.toContain(clarkeOfA?.id ?? 'none');
  },
  'POST /d/:token': async () => {
    const { a, b } = await twoFirms();
    const linkOfB = await clarkesLink(b);
    const before = await firmRows(env.DB, a);
    const body = new URLSearchParams({ name: 'Mr J Clarke', address: '41 Park Road', email: '' }).toString();
    const answer = await createApp(deps).request(
      `${LINK_ADDRESS}/d/${linkOfB}`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(body.length) }, body },
      env,
    );
    expect(answer.status).toBe(200);
    expect(await firmRows(env.DB, a)).toEqual(before);
    const [clarkeOfB] = await findCustomersByMobile(db, b, ukMobile('07700 900005'));
    expect(clarkeOfB?.name).toBe('Mr J Clarke');
  },

  // The firm comes from the number the text was sent to. A text to the
  // second firm's number from Mrs Ahmed's mobile lands on the second firm's
  // own Mrs Ahmed, and the first firm is left exactly as it was.
  'POST /twilio/texts': async () => {
    const { a, b } = await twoFirms();
    const before = await firmRows(env.DB, a);
    const answer = await postToTwilioRoute(createApp(deps), '/twilio/texts', twilioFields('text-in', { To: '+447700900200' }));
    expect(answer.status).toBe(200);

    expect(await firmRows(env.DB, a)).toEqual(before);
    const [mrsAhmedOfB] = await findCustomersByMobile(db, b, ukMobile('07700 900003'));
    expect(await listTextsInBetween(db, b, ...allTime)).toMatchObject([{ customer: { id: mrsAhmedOfB?.id } }]);
  },

  // The firm comes from the number the text was sent from. A report that
  // names the first firm's text, but comes for the second firm's number,
  // finds nothing and changes nothing.
  'POST /twilio/status': async () => {
    const { a } = await twoFirms();
    const [text] = await listMessagesBetween(db, a, ...allTime);
    if (text?.provider !== 'twilio' || text.providerId === null) throw new Error('The first firm has sent no text through Twilio');
    const before = await firmRows(env.DB, a);
    const answer = await postToTwilioRoute(
      createApp(deps),
      '/twilio/status',
      twilioFields('undelivered', { MessageSid: text.providerId, From: '+447700900200' }),
    );
    expect(answer.status).toBe(200);
    expect(await firmRows(env.DB, a)).toEqual(before);

    // The same report for the first firm's own number does reach it, so the
    // case above failed for the right reason.
    await postToTwilioRoute(createApp(deps), '/twilio/status', twilioFields('undelivered', { MessageSid: text.providerId, From: '+447700900100' }));
    expect(await firmRows(env.DB, a)).not.toEqual(before);
  },
};

/** A link for the firm's Mr Clarke, for his job. */
async function clarkesLink(firm: FirmId): Promise<string> {
  const [clarke] = await findCustomersByMobile(db, firm, ukMobile('07700 900005'));
  const [job] = clarke === undefined ? [] : await listJobsForCustomer(db, firm, clarke.id);
  const [visit] = job === undefined ? [] : await listVisitsForJob(db, firm, job.id);
  if (clarke === undefined || job === undefined || visit === undefined) throw new Error('Mr Clarke has no visit');
  const due = await addDue(db, firm, { action: 'send_confirmation', visit: visit.id, runAt: clock.now(), latestAt: clock.now() });
  return linkForDue(db, firm, { due, customer: clarke.id, job: job.id });
}

function routesOf(app: ReturnType<typeof createApp>): string[] {
  return (
    app.routes
      // Middleware that runs for every request, such as the one that gives
      // each request its clock, is not a route.
      .filter((route) => !(route.method === 'ALL' && route.path === '/*'))
      .map((route) => `${route.method} ${route.path}`)
  );
}

describe('every route', () => {
  it.each([
    ['the deployed version', createApp(deps)],
    ['the version for this machine', createLocalApp(deps)],
  ])('in %s is listed, with a cross-firm case or the reason it needs none', (_, app) => {
    for (const route of routesOf(app)) {
      expect(Object.keys(TAKES_NO_FIRM).concat(Object.keys(CROSS_FIRM_CASES))).toContain(route);
    }
  });

  it('in the deployed version is /health, the addresses Vapi and Twilio call, the customer’s page, and the owner’s app', () => {
    expect(routesOf(createApp(deps))).toEqual([
      'GET /health',
      'POST /vapi/server',
      'POST /vapi/free-times',
      'POST /vapi/book',
      'GET /d/:token',
      'POST /d/:token',
      'POST /twilio/texts',
      'POST /twilio/status',
      'GET /app.js',
      'GET /login',
      'POST /login',
      'GET /in/:token',
      'POST /in/:token',
      'POST /logout',
      'GET /',
      'GET /calls',
      'GET /jobs',
      'GET /jobs/:job',
      'GET /done',
      'GET /rules',
      'GET /message',
      'POST /message',
    ]);
  });

  it.each(Object.entries(CROSS_FIRM_CASES))('%s refuses the other firm', async (_, attempt) => {
    await attempt();
  });
});

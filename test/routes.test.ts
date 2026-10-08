// Every web address the system answers (rule 9 in CLAUDE.md). A route that
// reads or writes a firm's data needs a cross-firm case here, trying the
// other firm's ids. A route not listed fails this test, so a new one cannot
// skip the wall.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { loadExample } from '../src/example/load';
import { createLocalApp } from '../src/local';
import { runDue } from '../src/due';
import { ukMobile } from '../src/phone';
import {
  addDue,
  findCustomersByMobile,
  listCallsBetween,
  listCustomers,
  listJobsForCustomer,
  listMessagesBetween,
  listTextsInBetween,
  listVisitsForJob,
} from '../src/record';
import { openRecord } from '../src/record/db';
import type { FirmId } from '../src/record/types';
import { firmRows } from './helpers/db';
import { testDeps } from './helpers/deps';
import { postToTwilioRoute, pretendTwilio, twilioFields } from './helpers/twilio';
import { report, send, withDetails } from './helpers/vapi';

/** Routes that take no firm from the request, and why. */
const TAKES_NO_FIRM: Record<string, string> = {
  'GET /health': 'Answers with the version. Holds no firm data.',
  'GET /local/example': 'This machine only. Shows the example firm and takes nothing from the request.',
  'GET /local/calls': 'This machine only. Shows the example firm and takes nothing from the request.',
  'GET /local/texts': 'This machine only. Shows the example firm and takes nothing from the request.',
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
    const a = await loadExample(env.DB);
    const b = await loadExample(env.DB, { name: 'Second Example Firm', isExample: false, number: '07700 900200' });
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

/** Routes that take a firm, each with its cross-firm case. */
const CROSS_FIRM_CASES: Record<string, () => Promise<void>> = {
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

  it('in the deployed version is /health and the addresses Vapi and Twilio report to', () => {
    expect(routesOf(createApp(deps))).toEqual(['GET /health', 'POST /vapi/server', 'POST /twilio/texts', 'POST /twilio/status']);
  });

  it.each(Object.entries(CROSS_FIRM_CASES))('%s refuses the other firm', async (_, attempt) => {
    await attempt();
  });
});

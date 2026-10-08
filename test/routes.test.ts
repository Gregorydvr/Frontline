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
import { listCallsBetween, listCustomers } from '../src/record';
import { openRecord } from '../src/record/db';
import { firmRows } from './helpers/db';
import { report, send, withDetails } from './helpers/vapi';

/** Routes that take no firm from the request, and why. */
const TAKES_NO_FIRM: Record<string, string> = {
  'GET /health': 'Answers with the version. Holds no firm data.',
  'GET /local/example': 'This machine only. Shows the example firm and takes nothing from the request.',
  'GET /local/calls': 'This machine only. Shows the example firm and takes nothing from the request.',
};

const clock = pretendClock(instantFromIso('2026-10-15T16:00:00+01:00'));
const deps = () => ({ clock });

/** Routes that take a firm, each with its cross-firm case. */
const CROSS_FIRM_CASES: Record<string, () => Promise<void>> = {
  // The firm comes from the number that was rung. A report to the second
  // firm's number, from Mrs Ahmed's mobile, finds the second firm's own Mrs
  // Ahmed and leaves the first firm exactly as it was.
  'POST /vapi/server': async () => {
    const db = openRecord(env.DB, clock);
    const a = await loadExample(env.DB);
    const b = await loadExample(env.DB, { name: 'Second Example Firm', isExample: false, number: '07700 900200' });
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

  it('in the deployed version is /health and the address Vapi reports to', () => {
    expect(routesOf(createApp(deps))).toEqual(['GET /health', 'POST /vapi/server']);
  });

  it.each(Object.entries(CROSS_FIRM_CASES))('%s refuses the other firm', async (_, attempt) => {
    await attempt();
  });
});

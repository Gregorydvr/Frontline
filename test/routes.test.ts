// Every web address the system answers (rule 9 in CLAUDE.md). A route that
// reads or writes a firm's data needs a cross-firm case here, trying the
// other firm's ids. A route not listed fails this test, so a new one cannot
// skip the wall.

import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { instantFromIso, pretendClock } from '../src/clock';
import { createLocalApp } from '../src/local';

/** Routes that take no firm from the request, and why. */
const TAKES_NO_FIRM: Record<string, string> = {
  'GET /health': 'Answers with the version. Holds no firm data.',
  'GET /local/example': 'This machine only. Shows the example firm and takes nothing from the request.',
};

/** Routes that take a firm, each with its cross-firm case. None yet: slice C adds the first. */
const CROSS_FIRM_CASES: Record<string, () => Promise<void>> = {};

const deps = () => ({ clock: pretendClock(instantFromIso('2026-10-15T16:00:00+01:00')) });

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

  it('in the deployed version is only /health so far', () => {
    expect(routesOf(createApp(deps))).toEqual(['GET /health']);
  });

  it.each(Object.entries(CROSS_FIRM_CASES))('%s refuses the other firm', async (_, attempt) => {
    await attempt();
  });
});

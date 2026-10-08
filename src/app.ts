import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { version } from '../package.json';
import type { Deps } from './deps';
import { landCall } from './land-call';
import { errorName, log } from './log';
import { openRecord } from './record/db';
import { bearerToken, sameSecret } from './secret';
import { readVapiMessage } from './vapi-report';

export interface AppEnv {
  Bindings: Env;
  Variables: { deps: Deps };
}

/**
 * The Worker's routes. `makeDeps` builds what each request is given: the real
 * clock and providers in the Worker, pretend ones in tests. `extend` adds to
 * the app before its own routes, so anything it adds sees every request; only
 * the version for this machine (src/local.ts) uses it.
 */
export function createApp(makeDeps: (env: Env) => Deps, extend?: (app: Hono<AppEnv>) => void): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    c.set('deps', makeDeps(c.env));
    await next();
  });

  extend?.(app);

  app.get('/health', (c) => c.json({ version }, 200, { 'Cache-Control': 'no-store' }));

  // Where Vapi sends its messages about a firm's calls (docs/vapi.md). It is
  // outside the practice gate, so it checks Vapi's secret before it reads
  // anything, and refuses everything when no secret is set up.
  app.post('/vapi/server', async (c) => {
    if (!(await sameSecret(bearerToken(c.req.header('Authorization')), c.env.VAPI_SECRET))) {
      log('call_report_refused');
      return c.body(null, 401);
    }
    const message = readVapiMessage(await c.req.json().catch(() => null));
    switch (message.kind) {
      case 'other':
        return c.json({});
      case 'unreadable':
        log('call_report_unreadable');
        return c.json({}, 400);
      case 'report': {
        const landed = await landCall(openRecord(c.env.DB, c.get('deps').clock), message.report);
        return c.json({}, landed.result === 'unknown_number' ? 404 : 200);
      }
    }
  });

  app.onError((thrown, c) => {
    // A refusal on purpose, such as a 401 from an auth check, keeps its own
    // answer and is not an error.
    if (thrown instanceof HTTPException) {
      return thrown.getResponse();
    }
    // Hono's own handler would log the error's message, which can hold a
    // customer's details. Log only its type (rule 11).
    log('unhandled_error', { error: errorName(thrown) });
    return c.text('Internal Server Error', 500);
  });

  return app;
}

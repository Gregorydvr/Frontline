import { Hono } from 'hono';
import { version } from '../package.json';
import type { Deps } from './deps';
import { errorName, log } from './log';

export interface AppEnv {
  Bindings: Env;
  Variables: { deps: Deps };
}

/**
 * The Worker's routes. `makeDeps` builds what each request is given: the real
 * clock and providers in the Worker, pretend ones in tests.
 */
export function createApp(makeDeps: (env: Env) => Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    c.set('deps', makeDeps(c.env));
    await next();
  });

  app.get('/health', (c) => c.json({ version }, 200, { 'Cache-Control': 'no-store' }));

  // Hono's own handler would log the error's message, which can hold a
  // customer's details. Log only its type (rule 11).
  app.onError((thrown, c) => {
    log('unhandled_error', { error: errorName(thrown) });
    return c.text('Internal Server Error', 500);
  });

  return app;
}

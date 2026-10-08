// The Worker as `npm run dev` runs it on this machine. It is the same app as
// src/index.ts, with the stand-in for texts in place of Twilio, so nothing
// leaves this machine. It adds things that are never deployed, because
// practice and live are built from src/index.ts:
// - the demo firm is loaded the first time the app is used, if it is not
//   already there
// - /local/example shows the demo firm in plain text, as it stands on the
//   example's "today", Thursday 15 October 2026
// - /local/calls shows the demo firm's Calls & bookings screen on that same
//   day. Until the owner can log in (slice F), the owner's screens are served
//   only here.
// - /local/texts lists the demo firm's texts from the record: what went out
//   through the stand-in, what was not sent and why, and what came in.

import type { Hono } from 'hono';
import { createApp, type AppEnv } from './app';
import { instantFromIso, systemClock } from './clock';
import type { Deps } from './deps';
import { everyMinute, onQueue } from './due';
import { ensureExample } from './example/load';
import { showExample } from './example/show';
import { showTexts } from './example/texts';
import { EXAMPLE_NOW } from './example/tidewell';
import { FakeTexts } from './providers/texts/fake';
import { openRecord } from './record/db';
import type { FirmId } from './record/types';
import { callsScreen } from './screens/calls';
import { PAGE_HEADERS } from './screens/page';

export function createLocalApp(makeDeps: (env: Env) => Deps): Hono<AppEnv> {
  // One load at a time, however many requests arrive together.
  let loading: Promise<FirmId> | null = null;

  return createApp(makeDeps, (app) => {
    app.use(async (c, next) => {
      loading ??= ensureExample(c.env.DB).catch((thrown: unknown) => {
        loading = null;
        throw thrown;
      });
      await loading;
      await next();
    });

    app.get('/local/example', async (c) => {
      const firm = await ensureExample(c.env.DB);
      const now = instantFromIso(EXAMPLE_NOW);
      const text = await showExample(openRecord(c.env.DB, c.get('deps').clock), firm, now);
      return c.text(text, 200, { 'Cache-Control': 'no-store' });
    });

    app.get('/local/calls', async (c) => {
      const firm = await ensureExample(c.env.DB);
      const screen = await callsScreen(openRecord(c.env.DB, c.get('deps').clock), firm, instantFromIso(EXAMPLE_NOW));
      return c.html(screen, 200, PAGE_HEADERS);
    });

    app.get('/local/texts', async (c) => {
      const firm = await ensureExample(c.env.DB);
      const text = await showTexts(openRecord(c.env.DB, c.get('deps').clock), firm);
      return c.text(text, 200, { 'Cache-Control': 'no-store' });
    });
  });
}

// One stand-in for the life of the Worker on this machine.
const texts = new FakeTexts();
const localDeps = (env: Env): Deps => ({ clock: systemClock, texts, queue: env.DUE });
const app = createLocalApp(localDeps);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env) {
    await everyMinute(env.DB, localDeps(env));
  },
  async queue(batch, env) {
    await onQueue(batch, env.DB, localDeps(env));
  },
} satisfies ExportedHandler<Env>;

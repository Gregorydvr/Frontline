// The Worker as `npm run dev` runs it on this machine. It is the same app as
// src/index.ts, with the stand-in for texts in place of Twilio, so nothing
// leaves this machine. It adds things that are never deployed, because
// practice and live are built from src/index.ts:
// - the demo firm is loaded the first time the app is used, if it is not
//   already there
// - /local/example shows the demo firm in plain text, as it stands on the
//   example's "today", Thursday 15 October 2026
// - /local/login has one button, which sends Tom, the demo firm's owner, a
//   link to log in, through the stand-in for texts, and shows the text with
//   its link to open here.
// - the clock starts at the example's "today", Thursday 15 October 2026 at
//   4pm, when the Worker starts, and runs on from there, so the owner's
//   screens show the demo firm as the example does.
// - /local/texts lists the demo firm's texts from the record: what went out
//   through the stand-in, what was not sent and why, and what came in.
// - /local/book has one button, which plays a call to the demo firm that
//   books a quote visit, through the real addresses Vapi calls, and sends
//   the confirmation at once, so its link to the customer's page can be
//   opened here.

import type { Hono } from 'hono';
import { createApp, type AppEnv } from './app';
import { instantFromIso, startingAt } from './clock';
import { linkAddressFrom, type Deps } from './deps';
import { everyMinute, onQueue, runDue } from './due';
import { ensureExample } from './example/load';
import { showExample } from './example/show';
import { playBookingCall } from './example/play-call';
import { showTexts } from './example/texts';
import { EXAMPLE_NOW, EXAMPLE_OWNER } from './example/tidewell';
import { StandInStaff } from './providers/access/fake';
import { FakeTexts } from './providers/texts/fake';
import { createLoginLink, findMessageForDue, listOwners } from './record';
import { openRecord } from './record/db';
import type { FirmId } from './record/types';
import { DETAILS_HEADERS } from './screens/details';
import { html } from './screens/html';
import { page } from './screens/page';

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

    app.get('/local/login', (c) =>
      c.html(
        page(
          'Log in as Tom',
          html`<div class="block"><h1>Log in as ${EXAMPLE_OWNER}</h1><p class="meta">Sends ${EXAMPLE_OWNER}, the demo firm’s owner, a link to log in, to the stand-in for texts, as the login page does.</p></div>
<form method="post"><button class="btn" type="submit" style="min-height:56px;padding:0 20px;border:0;border-radius:12px;background:var(--ink);color:var(--cream);font:inherit;font-weight:600">Send ${EXAMPLE_OWNER} a login link</button></form>`,
        ),
        200,
        DETAILS_HEADERS,
      ),
    );

    app.post('/local/login', async (c) => {
      const firm = await ensureExample(c.env.DB);
      const deps = c.get('deps');
      const db = openRecord(c.env.DB, deps.clock);
      const [owner] = await listOwners(db, firm);
      if (owner === undefined) {
        return c.text('The demo firm has no owner.', 500);
      }
      const { due } = await createLoginLink(db, firm, { owner: owner.id, job: null });
      await runDue(db, deps, firm, due);
      const text = await findMessageForDue(db, firm, due, { kind: 'owner', owner: owner.id });
      const link = text?.words?.match(/\S+\/in\/\S+/)?.[0] ?? null;
      return c.html(
        page(
          'Sent a login link',
          html`<div class="block"><h1>Sent a login link</h1><p class="meta">The text, as the stand-in for texts took it:</p></div>
<div class="card"><div class="row"><span class="txt"><span class="t2" style="overflow-wrap:anywhere">${text?.words ?? 'Not sent. See /local/texts for why.'}</span></span></div></div>
${link === null ? null : html`<p><a href="${link}">Open the link</a></p>`}`,
        ),
        200,
        DETAILS_HEADERS,
      );
    });

    app.get('/local/texts', async (c) => {
      const firm = await ensureExample(c.env.DB);
      const text = await showTexts(openRecord(c.env.DB, c.get('deps').clock), firm);
      return c.text(text, 200, { 'Cache-Control': 'no-store' });
    });

    app.get('/local/book', (c) =>
      c.html(
        page(
          'Play a call',
          html`<div class="block"><h1>Play a call</h1><p class="meta">Mrs Ahmed rings Tidewell Heating, on a new mobile, and books the first free quote visit. Her confirmation goes at once, to the stand-in for texts.</p></div>
<form method="post"><button class="btn" type="submit" style="min-height:56px;padding:0 20px;border:0;border-radius:12px;background:var(--ink);color:var(--cream);font:inherit;font-weight:600">Play Mrs Ahmed’s call</button></form>`,
        ),
        200,
        DETAILS_HEADERS,
      ),
    );

    app.post('/local/book', async (c) => {
      const firm = await ensureExample(c.env.DB);
      const deps = c.get('deps');
      const played = await playBookingCall(app, c.env, openRecord(c.env.DB, deps.clock), deps, firm);
      const said =
        played.result === 'no_secret'
          ? html`<p class="meta">Put a VAPI_SECRET in .dev.vars first (see the README), then start npm run dev again.</p>`
          : played.result === 'no_times'
            ? html`<p class="meta">The demo firm has no free quote visits in the next two weeks.</p>`
            : html`<p class="meta">Quote visit booked for ${played.say}. Her confirmation: ${played.text === 'held' ? 'held until 8am, since texts wait outside 8am to 8pm' : played.text}.</p>
${played.words === null ? null : html`<div class="card"><div class="row"><span class="txt"><span class="t2" style="overflow-wrap:anywhere">${played.words}</span></span></div></div>`}
${played.link === null ? null : html`<p><a href="${played.link}">Open her confirm-your-details page</a></p>`}`;
      return c.html(page('Played a call', html`<div class="block"><h1>Played a call</h1>${said}<p><a href="/local/texts">All the texts</a></p></div>`), 200, DETAILS_HEADERS);
    });
  });
}

// One stand-in for the life of the Worker on this machine.
const texts = new FakeTexts();
// The example's "today", running on from when the Worker started.
const clock = startingAt(instantFromIso(EXAMPLE_NOW));
const localDeps = (env: Env): Deps => ({
  clock,
  texts,
  queue: env.DUE,
  linkAddress: linkAddressFrom(env.LINK_ADDRESS),
  appAddress: linkAddressFrom(env.PUBLIC_ADDRESS),
  copy: 'local',
  // No Access on this machine: the stand-in vouches for the invented
  // "Example Staff".
  staff: new StandInStaff(),
  controlAddress: linkAddressFrom(env.CONTROL_ADDRESS),
});
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

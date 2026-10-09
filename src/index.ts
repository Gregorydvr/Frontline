// The Worker. It builds the real dependencies and hands every request to the
// app in app.ts, every minute to the clock, and every batch from the queue to
// the due list's worker (src/due.ts).

import { createApp } from './app';
import { systemClock } from './clock';
import { linkAddressFrom, type Deps } from './deps';
import { everyMinute, onQueue } from './due';
import { TwilioTexts } from './providers/texts/twilio';

function realDeps(env: Env): Deps {
  const address = env.PUBLIC_ADDRESS.replace(/\/+$/, '');
  return {
    clock: systemClock,
    texts: new TwilioTexts({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      statusCallback: address === '' ? null : `${address}/twilio/status`,
    }),
    queue: env.DUE,
    linkAddress: linkAddressFrom(env.LINK_ADDRESS),
  };
}

const app = createApp(realDeps);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env) {
    await everyMinute(env.DB, realDeps(env));
  },
  async queue(batch, env) {
    await onQueue(batch, env.DB, realDeps(env));
  },
} satisfies ExportedHandler<Env>;

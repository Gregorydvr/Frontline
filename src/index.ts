// The Worker. It builds the real dependencies and hands every request to the
// app in app.ts, every minute to the clock, and every batch from the queue to
// the due list's worker (src/due.ts).

import { createApp } from './app';
import { systemClock } from './clock';
import { copyFrom, linkAddressFrom, type Deps } from './deps';
import { everyMinute, onQueue } from './due';
import { CLOSED_GATE, type StaffGate } from './providers/access';
import { CloudflareAccess } from './providers/access/cloudflare';
import { TwilioTexts } from './providers/texts/twilio';

/** Cloudflare Access's check, once both its settings are given for this copy; until then the control room is shut. */
function staffGate(env: Env): StaffGate {
  // A secret that was never set is missing at run time, whatever the types say.
  const team = ((env.ACCESS_TEAM as string | undefined) ?? '').trim();
  const audience = ((env.ACCESS_AUD as string | undefined) ?? '').trim();
  try {
    return team === '' || audience === '' ? CLOSED_GATE : new CloudflareAccess({ team, audience });
  } catch {
    return CLOSED_GATE;
  }
}

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
    appAddress: linkAddressFrom(env.PUBLIC_ADDRESS),
    copy: copyFrom(env.COPY),
    staff: staffGate(env),
    controlAddress: linkAddressFrom(env.CONTROL_ADDRESS),
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

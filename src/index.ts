// The Worker. It builds the real dependencies and hands every request to the
// app in app.ts, every minute to the clock, and every batch from the queue to
// the due list's worker (src/due.ts).

import { createApp } from './app';
import { systemClock } from './clock';
import { copyFrom, linkAddressFrom, textsOnFrom, vapiCredentialFrom, type Deps } from './deps';
import { everyMinute, onQueue } from './due';
import { CLOSED_GATE, type StaffGate } from './providers/access';
import { CloudflareAccess } from './providers/access/cloudflare';
import { TwilioTexts } from './providers/texts/twilio';
import { numbersSettingsWhole, TwilioNumbers } from './providers/numbers/twilio';
import { VapiApi } from './providers/vapi/api';

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

/**
 * Vapi's agents, once Greg has set practice's Vapi private key as the secret
 * VAPI_API_KEY: practice only, never live (docs/decisions.md, 16 Oct 2026). Until then, null: the control room's pushes reach
 * nothing and say so. The key is not listed with the secrets the Worker
 * needs, since a copy runs without it.
 */
export function vapiAgents(env: Env): VapiApi | null {
  const key = ((env as unknown as { VAPI_API_KEY?: string }).VAPI_API_KEY ?? '').trim();
  // Greg's decision of 16 Oct 2026: only practice's Worker holds a Vapi key.
  // A key set on any other copy is not used.
  return key === '' || copyFrom(env.COPY) !== 'practice' ? null : new VapiApi(key);
}

/**
 * Buying numbers in Twilio, only when the copy's NUMBERS_ON setting is "yes"
 * and its bundle, address and Twilio account are all set: every number
 * bought costs money. Null on every copy today.
 */
export function phoneNumbers(env: Env): TwilioNumbers | null {
  const settings = {
    // A secret that was never set is missing at run time, whatever the types say.
    accountSid: ((env.TWILIO_ACCOUNT_SID as string | undefined) ?? '').trim(),
    authToken: ((env.TWILIO_AUTH_TOKEN as string | undefined) ?? '').trim(),
    bundleSid: env.TWILIO_BUNDLE_SID.trim(),
    addressSid: env.TWILIO_ADDRESS_SID.trim(),
  };
  return env.NUMBERS_ON.trim() === 'yes' && numbersSettingsWhole(settings) ? new TwilioNumbers(settings) : null;
}

/** Who may switch a firm to live: the email in the secret GO_LIVE_BY, or nobody while it is not set. */
function goLiveBy(env: Env): string | null {
  const email = ((env as unknown as { GO_LIVE_BY?: string }).GO_LIVE_BY ?? '').trim().toLowerCase();
  return email === '' ? null : email;
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
    files: { kept: env.FILES, inbox: env.CALLS_IN },
    agents: vapiAgents(env),
    vapiCredential: vapiCredentialFrom(env.VAPI_CREDENTIAL_ID),
    textsOn: textsOnFrom(env.TEXTS_ON),
    numbers: phoneNumbers(env),
    goLiveBy: goLiveBy(env),
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

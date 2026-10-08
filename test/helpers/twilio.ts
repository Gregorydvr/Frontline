// Sending Twilio's requests to the system in tests, the way Twilio does: a
// form, signed with the account's auth token in the X-Twilio-Signature
// header. The requests are the example files in test/fixtures/twilio/, with
// invented people.

import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { AppEnv } from '../../src/app';
import { TwilioTexts, twilioSignature } from '../../src/providers/texts/twilio';
import delivered from '../fixtures/twilio/delivered.json';
import textIn from '../fixtures/twilio/text-in.json';
import undelivered from '../fixtures/twilio/undelivered.json';

export const TWILIO_REQUESTS = { 'text-in': textIn, delivered, undelivered } as const;

export type TwilioFields = Record<string, string>;

/** A copy of an example request, with some fields changed. */
export function twilioFields(name: keyof typeof TWILIO_REQUESTS, change: TwilioFields = {}): TwilioFields {
  return { ...TWILIO_REQUESTS[name], ...change };
}

/** Posts a form to one of Twilio's addresses, signed as Twilio signs it, or with the signature given. */
export async function postToTwilioRoute(
  app: Hono<AppEnv>,
  path: '/twilio/texts' | '/twilio/status',
  fields: TwilioFields,
  signature?: string,
): Promise<Response> {
  const url = `http://localhost${path}`;
  const form = Object.entries(fields);
  const signed = signature ?? (await twilioSignature(env.TWILIO_AUTH_TOKEN, url, form));
  return app.request(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signed },
      body: new URLSearchParams(form).toString(),
    },
    env,
  );
}

/**
 * The Twilio version of texts, on a pretend network that takes every text
 * and gives it an id of Twilio's shape. Nothing reaches Twilio. For tests of
 * what Twilio reports back about a text it sent.
 */
export function pretendTwilio(): TwilioTexts {
  const network = () => {
    const sid = `SM${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    return Promise.resolve(Response.json({ sid }, { status: 201 }));
  };
  return new TwilioTexts({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    statusCallback: null,
    fetch: network,
  });
}

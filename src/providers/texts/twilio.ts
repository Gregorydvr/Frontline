// Texts through Twilio: sending, and checking that a request to us is from
// Twilio. Used on practice and live only; this machine and the tests use the
// stand-in in fake.ts, and the tests of this file use a pretend network.
//
// Twilio's documentation website could not be opened from the cloud session
// that wrote this. How a request is signed is taken from Twilio's own package,
// `twilio` 6.1.2 (lib/webhooks/webhooks.js, published 28 September 2026). The
// fields read from Twilio's requests, and its error code for an unsubscribed
// customer, are to be checked against real ones from practice (docs/twilio.md).

import { log } from '../../log';
import type { OutgoingText, TextResult, Texts } from '.';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

/** Twilio's error when the customer opted out with Twilio itself, by texting STOP. */
export const TWILIO_UNSUBSCRIBED = 21610;

export interface TwilioSettings {
  accountSid: string | undefined;
  authToken: string | undefined;
  /** Where Twilio reports on delivery, or null when the address is not set up yet. */
  statusCallback: string | null;
  /** The network. Tests pass a pretend one. */
  fetch?: typeof fetch;
}

export class TwilioTexts implements Texts {
  readonly provider = 'twilio' as const;
  private readonly settings: TwilioSettings;

  constructor(settings: TwilioSettings) {
    this.settings = settings;
  }

  async sendText(text: OutgoingText): Promise<TextResult> {
    const { accountSid, authToken, statusCallback } = this.settings;
    if (accountSid === undefined || !/^AC[0-9a-f]{32}$/.test(accountSid) || authToken === undefined || authToken === '') {
      // Certain not to have gone: nothing was sent to Twilio.
      log('texts_not_set_up');
      return { ok: false, reason: 'refused', code: null };
    }
    const form = new URLSearchParams({ To: text.to, From: text.from, Body: text.body });
    if (statusCallback !== null) {
      form.set('StatusCallback', statusCallback);
    }
    const send = this.settings.fetch ?? fetch;
    const answer = await send(`${TWILIO_API}/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const body: unknown = await answer.json().catch(() => null);
    if (answer.status >= 500) {
      // Twilio may or may not have taken it.
      throw new Error('Twilio failed');
    }
    if (answer.ok) {
      const sid = field(body, 'sid');
      if (typeof sid !== 'string' || !/^[A-Z]{2}[0-9a-f]{32}$/.test(sid)) {
        throw new Error('Twilio gave no id for the text');
      }
      return { ok: true, providerId: sid };
    }
    const code = field(body, 'code');
    const known = typeof code === 'number' && Number.isSafeInteger(code) ? code : null;
    return { ok: false, reason: known === TWILIO_UNSUBSCRIBED ? 'unsubscribed' : 'refused', code: known };
  }
}

/** A request from Twilio, read as the form it sends: each name with its values, in order. */
export type TwilioForm = [string, string][];

/**
 * The largest form read from Twilio. Real ones are a few KB: a text is at most
 * 1,600 characters, and there are about twenty fields. Anything bigger is
 * refused before it is read, since the signature can only be checked once
 * the whole form has been.
 */
export const LARGEST_TWILIO_FORM = 64 * 1024;

/** Reads the form Twilio sent, or gives null when it is larger than any Twilio sends. */
export async function readTwilioForm(request: Request): Promise<TwilioForm | null> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && !(Number(declared) <= LARGEST_TWILIO_FORM)) {
    return null;
  }
  const body = await readUpTo(request, LARGEST_TWILIO_FORM);
  return body === null ? null : [...new URLSearchParams(body)];
}

/** The body as text, read no further than `limit` bytes; null when it is longer. */
async function readUpTo(request: Request, limit: number): Promise<string | null> {
  if (request.body === null) {
    return '';
  }
  const reader = request.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value }: ReadableStreamReadResult<Uint8Array> = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const whole = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(whole);
}

/** The first value of one field of the form, or null. */
export function formField(form: TwilioForm, name: string): string | null {
  return form.find(([key]) => key === name)?.[1] ?? null;
}

/**
 * Twilio's signature for a request: the address it called, then each field's
 * name and value with the names in order, signed with the account's auth
 * token (HMAC-SHA1) and written in base 64.
 */
export async function twilioSignature(authToken: string, url: string, form: TwilioForm): Promise<string> {
  // In one pass, so a form of many repeated fields costs no more than its size.
  const byName = new Map<string, string[]>();
  for (const [name, value] of form) {
    const values = byName.get(name);
    if (values === undefined) {
      byName.set(name, [value]);
    } else {
      values.push(value);
    }
  }
  let data = url;
  for (const name of [...byName.keys()].sort()) {
    // A field given more than once: each different value, in order.
    for (const value of [...new Set(byName.get(name))].sort()) {
      data += name + value;
    }
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...signed));
}

/**
 * Whether a request is from Twilio: its X-Twilio-Signature header matches the
 * signature worked out with our auth token. As Twilio's own package does, the
 * address is tried with and without the standard port, since Twilio signs
 * either. With no auth token set up, nothing matches.
 */
export async function isFromTwilio(
  authToken: unknown,
  url: string,
  form: TwilioForm,
  header: string | undefined,
): Promise<boolean> {
  if (typeof authToken !== 'string' || authToken.length < 32 || header === undefined || header === '') {
    return false;
  }
  for (const address of withAndWithoutPort(url)) {
    if (await sameText(header, await twilioSignature(authToken, address, form))) {
      return true;
    }
  }
  return false;
}

function withAndWithoutPort(url: string): string[] {
  const parsed = new URL(url);
  const standard = parsed.protocol === 'https:' ? '443' : '80';
  const without = new URL(url);
  without.port = '';
  const withPort = `${without.protocol}//${without.hostname}:${parsed.port || standard}${without.pathname}${without.search}`;
  return [...new Set([url, without.toString(), withPort])];
}

/** Compares two strings in a way that takes the same time however much of them matches. */
async function sameText(a: string, b: string): Promise<boolean> {
  const digest = (text: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  return crypto.subtle.timingSafeEqual(x, y);
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, name)
    ? (value as Record<string, unknown>)[name]
    : undefined;
}

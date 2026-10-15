// Buying a number through Twilio's own API. Switched off on every copy: the
// Worker builds this only when the copy's NUMBERS_ON setting is "yes"
// (src/index.ts), since every number bought costs money. The tests of this
// file use a pretend network.
//
// From Twilio's documentation, read 15 Oct 2026: GET
// AvailablePhoneNumbers/GB/Mobile.json lists numbers free to buy
// (`available_phone_numbers`, each with `phone_number`), and POST
// IncomingPhoneNumbers.json buys one, with `PhoneNumber`, `FriendlyName`,
// `SmsUrl`, `SmsMethod`, `BundleSid` and `AddressSid`. A UK number needs a
// regulatory bundle Twilio has approved, and an address, made by hand in
// Twilio's console on Greg's machine. Its calls are pointed at Vapi when it
// is brought into Vapi (scripts/vapi-import-number.js), not here.

import { callerNumber } from '../../phone';
import type { BuyAnswer, PhoneNumbers } from '.';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

export interface TwilioNumbersSettings {
  accountSid: string;
  authToken: string;
  /** Twilio's id for the regulatory bundle a UK number is bought under. */
  bundleSid: string;
  /** Twilio's id for the address a UK number is bought under. */
  addressSid: string;
  /** The network. Tests pass a pretend one. */
  fetch?: typeof fetch;
}

/** Whether the settings are whole: the Worker builds the real one only then. */
export function numbersSettingsWhole(settings: Omit<TwilioNumbersSettings, 'fetch'>): boolean {
  return (
    /^AC[0-9a-f]{32}$/.test(settings.accountSid) &&
    settings.authToken !== '' &&
    /^BU[0-9a-f]{32}$/.test(settings.bundleSid) &&
    /^AD[0-9a-f]{32}$/.test(settings.addressSid)
  );
}

export class TwilioNumbers implements PhoneNumbers {
  private readonly settings: TwilioNumbersSettings;

  constructor(settings: TwilioNumbersSettings) {
    this.settings = settings;
  }

  async buy(input: { smsUrl: string; label: string }): Promise<BuyAnswer> {
    const { accountSid, authToken, bundleSid, addressSid } = this.settings;
    const send = this.settings.fetch ?? fetch;
    const headers = { Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}` };

    // One number free to buy. Nothing is bought yet, so any failure here is certain.
    let free: unknown;
    try {
      const search = new URLSearchParams({ SmsEnabled: 'true', VoiceEnabled: 'true', PageSize: '1' });
      const answer = await send(`${TWILIO_API}/Accounts/${accountSid}/AvailablePhoneNumbers/GB/Mobile.json?${search.toString()}`, { headers });
      if (!answer.ok) return { ok: false, why: 'refused' };
      free = await answer.json();
    } catch {
      return { ok: false, why: 'refused' };
    }
    const offered = (free as { available_phone_numbers?: { phone_number?: unknown }[] } | null)?.available_phone_numbers?.[0]?.phone_number;
    const number = callerNumber(typeof offered === 'string' ? offered : null);
    if (number.kind !== 'mobile') return { ok: false, why: 'none_free' };

    // Buying it. From here an answer that says nothing certain is unclear.
    const form = new URLSearchParams({
      PhoneNumber: number.number,
      FriendlyName: input.label,
      SmsUrl: input.smsUrl,
      SmsMethod: 'POST',
      BundleSid: bundleSid,
      AddressSid: addressSid,
    });
    let answer: Response;
    try {
      answer = await send(`${TWILIO_API}/Accounts/${accountSid}/IncomingPhoneNumbers.json`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    } catch {
      return { ok: false, why: 'unclear' };
    }
    if (answer.status >= 400 && answer.status < 500 && answer.status !== 408 && answer.status !== 429) return { ok: false, why: 'refused' };
    const bought = (await answer.json().catch(() => null)) as { sid?: unknown; phone_number?: unknown } | null;
    if (!answer.ok || typeof bought?.sid !== 'string' || bought.phone_number !== number.number) return { ok: false, why: 'unclear' };
    return { ok: true, number: number.number, sid: bought.sid };
  }
}

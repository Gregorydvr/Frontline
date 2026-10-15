// Buying a firm's number through Twilio's API (task 3 of queue 2), with a
// pretend network: nothing here reaches Twilio, and nothing is bought. The
// account, bundle and address ids are invented, in Twilio's forms.

import { describe, expect, it } from 'vitest';
import { numbersSettingsWhole, TwilioNumbers } from '../src/providers/numbers/twilio';

const SETTINGS = {
  accountSid: `AC${'0'.repeat(32)}`,
  authToken: 'invented-token',
  bundleSid: `BU${'1'.repeat(32)}`,
  addressSid: `AD${'2'.repeat(32)}`,
};
const ASK = { smsUrl: 'https://app.example/twilio/texts', label: '0aaaaaaaaaaaaaaaaaaaaaaaaa' };
const ACCOUNT = `https://api.twilio.com/2010-04-01/Accounts/${SETTINGS.accountSid}`;

/** A pretend Twilio: the list of free numbers, then the answer to buying one. */
function pretendTwilio(free: unknown, bought: Response | Error) {
  const asked: { url: string; method: string; form: Record<string, string> | null; auth: string | null }[] = [];
  const network = ((url: string, init: RequestInit = {}) => {
    asked.push({
      url,
      method: init.method ?? 'GET',
      form: typeof init.body === 'string' ? Object.fromEntries(new URLSearchParams(init.body)) : null,
      auth: new Headers(init.headers).get('Authorization'),
    });
    if ((init.method ?? 'GET') === 'GET') return Promise.resolve(Response.json(free));
    return bought instanceof Error ? Promise.reject(bought) : Promise.resolve(bought);
  }) as unknown as typeof fetch;
  return { numbers: new TwilioNumbers({ ...SETTINGS, fetch: network }), asked };
}

describe('buying a number through Twilio', () => {
  it('finds a free UK mobile that takes texts and calls, then buys it under the bundle and address, with texts to Front-line', async () => {
    const { numbers, asked } = pretendTwilio(
      { available_phone_numbers: [{ phone_number: '+447700900555' }] },
      Response.json({ sid: `PN${'3'.repeat(32)}`, phone_number: '+447700900555' }, { status: 201 }),
    );
    expect(await numbers.buy(ASK)).toEqual({ ok: true, number: '+447700900555', sid: `PN${'3'.repeat(32)}` });
    const auth = `Basic ${btoa(`${SETTINGS.accountSid}:${SETTINGS.authToken}`)}`;
    expect(asked).toEqual([
      { url: `${ACCOUNT}/AvailablePhoneNumbers/GB/Mobile.json?SmsEnabled=true&VoiceEnabled=true&PageSize=1`, method: 'GET', form: null, auth },
      {
        url: `${ACCOUNT}/IncomingPhoneNumbers.json`,
        method: 'POST',
        form: {
          PhoneNumber: '+447700900555',
          FriendlyName: ASK.label,
          SmsUrl: ASK.smsUrl,
          SmsMethod: 'POST',
          BundleSid: SETTINGS.bundleSid,
          AddressSid: SETTINGS.addressSid,
        },
        auth,
      },
    ]);
  });

  it('buys nothing when none is free, or the one offered is not a UK mobile', async () => {
    for (const free of [{ available_phone_numbers: [] }, { available_phone_numbers: [{ phone_number: '+441632960001' }] }, null]) {
      const { numbers, asked } = pretendTwilio(free, new Error('never asked'));
      expect(await numbers.buy(ASK)).toEqual({ ok: false, why: 'none_free' });
      expect(asked.filter((one) => one.method === 'POST')).toEqual([]);
    }
  });

  it('reads a refusal as certain, and an answer that does not say as unclear, never as bought', async () => {
    const free = { available_phone_numbers: [{ phone_number: '+447700900555' }] };
    expect(await pretendTwilio(free, Response.json({ code: 21649 }, { status: 400 })).numbers.buy(ASK)).toEqual({ ok: false, why: 'refused' });
    expect(await pretendTwilio(free, Response.json({}, { status: 500 })).numbers.buy(ASK)).toEqual({ ok: false, why: 'unclear' });
    expect(await pretendTwilio(free, Response.json({}, { status: 429 })).numbers.buy(ASK)).toEqual({ ok: false, why: 'unclear' });
    expect(await pretendTwilio(free, new Error('down')).numbers.buy(ASK)).toEqual({ ok: false, why: 'unclear' });
    // A different number in the answer than the one asked for is not taken as bought.
    expect(await pretendTwilio(free, Response.json({ sid: 'PN1', phone_number: '+447700900556' }, { status: 201 })).numbers.buy(ASK)).toEqual({ ok: false, why: 'unclear' });
  });

  it('is built only from whole settings', () => {
    expect(numbersSettingsWhole(SETTINGS)).toBe(true);
    expect(numbersSettingsWhole({ ...SETTINGS, bundleSid: '' })).toBe(false);
    expect(numbersSettingsWhole({ ...SETTINGS, addressSid: 'AD1' })).toBe(false);
    expect(numbersSettingsWhole({ ...SETTINGS, authToken: '' })).toBe(false);
    expect(numbersSettingsWhole({ ...SETTINGS, accountSid: 'AC1' })).toBe(false);
  });
});

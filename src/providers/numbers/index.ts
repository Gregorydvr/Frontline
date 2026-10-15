// Buying a firm's number (task 3 of queue 2 in docs/autopilot.md). Buying one
// costs money, so it is switched off on every copy: a copy has it only when
// its NUMBERS_ON setting is "yes" and the Twilio regulatory bundle and
// address it needs are set (src/index.ts). Until then, Deps.numbers is null
// and nothing reaches Twilio. Two versions sit behind it: Twilio's own API,
// and a stand-in for tests, which reaches nothing.

import type { UkMobile } from '../../phone';

/** What came of asking for a number. */
export type BuyAnswer =
  /** Bought: the number, and Twilio's id for it. */
  | { ok: true; number: UkMobile; sid: string }
  /**
   * Not bought: none was free to buy (none_free), or Twilio refused, such as
   * a bundle it does not accept (refused). Certain: nothing was bought.
   */
  | { ok: false; why: 'none_free' | 'refused' }
  /** Twilio's answer did not say whether it was bought. Staff check its account by hand. */
  | { ok: false; why: 'unclear' };

export interface PhoneNumbers {
  /**
   * Buys one UK mobile number that can take texts and calls, with texts that
   * come in sent to `smsUrl`. `label` is how Twilio's console names it: the
   * firm's id, never a name.
   */
  buy(input: { smsUrl: string; label: string }): Promise<BuyAnswer>;
}

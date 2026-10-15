// The stand-in for buying numbers, used in tests. It reaches nothing, and
// keeps every number it was asked for. A test can make the next request
// answer as Twilio might.

import { ukMobile } from '../../phone';
import type { BuyAnswer, PhoneNumbers } from '.';

export class FakeNumbers implements PhoneNumbers {
  /** Every request, in order. */
  readonly bought: { smsUrl: string; label: string }[] = [];
  /** What the next requests get in place of a number, first to last. */
  private readonly upcoming: ('none_free' | 'refused' | 'unclear')[] = [];

  willAnswer(answer: 'none_free' | 'refused' | 'unclear'): void {
    this.upcoming.push(answer);
  }

  buy(input: { smsUrl: string; label: string }): Promise<BuyAnswer> {
    const upcoming = this.upcoming.shift();
    if (upcoming !== undefined) return Promise.resolve({ ok: false, why: upcoming });
    this.bought.push(input);
    // Numbers in the range set aside for drama, from 07700 900500 up.
    const number = ukMobile(`07700 900${String(500 + this.bought.length)}`);
    return Promise.resolve({ ok: true, number, sid: `PN${'0'.repeat(31)}${String(this.bought.length)}` });
  }
}

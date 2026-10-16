// The stand-in for Stripe, used in tests. It reaches nothing and keeps what it
// was asked. Asked twice with the same attempt, it gives back the same
// customer and subscription, as Stripe does with the same idempotency key. A
// test can make the next request answer as Stripe might.

import type { StripeBilling, StripeDone, SubscribeAnswer } from '.';

/** Every stand-in's customers and subscriptions are numbered together, as Stripe's ids are each its own. */
let made = 0;

export class FakeStripe implements StripeBilling {
  /** Every subscription made, by attempt. */
  readonly subscriptions = new Map<string, { firm: string; name: string; monthlyPence: number; description: string; trialEnd: number; customer: string; subscription: string }>();
  readonly cancelled: { subscription: string; atPeriodEnd: boolean }[] = [];
  readonly cardsUsed: { setupIntent: string; customer: string; subscription: string }[] = [];
  readonly cardLinks: { firm: string; customer: string; returnUrl: string }[] = [];
  /** What the next request that changes something gets, in place of doing it. */
  willAnswer: 'refused' | 'unclear' | null = null;

  subscribe(input: { firm: string; name: string; monthlyPence: number; description: string; trialEnd: number; attempt: string }): Promise<SubscribeAnswer> {
    const why = this.take();
    if (why !== null) return Promise.resolve({ ok: false, why });
    const earlier = this.subscriptions.get(input.attempt);
    if (earlier === undefined) made += 1;
    const subscribed = earlier ?? {
      ...input,
      customer: `cus_test${String(made).padStart(10, '0')}`,
      subscription: `sub_test${String(made).padStart(10, '0')}`,
    };
    this.subscriptions.set(input.attempt, subscribed);
    return Promise.resolve({ ok: true, customer: subscribed.customer, subscription: subscribed.subscription, status: 'trialing' });
  }

  cardLink(input: { firm: string; customer: string; returnUrl: string }): Promise<{ ok: true; url: string } | { ok: false }> {
    if (this.take() !== null) return Promise.resolve({ ok: false });
    this.cardLinks.push(input);
    return Promise.resolve({ ok: true, url: `https://checkout.stripe.example/c/test_${String(this.cardLinks.length)}` });
  }

  useCard(input: { setupIntent: string; customer: string; subscription: string }): Promise<StripeDone> {
    const why = this.take();
    if (why !== null) return Promise.resolve({ ok: false, why });
    this.cardsUsed.push(input);
    return Promise.resolve({ ok: true });
  }

  cancel(input: { subscription: string; atPeriodEnd: boolean }): Promise<StripeDone> {
    const why = this.take();
    if (why !== null) return Promise.resolve({ ok: false, why });
    this.cancelled.push(input);
    return Promise.resolve({ ok: true });
  }

  private take(): 'refused' | 'unclear' | null {
    const why = this.willAnswer;
    this.willAnswer = null;
    return why;
  }
}

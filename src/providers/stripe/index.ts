// Billing firms through Stripe (task 2 of queue 3 in docs/autopilot.md), in
// test mode only. Two versions sit behind it: Stripe's own API, which the
// Worker builds only with a test key (src/index.ts), and a stand-in for this
// machine and the tests, which reaches nothing. Card details never reach
// Front-line: Stripe's own page takes them (rule 7). Only the actions in
// src/actions.ts use it; lint fails Stripe's address anywhere outside this
// folder.

/** What came of making a firm's customer and subscription in Stripe. */
export type SubscribeAnswer =
  | { ok: true; customer: string; subscription: string; status: string }
  /** Refused: certain that nothing was made. Unclear: Stripe's answer did not say, so staff check Stripe by hand. */
  | { ok: false; why: 'refused' | 'unclear' };

/** What came of a request that changes something in Stripe. */
export type StripeDone = { ok: true } | { ok: false; why: 'refused' | 'unclear' };

export interface StripeBilling {
  /**
   * Makes the firm's customer, named as the firm, and its monthly
   * subscription, with a free trial until `trialEnd` (seconds since 1970).
   * `attempt` names this try: asked again with the same, Stripe gives back
   * what it made the first time, so nothing is made twice.
   */
  subscribe(input: { firm: string; name: string; monthlyPence: number; description: string; trialEnd: number; attempt: string }): Promise<SubscribeAnswer>;
  /** A link to Stripe's own page, where the owner adds a card for the subscription. It works for a day. */
  cardLink(input: { firm: string; customer: string; returnUrl: string }): Promise<{ ok: true; url: string } | { ok: false }>;
  /** Makes the card the owner added on Stripe's page the one the subscription charges. */
  useCard(input: { setupIntent: string; customer: string; subscription: string }): Promise<StripeDone>;
  /** Cancels the subscription: at once, or at the end of the month paid for. */
  cancel(input: { subscription: string; atPeriodEnd: boolean }): Promise<StripeDone>;
}

/** Whether a key is one of Stripe's test keys. A live key is never used. */
export function isTestKey(key: string): boolean {
  return /^(sk|rk)_test_[0-9A-Za-z]{10,}$/.test(key);
}

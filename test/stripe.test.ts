// Stripe's API (task 2 of queue 3), with a pretend network: nothing here
// reaches Stripe, and every key and id is invented. A live key is never
// used, the requests are the ones Stripe's documentation gives, and only a
// signed event within five minutes is taken.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { stripeBilling } from '../src/index';
import { isTestKey } from '../src/providers/stripe';
import { isFromStripe, readStripeEvent, StripeApi, stripeSignature } from '../src/providers/stripe/api';

const TEST_KEY = `sk_test_${'a'.repeat(24)}`;
const LIVE_KEY = `sk_live_${'a'.repeat(24)}`;
const PRODUCT = 'prod_InventedOne';

/** A pretend Stripe that answers each request in turn, and keeps what it was asked. */
function pretendStripe(answers: (Response | Error)[]) {
  const asked: { url: string; method: string; form: Record<string, string> | null; key: string | null; idempotency: string | null }[] = [];
  const network = ((url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    asked.push({
      url,
      method: init.method ?? 'GET',
      form: typeof init.body === 'string' ? Object.fromEntries(new URLSearchParams(init.body)) : null,
      key: headers.get('Authorization'),
      idempotency: headers.get('Idempotency-Key'),
    });
    const answer = answers.shift() ?? new Error('No answer');
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  }) as unknown as typeof fetch;
  return { stripe: new StripeApi({ key: TEST_KEY, product: PRODUCT, fetch: network }), asked };
}

const SUBSCRIBE = { firm: '0aaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Invented Plumbing', monthlyPence: 8_000, description: 'Calls & bookings', trialEnd: 1_793_000_000, attempt: 'try-1' };

describe('Stripe, test mode only', () => {
  it('takes only Stripe’s test keys', () => {
    expect(isTestKey(TEST_KEY)).toBe(true);
    expect(isTestKey(`rk_test_${'b'.repeat(24)}`)).toBe(true);
    expect(isTestKey(LIVE_KEY)).toBe(false);
    expect(isTestKey(`rk_live_${'b'.repeat(24)}`)).toBe(false);
    expect(isTestKey('')).toBe(false);
    expect(() => new StripeApi({ key: LIVE_KEY, product: PRODUCT })).toThrow(RangeError);
  });

  it('is built on a deployed copy only with a test key and a product, and never on live', () => {
    const of = (change: Record<string, string>) => stripeBilling({ ...env, COPY: 'practice', STRIPE_SECRET_KEY: TEST_KEY, STRIPE_PRODUCT_ID: PRODUCT, ...change } as unknown as Env);
    expect(of({})).not.toBeNull();
    expect(of({ STRIPE_SECRET_KEY: LIVE_KEY })).toBeNull();
    expect(of({ STRIPE_SECRET_KEY: '' })).toBeNull();
    expect(of({ STRIPE_PRODUCT_ID: '' })).toBeNull();
    expect(of({ COPY: 'live' })).toBeNull();
    // Every copy as wrangler.jsonc gives it to the tests: no billing.
    expect(stripeBilling(env)).toBeNull();
  });
});

describe('subscribing a firm', () => {
  it('makes its customer, then a monthly subscription in pounds with its free trial, each with a key that makes a retry harmless', async () => {
    const { stripe, asked } = pretendStripe([
      Response.json({ id: 'cus_Invented1' }),
      Response.json({ id: 'sub_Invented1', status: 'trialing' }),
    ]);
    expect(await stripe.subscribe(SUBSCRIBE)).toEqual({ ok: true, customer: 'cus_Invented1', subscription: 'sub_Invented1', status: 'trialing' });
    expect(asked).toEqual([
      {
        url: 'https://api.stripe.com/v1/customers',
        method: 'POST',
        form: { name: 'Invented Plumbing', 'metadata[firm]': SUBSCRIBE.firm },
        key: `Bearer ${TEST_KEY}`,
        idempotency: 'frontline-try-1-customer',
      },
      {
        url: 'https://api.stripe.com/v1/subscriptions',
        method: 'POST',
        form: {
          customer: 'cus_Invented1',
          'items[0][price_data][currency]': 'gbp',
          'items[0][price_data][product]': PRODUCT,
          'items[0][price_data][unit_amount]': '8000',
          'items[0][price_data][recurring][interval]': 'month',
          trial_end: '1793000000',
          'trial_settings[end_behavior][missing_payment_method]': 'pause',
          'payment_settings[save_default_payment_method]': 'on_subscription',
          description: 'Calls & bookings',
          'metadata[firm]': SUBSCRIBE.firm,
        },
        key: `Bearer ${TEST_KEY}`,
        idempotency: 'frontline-try-1-subscription',
      },
    ]);
  });

  it('reads a refusal as certain, and an answer that does not say as unclear', async () => {
    expect(await pretendStripe([Response.json({ error: {} }, { status: 400 })]).stripe.subscribe(SUBSCRIBE)).toEqual({ ok: false, why: 'refused' });
    expect(await pretendStripe([Response.json({}, { status: 500 })]).stripe.subscribe(SUBSCRIBE)).toEqual({ ok: false, why: 'unclear' });
    expect(await pretendStripe([new Error('down')]).stripe.subscribe(SUBSCRIBE)).toEqual({ ok: false, why: 'unclear' });
    expect(await pretendStripe([Response.json({ id: 'cus_I' }), Response.json({}, { status: 429 })]).stripe.subscribe(SUBSCRIBE)).toEqual({ ok: false, why: 'unclear' });
    expect(await pretendStripe([Response.json({ id: 'cus_I' }), Response.json({ error: {} }, { status: 402 })]).stripe.subscribe(SUBSCRIBE)).toEqual({ ok: false, why: 'refused' });
  });
});

describe('a card, and cancelling', () => {
  it('makes a link to Stripe’s own page that takes a card, for the firm’s customer', async () => {
    const { stripe, asked } = pretendStripe([Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_test_invented' })]);
    expect(await stripe.cardLink({ firm: SUBSCRIBE.firm, customer: 'cus_Invented1', returnUrl: 'https://app.example/' })).toEqual({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_invented' });
    expect(asked[0]?.form).toEqual({
      mode: 'setup',
      customer: 'cus_Invented1',
      currency: 'gbp',
      success_url: 'https://app.example/',
      'metadata[firm]': SUBSCRIBE.firm,
      'setup_intent_data[metadata][firm]': SUBSCRIBE.firm,
    });
  });

  it('makes the card the owner added the one charged, on the customer and the subscription', async () => {
    const { stripe, asked } = pretendStripe([Response.json({ id: 'seti_Invented', payment_method: 'pm_Invented' }), Response.json({ id: 'cus_Invented1' }), Response.json({ id: 'sub_Invented1' })]);
    expect(await stripe.useCard({ setupIntent: 'seti_Invented', customer: 'cus_Invented1', subscription: 'sub_Invented1' })).toEqual({ ok: true });
    expect(asked.map((one) => [one.method, one.url.replace('https://api.stripe.com/v1', ''), one.form])).toEqual([
      ['GET', '/setup_intents/seti_Invented', null],
      ['POST', '/customers/cus_Invented1', { 'invoice_settings[default_payment_method]': 'pm_Invented' }],
      ['POST', '/subscriptions/sub_Invented1', { default_payment_method: 'pm_Invented' }],
    ]);
  });

  it('cancels at once, or at the end of the month paid for', async () => {
    const now = pretendStripe([Response.json({ id: 'sub_Invented1', status: 'canceled' })]);
    expect(await now.stripe.cancel({ subscription: 'sub_Invented1', atPeriodEnd: false })).toEqual({ ok: true });
    expect([now.asked[0]?.method, now.asked[0]?.url]).toEqual(['DELETE', 'https://api.stripe.com/v1/subscriptions/sub_Invented1']);
    const later = pretendStripe([Response.json({ id: 'sub_Invented1', status: 'active' })]);
    expect(await later.stripe.cancel({ subscription: 'sub_Invented1', atPeriodEnd: true })).toEqual({ ok: true });
    expect([later.asked[0]?.method, later.asked[0]?.form]).toEqual(['POST', { cancel_at_period_end: 'true' }]);
  });
});

describe('events from Stripe', () => {
  const SECRET = 'whsec_invented';
  const body = JSON.stringify({ id: 'evt_Invented1', created: 1_792_000_000, type: 'invoice.paid', data: { object: { customer: 'cus_Invented1' } } });

  it('takes one signed with the secret within five minutes, and nothing else', async () => {
    const now = 1_792_000_100;
    const signature = await stripeSignature(SECRET, now - 10, body);
    expect(await isFromStripe(SECRET, body, `t=${String(now - 10)},v1=${signature}`, now)).toBe(true);
    // Another of Stripe's signatures beside it, as while a secret is being changed.
    expect(await isFromStripe(SECRET, body, `t=${String(now - 10)},v1=${'0'.repeat(64)},v1=${signature}`, now)).toBe(true);
    expect(await isFromStripe('whsec_other', body, `t=${String(now - 10)},v1=${signature}`, now)).toBe(false);
    expect(await isFromStripe(SECRET, `${body} `, `t=${String(now - 10)},v1=${signature}`, now)).toBe(false);
    const old = await stripeSignature(SECRET, now - 301, body);
    expect(await isFromStripe(SECRET, body, `t=${String(now - 301)},v1=${old}`, now)).toBe(false);
    expect(await isFromStripe(undefined, body, `t=${String(now - 10)},v1=${signature}`, now)).toBe(false);
    expect(await isFromStripe(SECRET, body, null, now)).toBe(false);
  });

  it('reads only the ids and states Front-line keeps', () => {
    expect(
      readStripeEvent(
        JSON.stringify({
          id: 'evt_Sub1',
          created: 5,
          type: 'customer.subscription.updated',
          data: { object: { customer: 'cus_A1', status: 'active', cancel_at_period_end: true, items: { data: [{ current_period_end: 99 }] }, metadata: { anything: 'else' } } },
        }),
      ),
    ).toEqual({ id: 'evt_Sub1', created: 5, kind: 'subscription', customer: 'cus_A1', status: 'active', cancelAtPeriodEnd: true, periodEnd: 99 });
    expect(readStripeEvent(JSON.stringify({ id: 'evt_F', created: 6, type: 'invoice.payment_failed', data: { object: { customer: 'cus_A1' } } }))).toEqual({ id: 'evt_F', created: 6, kind: 'payment_failed', customer: 'cus_A1' });
    expect(readStripeEvent(JSON.stringify({ id: 'evt_C', created: 7, type: 'checkout.session.completed', data: { object: { mode: 'setup', customer: 'cus_A1', setup_intent: 'seti_1' } } }))).toEqual({
      id: 'evt_C',
      created: 7,
      kind: 'card_added',
      customer: 'cus_A1',
      setupIntent: 'seti_1',
    });
    expect(readStripeEvent(JSON.stringify({ id: 'evt_O', created: 8, type: 'charge.succeeded', data: { object: {} } }))).toEqual({ id: 'evt_O', created: 8, kind: 'other' });
    expect(readStripeEvent('not json')).toBeNull();
    expect(readStripeEvent(JSON.stringify({ id: 'not-an-event', created: 1, type: 'x' }))).toBeNull();
  });
});

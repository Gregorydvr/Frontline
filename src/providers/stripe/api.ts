// Stripe's own API, in test mode only. The Worker builds this only with one
// of Stripe's test keys (src/index.ts), and it refuses any other, so no live
// key is ever used. The tests of this file use a pretend network.
//
// From Stripe's documentation, read 16 Oct 2026: POST /v1/customers;
// POST /v1/subscriptions with an inline monthly price
// (`items[0][price_data]`, which needs an existing product: the copy's
// STRIPE_PRODUCT_ID), `trial_end`, and what happens when the trial ends with
// no card (`trial_settings[end_behavior][missing_payment_method]`);
// POST /v1/checkout/sessions in `setup` mode for Stripe's own page that takes
// a card; and the `Stripe-Signature` header on each event Stripe sends. The
// same Idempotency-Key makes a retry give back what the first request made.
// Nothing is logged but ids, and the key never.

import { sameSecret } from '../../secret';
import { isTestKey, type StripeBilling, type StripeDone, type SubscribeAnswer } from '.';

const STRIPE_API = 'https://api.stripe.com/v1';

/**
 * What happens when a firm's trial ends with no card on file: the
 * subscription pauses, and nothing is charged until a card is added. The
 * build's choice, waiting for Greg (open question 20).
 */
export const TRIAL_ENDS_WITHOUT_CARD = 'pause';

export interface StripeSettings {
  /** One of Stripe's test keys. Anything else is refused. */
  key: string;
  /** Stripe's id for the product each firm's monthly price belongs to. */
  product: string;
  /** The network. Tests pass a pretend one. */
  fetch?: typeof fetch;
}

export class StripeApi implements StripeBilling {
  private readonly key: string;
  private readonly product: string;
  private readonly send: typeof fetch;

  constructor(settings: StripeSettings) {
    if (!isTestKey(settings.key)) throw new RangeError('Only a Stripe test key is used');
    if (!/^prod_[0-9A-Za-z]{6,}$/.test(settings.product)) throw new RangeError('Not a Stripe product id');
    this.key = settings.key;
    this.product = settings.product;
    this.send = settings.fetch ?? fetch;
  }

  async subscribe(input: { firm: string; name: string; monthlyPence: number; description: string; trialEnd: number; attempt: string }): Promise<SubscribeAnswer> {
    const customer = await this.ask('POST', '/customers', { name: input.name, 'metadata[firm]': input.firm }, `frontline-${input.attempt}-customer`);
    if (!customer.ok) return { ok: false, why: customer.why };
    const customerId = customer.body.id;
    if (typeof customerId !== 'string') return { ok: false, why: 'unclear' };
    const subscription = await this.ask(
      'POST',
      '/subscriptions',
      {
        customer: customerId,
        'items[0][price_data][currency]': 'gbp',
        'items[0][price_data][product]': this.product,
        'items[0][price_data][unit_amount]': String(input.monthlyPence),
        'items[0][price_data][recurring][interval]': 'month',
        trial_end: String(input.trialEnd),
        'trial_settings[end_behavior][missing_payment_method]': TRIAL_ENDS_WITHOUT_CARD,
        'payment_settings[save_default_payment_method]': 'on_subscription',
        description: input.description,
        'metadata[firm]': input.firm,
      },
      `frontline-${input.attempt}-subscription`,
    );
    if (!subscription.ok) return { ok: false, why: subscription.why === 'refused' ? 'refused' : 'unclear' };
    const { id, status } = subscription.body;
    if (typeof id !== 'string' || typeof status !== 'string') return { ok: false, why: 'unclear' };
    return { ok: true, customer: customerId, subscription: id, status };
  }

  async cardLink(input: { firm: string; customer: string; returnUrl: string }): Promise<{ ok: true; url: string } | { ok: false }> {
    const made = await this.ask('POST', '/checkout/sessions', {
      mode: 'setup',
      customer: input.customer,
      currency: 'gbp',
      success_url: input.returnUrl,
      'metadata[firm]': input.firm,
      'setup_intent_data[metadata][firm]': input.firm,
    });
    const url = made.ok ? made.body.url : null;
    return typeof url === 'string' && url.startsWith('https://') ? { ok: true, url } : { ok: false };
  }

  async useCard(input: { setupIntent: string; customer: string; subscription: string }): Promise<StripeDone> {
    if (!/^seti_[0-9A-Za-z]+$/.test(input.setupIntent)) return { ok: false, why: 'refused' };
    const intent = await this.ask('GET', `/setup_intents/${input.setupIntent}`, null);
    if (!intent.ok) return { ok: false, why: intent.why };
    const card = intent.body.payment_method;
    if (typeof card !== 'string') return { ok: false, why: 'refused' };
    const onCustomer = await this.ask('POST', `/customers/${input.customer}`, { 'invoice_settings[default_payment_method]': card });
    if (!onCustomer.ok) return { ok: false, why: onCustomer.why };
    const onSubscription = await this.ask('POST', `/subscriptions/${input.subscription}`, { default_payment_method: card });
    return onSubscription.ok ? { ok: true } : { ok: false, why: onSubscription.why };
  }

  async cancel(input: { subscription: string; atPeriodEnd: boolean }): Promise<StripeDone> {
    const done = input.atPeriodEnd
      ? await this.ask('POST', `/subscriptions/${input.subscription}`, { cancel_at_period_end: 'true' })
      : await this.ask('DELETE', `/subscriptions/${input.subscription}`, null);
    return done.ok ? { ok: true } : { ok: false, why: done.why };
  }

  /** One request to Stripe. A refusal of the request itself is certain; anything else may have changed something. */
  private async ask(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    form: Record<string, string> | null,
    idempotencyKey?: string,
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; why: 'refused' | 'unclear' }> {
    if (!/^\/[a-z_]+(\/[0-9A-Za-z_]+)?$/.test(path.replace('/checkout/sessions', '/checkout_sessions'))) return { ok: false, why: 'refused' };
    const headers: Record<string, string> = { Authorization: `Bearer ${this.key}` };
    if (form !== null) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
    let answer: Response;
    try {
      answer = await this.send(`${STRIPE_API}${path}`, { method, headers, body: form === null ? undefined : new URLSearchParams(form).toString() });
    } catch {
      return { ok: false, why: 'unclear' };
    }
    if (answer.status >= 400 && answer.status < 500 && answer.status !== 408 && answer.status !== 409 && answer.status !== 429) return { ok: false, why: 'refused' };
    const body: unknown = await answer.json().catch(() => null);
    if (!answer.ok || typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, why: 'unclear' };
    return { ok: true, body: body as Record<string, unknown> };
  }
}

/** How long after Stripe signed an event it is still taken, as Stripe's own libraries allow. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Whether an event is from Stripe: the `Stripe-Signature` header holds the
 * time it was signed (`t=`) and one or more signatures (`v1=`), each the
 * HMAC-SHA256, in hex, of "{t}.{the body as sent}" with the endpoint's
 * signing secret; and it was signed within five minutes of now.
 */
export async function isFromStripe(secret: string | undefined, body: string, header: string | null | undefined, nowSeconds: number): Promise<boolean> {
  if (secret === undefined || secret.trim() === '' || header === null || header === undefined) return false;
  const parts = header.split(',').map((part) => part.trim().split('='));
  const signedAt = Number(parts.find(([name]) => name === 't')?.[1]);
  const signatures = parts.filter(([name, value]) => name === 'v1' && value !== undefined).map(([, value]) => value ?? '');
  if (!Number.isSafeInteger(signedAt) || signatures.length === 0 || Math.abs(nowSeconds - signedAt) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = await stripeSignature(secret, signedAt, body);
  for (const signature of signatures) {
    if (await sameSecret(signature, expected)) return true;
  }
  return false;
}

/** The signature Stripe puts on an event: also used by the tests to sign their pretend events. */
export async function stripeSignature(secret: string, signedAt: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${String(signedAt)}.${body}`)));
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** An event from Stripe, read down to the ids and states Front-line keeps. */
export type StripeEvent =
  | { id: string; created: number; kind: 'subscription'; customer: string; status: string; cancelAtPeriodEnd: boolean; periodEnd: number | null }
  | { id: string; created: number; kind: 'payment_failed' | 'paid'; customer: string }
  | { id: string; created: number; kind: 'card_added'; customer: string; setupIntent: string }
  | { id: string; created: number; kind: 'other' };

/** The event Stripe sent, or null when it is not one Front-line can read. Only the fields above are kept. */
export function readStripeEvent(body: string): StripeEvent | null {
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof event !== 'object' || event === null) return null;
  const { id, created, type, data } = event as Record<string, unknown>;
  if (typeof id !== 'string' || !/^evt_[0-9A-Za-z]{1,80}$/.test(id) || typeof created !== 'number' || typeof type !== 'string') return null;
  const object = (data as { object?: unknown } | undefined)?.object as Record<string, unknown> | undefined;
  const customer = typeof object?.customer === 'string' && /^cus_[0-9A-Za-z]{1,80}$/.test(object.customer) ? object.customer : null;
  if (type.startsWith('customer.subscription.') && customer !== null && typeof object?.status === 'string') {
    const items = (object.items as { data?: { current_period_end?: unknown }[] } | undefined)?.data;
    const periodEnd = items?.[0]?.current_period_end ?? object.current_period_end;
    return {
      id,
      created,
      kind: 'subscription',
      customer,
      status: object.status,
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
      periodEnd: typeof periodEnd === 'number' ? periodEnd : null,
    };
  }
  if ((type === 'invoice.payment_failed' || type === 'invoice.paid') && customer !== null) {
    return { id, created, kind: type === 'invoice.paid' ? 'paid' : 'payment_failed', customer };
  }
  if (type === 'checkout.session.completed' && object?.mode === 'setup' && customer !== null && typeof object.setup_intent === 'string') {
    return { id, created, kind: 'card_added', customer, setupIntent: object.setup_intent };
  }
  return { id, created, kind: 'other' };
}

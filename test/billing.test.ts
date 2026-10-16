// Billing a firm (task 2 of queue 3 in docs/autopilot.md), in Stripe's test
// mode, against the stand-in for Stripe: nothing reaches Stripe and no card
// is involved. Greg's prices, worked out in code in whole pence; going live
// starts a 14-day free trial; the first 20 firms keep their price; cancel
// any time; and Stripe's events, signed, kept once, newest standing.
//
// The firms are invented, on numbers set aside for drama.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ALL_FIVE_PRICE, cancelsAtPeriodEnd, FOUNDING_FIRMS, monthlyPrice, SERVICE_PRICES, stateFromStripe, TRIAL_DAYS, trialEndsAt } from '../src/billing';
import { instant, instantFromIso, pretendClock } from '../src/clock';
import { formatMoney } from '../src/money';
import { stripeSignature } from '../src/providers/stripe/api';
import { claimBilling, createFirm, getBilling, getFirm } from '../src/record';
import { openRecord } from '../src/record/db';
import { SERVICES, type FirmId } from '../src/record/types';
import { CONTROL_WORDS } from '../src/screens/control';
import { controlForm } from './helpers/control';
import { firmRows } from './helpers/db';
import { liveFirm, readyFirm, systemFor, type System } from './helpers/live';

// The morning of the example's call through each firm's number, as in test/go-live.test.ts.
const clock = pretendClock(instantFromIso('2026-10-15T11:00:00+01:00'));
const db = openRecord(env.DB, clock);
const DAY = 24 * 60 * 60_000;

/** The control room's words, as the page escapes them. */
function escaped(words: string): string {
  return words.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Sends an event to the system as Stripe does, signed with the copy's secret. */
async function fromStripe(system: System, event: Record<string, unknown>, secret = env.STRIPE_WEBHOOK_SECRET): Promise<number> {
  const body = JSON.stringify(event);
  const signedAt = Math.floor(clock.now() / 1000);
  const signature = await stripeSignature(secret, signedAt, body);
  const answer = await system.app.request('/stripe/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(body.length), 'Stripe-Signature': `t=${String(signedAt)},v1=${signature}` },
    body,
  }, env);
  return answer.status;
}

/** An event about a firm's subscription, as Stripe sends it. */
function subscriptionEvent(id: string, customer: string, status: string, created: number, cancelAtPeriodEnd = false): Record<string, unknown> {
  return { id, created, type: 'customer.subscription.updated', data: { object: { customer, status, cancel_at_period_end: cancelAtPeriodEnd, items: { data: [{ current_period_end: created + 30 * 86_400 }] } } } };
}

describe('Front-line’s prices', () => {
  it('are Greg’s, in whole pence: £80 for Calls & bookings, £50 for each other service, £150 for all five, no VAT', () => {
    expect(SERVICE_PRICES).toEqual({ calls: 8_000, quotes: 5_000, followups: 5_000, paperwork: 5_000, invoices: 5_000 });
    expect(monthlyPrice(['calls'])).toBe(8_000);
    expect(monthlyPrice(['quotes'])).toBe(5_000);
    expect(monthlyPrice(['calls', 'invoices'])).toBe(13_000);
    expect(monthlyPrice(['quotes', 'calls'])).toBe(13_000);
    expect(monthlyPrice([...SERVICES])).toBe(ALL_FIVE_PRICE);
    expect(ALL_FIVE_PRICE).toBe(15_000);
    expect(monthlyPrice([])).toBe(0);
    expect(formatMoney(monthlyPrice(['calls', 'invoices']))).toBe('£130');
    for (const price of [...Object.values(SERVICE_PRICES), ALL_FIVE_PRICE]) expect(Number.isSafeInteger(price)).toBe(true);
  });

  it('start a 14-day trial from going live, and never one that has already ended', () => {
    const live = instantFromIso('2026-10-16T10:00:00+01:00');
    expect(TRIAL_DAYS).toBe(14);
    expect(trialEndsAt(live, live)).toBe(live + 14 * DAY);
    // Billing started late, after the trial would have ended, still gives two days.
    expect(trialEndsAt(live, instant(live + 20 * DAY))).toBe(live + 22 * DAY);
  });

  it('read Stripe’s states, and cancel at the end of the month only for a firm paying', () => {
    expect(stateFromStripe('trialing', false)).toBe('trialing');
    expect(stateFromStripe('active', true)).toBe('cancelling');
    expect(stateFromStripe('past_due', false)).toBe('past_due');
    expect(stateFromStripe('paused', false)).toBe('paused');
    expect(stateFromStripe('canceled', false)).toBe('cancelled');
    expect(stateFromStripe('something_new', false)).toBe('unclear');
    expect(cancelsAtPeriodEnd('active')).toBe(true);
    for (const state of ['trialing', 'paused', 'past_due'] as const) expect(cancelsAtPeriodEnd(state)).toBe(false);
  });
});

describe('going live', () => {
  it('starts the firm’s free trial in Stripe, priced from the services it chose, recorded as started by Greg', async () => {
    const system = systemFor(clock);
    const firm = await liveFirm(db, system, '07700 900610', ['calls', 'invoices']);
    const live = (await getFirm(db, firm))?.live;
    const billing = await getBilling(db, firm);
    expect(billing).toMatchObject({ state: 'trialing', services: ['calls', 'invoices'], monthly: 13_000, cardOnFile: false, priceList: 'founding-2026-10' });
    expect(billing?.trialEndsAt).toBe((live?.at ?? 0) + 14 * DAY);
    expect(billing?.foundingNumber).toBeGreaterThanOrEqual(1);
    const [made] = [...system.deps.billing.subscriptions.values()];
    expect(made).toMatchObject({ firm, name: 'Tidewell Heating', monthlyPence: 13_000, description: 'Calls & bookings, Invoices & reminders', trialEnd: Math.floor((billing?.trialEndsAt ?? 0) / 1000) });
    expect(billing?.customer).toBe(made?.customer);
    expect(((await firmRows(env.DB, firm)).staff_log as { what: string }[]).map((row) => row.what)).toContain('started_billing');
    // Its page shows it, in test mode.
    const page = await system.open(`/control/firms/${firm}`);
    expect(page.words).toContain(escaped(CONTROL_WORDS.billingStates.trialing));
    expect(page.words).toContain('£130 for Calls &amp; bookings, Invoices &amp; reminders');
    expect(page.words).toContain(escaped(CONTROL_WORDS.billingTestMode));
  });

  it('never starts billing twice', async () => {
    const system = systemFor(clock);
    const firm = await liveFirm(db, system, '07700 900611');
    expect((await system.open(`/control/firms/${firm}/billing/start`, controlForm({}))).location).toBe(`/control/firms/${firm}?billing=already`);
    expect(system.deps.billing.subscriptions.size).toBe(1);
  });

  it('on a copy with billing switched off, goes live all the same, and starts it later at the price and trial it had', async () => {
    const off = systemFor(clock, { billing: null as never });
    const firm = await liveFirm(db, off, '07700 900612', ['calls']);
    expect(await getBilling(db, firm)).toMatchObject({ state: 'not_started', monthly: 8_000, customer: null });
    expect((await off.open(`/control/firms/${firm}`)).words).toContain(escaped(CONTROL_WORDS.billingOff));
    const trial = (await getBilling(db, firm))?.trialEndsAt;
    // Switched on later: started from the firm's page.
    const on = systemFor(clock);
    expect((await on.open(`/control/firms/${firm}/billing/start`, controlForm({}))).location).toBe(`/control/firms/${firm}?billing=started`);
    expect(await getBilling(db, firm)).toMatchObject({ state: 'trialing', monthly: 8_000, trialEndsAt: trial });
  });

  it('when Stripe refuses, can be started again; when Stripe’s answer is not clear, waits for staff to check', async () => {
    const system = systemFor(clock);
    const firm = await readyFirm(db, system, '07700 900613', ['calls']);
    system.deps.billing.willAnswer = 'refused';
    expect((await system.open(`/control/firms/${firm}/go-live`, controlForm({}))).location).toBe(`/control/firms/${firm}/go-live?done=live`);
    expect((await getBilling(db, firm))?.state).toBe('failed');
    expect((await getFirm(db, firm))?.services.calls).toBe(true);
    system.deps.billing.willAnswer = 'unclear';
    clock.set(instant(clock.now() + 1000));
    expect((await system.open(`/control/firms/${firm}/billing/start`, controlForm({}))).location).toBe(`/control/firms/${firm}?billing=unclear`);
    expect((await system.open(`/control/firms/${firm}/billing/start`, controlForm({}))).location).toBe(`/control/firms/${firm}?billing=already`);
    expect(system.deps.billing.subscriptions.size).toBe(0);
    expect((await system.open(`/control/firms/${firm}?billing=unclear`)).words).toContain(escaped(CONTROL_WORDS.billingSaid.unclear));
  });

  it('never bills an example firm', async () => {
    const example = await createFirm(db, { name: 'Example Billing Firm', isExample: true });
    expect(await claimBilling(db, example, { services: ['calls'], monthly: monthlyPrice(['calls']), trialEndsAt: clock.now() }, null)).toBeNull();
  });
});

describe('the founding price', () => {
  it('is locked for the first 20 firms billed, numbered in turn, and no others', async () => {
    const firms: FirmId[] = [];
    for (let n = 0; n < FOUNDING_FIRMS + 2; n += 1) firms.push(await createFirm(db, { name: `Founding Example Firm ${String(n)}`, isExample: false }));
    for (const firm of firms) await claimBilling(db, firm, { services: ['calls'], monthly: monthlyPrice(['calls']), trialEndsAt: clock.now() }, null);
    const numbers = await Promise.all(firms.map(async (firm) => (await getBilling(db, firm))?.foundingNumber ?? null));
    const given = numbers.filter((number) => number !== null);
    // Other tests in this file billed some firms first; every place up to 20 is taken once, and no more.
    expect(given.length).toBeLessThanOrEqual(FOUNDING_FIRMS);
    expect(new Set(given).size).toBe(given.length);
    expect(Math.max(...(given))).toBe(FOUNDING_FIRMS);
    expect(numbers.slice(-2)).toEqual([null, null]);
  });
});

describe('a card, through Stripe’s own page', () => {
  it('is added from a link staff make, shown once and kept nowhere; when Stripe says it was added, it becomes the card charged', async () => {
    const system = systemFor(clock);
    const firm = await liveFirm(db, system, '07700 900620');
    const page = await system.open(`/control/firms/${firm}/billing/card-link`, controlForm({}));
    expect(page.status).toBe(200);
    expect(page.words).toContain('https://checkout.stripe.example/c/test_1');
    expect(JSON.stringify(await firmRows(env.DB, firm))).not.toContain('checkout.stripe.example');
    expect(((await firmRows(env.DB, firm)).staff_log as { what: string }[]).map((row) => row.what)).toContain('made_card_link');
    const billing = await getBilling(db, firm);
    const added = { id: 'evt_Card620', created: 1_792_000_000, type: 'checkout.session.completed', data: { object: { mode: 'setup', customer: billing?.customer, setup_intent: 'seti_Invented620' } } };
    expect(await fromStripe(system, added)).toBe(200);
    expect(system.deps.billing.cardsUsed).toEqual([{ setupIntent: 'seti_Invented620', customer: billing?.customer, subscription: billing?.subscription }]);
    expect((await getBilling(db, firm))?.cardOnFile).toBe(true);
  });

  it('is asked of Stripe again if making it the card charged did not work, until it does', async () => {
    const system = systemFor(clock);
    const firm = await liveFirm(db, system, '07700 900621');
    const billing = await getBilling(db, firm);
    const added = { id: 'evt_Card621', created: 1_792_000_000, type: 'checkout.session.completed', data: { object: { mode: 'setup', customer: billing?.customer, setup_intent: 'seti_Invented621' } } };
    system.deps.billing.willAnswer = 'unclear';
    expect(await fromStripe(system, added)).toBe(503);
    expect((await getBilling(db, firm))?.cardOnFile).toBe(false);
    expect(await fromStripe(system, added)).toBe(200);
    expect((await getBilling(db, firm))?.cardOnFile).toBe(true);
  });
});

describe('events from Stripe', () => {
  it('are applied once, the newest standing, and only for the firm the customer is', async () => {
    const system = systemFor(clock);
    const firm = await liveFirm(db, system, '07700 900630');
    const other = await liveFirm(db, system, '07700 900631');
    const customer = (await getBilling(db, firm))?.customer ?? '';
    expect(await fromStripe(system, subscriptionEvent('evt_A630', customer, 'active', 1_793_000_000))).toBe(200);
    expect(await getBilling(db, firm)).toMatchObject({ state: 'active', periodEndsAt: (1_793_000_000 + 30 * 86_400) * 1000 });
    // An older event, arriving late, changes nothing.
    expect(await fromStripe(system, subscriptionEvent('evt_B630', customer, 'trialing', 1_792_000_000))).toBe(200);
    expect((await getBilling(db, firm))?.state).toBe('active');
    // The same event again changes nothing more, and is kept once.
    expect(await fromStripe(system, subscriptionEvent('evt_A630', customer, 'active', 1_793_000_000))).toBe(200);
    expect(((await firmRows(env.DB, firm)).billing_events as unknown[]).length).toBe(2);
    // A failed payment.
    expect(await fromStripe(system, { id: 'evt_F630', created: 1_793_000_100, type: 'invoice.payment_failed', data: { object: { customer } } })).toBe(200);
    expect((await getBilling(db, firm))?.state).toBe('past_due');
    expect((await system.open(`/control/firms/${firm}`)).words).toContain(escaped(CONTROL_WORDS.billingStates.past_due));
    // The other firm is untouched.
    expect((await getBilling(db, other))?.state).toBe('trialing');
  });

  it('are refused unless signed with the copy’s secret, and one about a customer Front-line does not know is answered and left', async () => {
    const system = systemFor(clock);
    const firm = await liveFirm(db, system, '07700 900632');
    const customer = (await getBilling(db, firm))?.customer ?? '';
    expect(await fromStripe(system, subscriptionEvent('evt_X632', customer, 'canceled', 1_794_000_000), 'whsec_not_the_copys')).toBe(401);
    expect((await getBilling(db, firm))?.state).toBe('trialing');
    expect(await fromStripe(system, subscriptionEvent('evt_Y632', 'cus_Nobody', 'canceled', 1_794_000_000))).toBe(200);
    const unsigned = await system.app.request('/stripe/webhook', { method: 'POST', body: '{}', headers: { 'Content-Length': '2' } }, env);
    expect(unsigned.status).toBe(401);
  });
});

describe('cancelling', () => {
  it('in the free trial ends billing at once; its services stay as they are', async () => {
    const system = systemFor(clock);
    const firm = await liveFirm(db, system, '07700 900640');
    expect((await system.open(`/control/firms/${firm}/billing/cancel`, controlForm({}))).location).toBe(`/control/firms/${firm}?billing=cancelled`);
    expect(system.deps.billing.cancelled).toEqual([{ subscription: (await getBilling(db, firm))?.subscription, atPeriodEnd: false }]);
    expect((await getBilling(db, firm))?.state).toBe('cancelled');
    expect((await getFirm(db, firm))?.services.calls).toBe(true);
    expect(((await firmRows(env.DB, firm)).staff_log as { what: string }[]).map((row) => row.what)).toContain('cancelled_billing');
    expect((await system.open(`/control/firms/${firm}/billing/cancel`, controlForm({}))).location).toBe(`/control/firms/${firm}?billing=nothing_to_cancel`);
  });

  it('when paying, ends at the end of the month paid for', async () => {
    const system = systemFor(clock);
    const firm = await liveFirm(db, system, '07700 900641');
    const customer = (await getBilling(db, firm))?.customer ?? '';
    expect(await fromStripe(system, subscriptionEvent('evt_P641', customer, 'active', 1_793_000_000))).toBe(200);
    expect((await system.open(`/control/firms/${firm}/billing/cancel`, controlForm({}))).location).toBe(`/control/firms/${firm}?billing=cancelling`);
    expect(system.deps.billing.cancelled.at(-1)).toMatchObject({ atPeriodEnd: true });
    expect((await getBilling(db, firm))?.state).toBe('cancelling');
  });

  it('happens at once when a firm is marked as leaving', async () => {
    const system = systemFor(clock);
    const firm = await liveFirm(db, system, '07700 900642');
    const customer = (await getBilling(db, firm))?.customer ?? '';
    expect(await fromStripe(system, subscriptionEvent('evt_P642', customer, 'active', 1_793_000_000))).toBe(200);
    expect((await system.open(`/control/firms/${firm}/leaving`, controlForm({ name: 'Tidewell Heating' }))).status).toBe(303);
    expect(system.deps.billing.cancelled.at(-1)).toMatchObject({ atPeriodEnd: false });
    expect((await getBilling(db, firm))?.state).toBe('cancelled');
  });
});

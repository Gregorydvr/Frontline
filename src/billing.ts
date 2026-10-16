// What a firm pays Front-line (task 2 of queue 3 in docs/autopilot.md),
// worked out in code, in whole pence (rules 5 and 6). Greg's approved prices,
// 16 Oct 2026: £80 a month for Calls & bookings, £50 for each other service,
// and £150 for all five. No set-up fee. Front-line is not registered for VAT,
// so no VAT is added. The first 20 firms billed keep these prices: theirs
// are locked. Going live starts a 14-day free trial; the firm pays monthly
// after it, through Stripe, in test mode only for now.
//
// Nothing here touches the database or Stripe.

import { instant, type Instant } from './clock';
import { pence, type Pence } from './money';
import { SERVICES, type BillingState, type Service } from './record/types';

/** Each service's price a month. */
export const SERVICE_PRICES: Readonly<Record<Service, Pence>> = {
  calls: pence(8_000),
  quotes: pence(5_000),
  followups: pence(5_000),
  paperwork: pence(5_000),
  invoices: pence(5_000),
};

/** All five services together, a month. */
export const ALL_FIVE_PRICE: Pence = pence(15_000);

/** The name of this price list, kept on each firm billed from it. */
export const PRICE_LIST = 'founding-2026-10';

/** How many firms get the founding price, locked. */
export const FOUNDING_FIRMS = 20;

/** The free trial that going live starts. */
export const TRIAL_DAYS = 14;

/**
 * What the services cost a month: all five at the all-five price, otherwise
 * each service's price added up. Greg's prices as he gave them; note that
 * three or four services can cost more than all five (open question 20).
 */
export function monthlyPrice(services: readonly Service[]): Pence {
  const chosen = SERVICES.filter((service) => services.includes(service));
  if (chosen.length === SERVICES.length) return ALL_FIVE_PRICE;
  return pence(chosen.reduce((sum, service) => sum + SERVICE_PRICES[service], 0));
}

const DAY = 24 * 60 * 60_000;

/**
 * When the free trial ends: 14 days after the firm went live. If billing
 * starts late, such as on a copy where it was switched off, the trial still
 * runs at least two more days, since Stripe needs a trial that ends ahead
 * of now (open question 20).
 */
export function trialEndsAt(wentLive: Instant, now: Instant): Instant {
  return instant(Math.max(wentLive + TRIAL_DAYS * DAY, now + 2 * DAY));
}

/** Front-line's state for a subscription, from Stripe's status for it. */
export function stateFromStripe(status: string, cancelAtPeriodEnd: boolean): BillingState {
  switch (status) {
    case 'trialing':
      return cancelAtPeriodEnd ? 'cancelling' : 'trialing';
    case 'active':
      return cancelAtPeriodEnd ? 'cancelling' : 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    case 'paused':
      return 'paused';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled';
    default:
      return 'unclear';
  }
}

/**
 * Whether cancelling ends billing at once or at the end of the month paid
 * for: a firm paying, with its month paid, keeps it to the end; one in its
 * free trial, paused with no card, or behind with a payment stops at once.
 * The build's reading of "cancel any time" (open question 20).
 */
export function cancelsAtPeriodEnd(state: BillingState): boolean {
  return state === 'active';
}

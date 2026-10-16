// Billing a firm (task 2 of queue 3 in docs/autopilot.md): its row, written
// before Stripe is asked so a firm is never subscribed twice; what Stripe
// made; and each event Stripe sends, kept once by its id and applied only if
// it is newer than the last. Ids, states, times and whole pence only: card
// details never reach Front-line (rule 7).

import { instant, type Instant } from '../clock';
import { FOUNDING_FIRMS, PRICE_LIST } from '../billing';
import { isId } from '../ids';
import type { Pence } from '../money';
import { Refused, run, runTogether, type RecordDb } from './db';
import { staffLogStatement } from './staff';
import { BILLING_STATES, SERVICES, type Billing, type BillingState, type FirmId, type Service, type StaffId } from './types';

const COLUMNS = `state, services, monthly_pence, price_list, founding_number, trial_ends_at, stripe_customer, stripe_subscription,
  card_on_file, period_ends_at, started_at`;

interface BillingRow {
  state: string;
  services: string;
  monthly_pence: number;
  price_list: string;
  founding_number: number | null;
  trial_ends_at: number;
  stripe_customer: string | null;
  stripe_subscription: string | null;
  card_on_file: number;
  period_ends_at: number | null;
  started_at: number;
}

function fromRow(firm: FirmId, row: BillingRow): Billing {
  const services: unknown = JSON.parse(row.services);
  return {
    firm,
    state: BILLING_STATES.find((state) => state === row.state) ?? 'unclear',
    services: Array.isArray(services) ? SERVICES.filter((service) => services.includes(service)) : [],
    monthly: row.monthly_pence as Pence,
    priceList: row.price_list,
    foundingNumber: row.founding_number,
    trialEndsAt: instant(row.trial_ends_at),
    customer: row.stripe_customer,
    subscription: row.stripe_subscription,
    cardOnFile: row.card_on_file === 1,
    periodEndsAt: row.period_ends_at === null ? null : instant(row.period_ends_at),
    startedAt: instant(row.started_at),
  };
}

/** The firm's billing, or null if it has none yet. */
export async function getBilling(db: RecordDb, firm: FirmId): Promise<Billing | null> {
  const row = await db.d1.prepare(`SELECT ${COLUMNS} FROM billing WHERE firm_id = ?`).bind(firm).first<BillingRow>();
  return row === null ? null : fromRow(firm, row);
}

/**
 * Writes that the firm's billing is starting, before Stripe is asked, by a
 * member of staff or by Front-line itself as the firm goes live. The first
 * time, it is priced now and, while fewer than 20 firms have one, given the
 * next founding place: its price is locked from then on. Asked again after it
 * did not start, or clearly failed, it starts again at the price it already
 * has. Gives this try's name, for Stripe's idempotency keys, or null when
 * billing is already starting, running, unclear or over. An example firm is
 * never billed.
 */
export async function claimBilling(
  db: RecordDb,
  firm: FirmId,
  input: { services: readonly Service[]; monthly: Pence; trialEndsAt: Instant },
  staff: StaffId | null,
): Promise<string | null> {
  if (input.services.length === 0 || !input.services.every((service) => SERVICES.includes(service)) || !Number.isSafeInteger(input.monthly) || input.monthly < 0) {
    throw new Refused();
  }
  const now = db.clock.now();
  const services = JSON.stringify(SERVICES.filter((service) => input.services.includes(service)));
  const results = await runTogether(db.d1, [
    db.d1
      .prepare(
        `INSERT INTO billing (firm_id, state, services, monthly_pence, price_list, founding_number, trial_ends_at, card_on_file, started_at, updated_at)
         SELECT ?1, 'starting', ?2, ?3, ?4,
           CASE WHEN (SELECT COUNT(*) FROM billing WHERE founding_number IS NOT NULL) < ?5
             THEN (SELECT COUNT(*) FROM billing WHERE founding_number IS NOT NULL) + 1 END,
           ?6, 0, ?7, ?7
         WHERE EXISTS (SELECT 1 FROM firms WHERE id = ?1 AND is_example = 0)
         ON CONFLICT (firm_id) DO UPDATE SET state = 'starting', started_at = excluded.started_at, updated_at = excluded.updated_at
           WHERE billing.state IN ('not_started', 'failed')`,
      )
      .bind(firm, services, input.monthly, PRICE_LIST, FOUNDING_FIRMS, input.trialEndsAt, now),
    ...(staff === null || !isId(staff)
      ? []
      : [staffLogStatement(db, firm, staff, 'started_billing', {}, { where: "EXISTS (SELECT 1 FROM billing WHERE firm_id = ? AND state = 'starting' AND started_at = ?)", binds: [firm, now] })[1]]),
  ]);
  return results[0]?.meta.changes === 1 ? `${firm}-${String(now)}` : null;
}

/** Writes how starting the billing ended: what Stripe made, or that it did not start, failed, or is not clear. Only from starting. */
export async function finishBilling(
  db: RecordDb,
  firm: FirmId,
  ended: { state: 'trialing' | 'active'; customer: string; subscription: string } | { state: 'not_started' | 'failed' | 'unclear' },
): Promise<void> {
  const made = 'customer' in ended;
  if (made && (!/^cus_[0-9A-Za-z]+$/.test(ended.customer) || !/^sub_[0-9A-Za-z]+$/.test(ended.subscription))) throw new Refused();
  // Stripe's ids are each one firm's: the database refuses one another firm has.
  const { meta } = await run(
    db.d1
      .prepare(
        `UPDATE billing SET state = ?1, stripe_customer = COALESCE(?2, stripe_customer), stripe_subscription = COALESCE(?3, stripe_subscription), updated_at = ?4
         WHERE firm_id = ?5 AND state = 'starting'`,
      )
      .bind(ended.state, made ? ended.customer : null, made ? ended.subscription : null, db.clock.now(), firm),
  );
  if (meta.changes !== 1) throw new Refused();
}

/** Records that a member of staff asked for a link for the owner to add a card. The link itself is not kept. */
export async function logCardLink(db: RecordDb, firm: FirmId, staff: StaffId): Promise<void> {
  const [, statement] = staffLogStatement(db, firm, staff, 'made_card_link');
  const { meta } = await run(statement);
  if (meta.changes !== 1) throw new Refused();
}

/** Writes that the firm's billing is cancelled, or will be at the end of the month paid for, by a member of staff or by Front-line as the firm leaves. */
export async function markBillingCancelled(db: RecordDb, firm: FirmId, state: 'cancelled' | 'cancelling', staff: StaffId | null): Promise<void> {
  const now = db.clock.now();
  const results = await runTogether(db.d1, [
    db.d1
      .prepare("UPDATE billing SET state = ?1, updated_at = ?2 WHERE firm_id = ?3 AND state NOT IN ('cancelled', 'starting')")
      .bind(state, now, firm),
    ...(staff === null ? [] : [staffLogStatement(db, firm, staff, 'cancelled_billing')[1]]),
  ]);
  if (results[0]?.meta.changes !== 1) throw new Refused();
}

/** What Stripe said about the firm's subscription, from one of its events. */
export type StripeChange =
  | { kind: 'subscription'; state: BillingState; periodEndsAt: Instant | null }
  | { kind: 'payment_failed' }
  | { kind: 'card_added' }
  | { kind: 'paid' }
  | { kind: 'other' };

/**
 * Applies one event from Stripe to the firm's billing and keeps it, by
 * Stripe's id, in the same step. A change is applied only if the event is no
 * older than the last one applied, so events arriving out of order leave the
 * newest standing. Gives whether the event was new: the same event again
 * changes nothing more.
 */
export async function applyStripeEvent(db: RecordDb, firm: FirmId, event: { id: string; type: string; created: Instant }, change: StripeChange): Promise<boolean> {
  if (!/^evt_[0-9A-Za-z]{1,80}$/.test(event.id) || !/^[a-z_.]{1,80}$/.test(event.type)) throw new Refused();
  const now = db.clock.now();
  const newer = 'firm_id = ?1 AND (stripe_as_of IS NULL OR stripe_as_of <= ?2)';
  const update =
    change.kind === 'subscription'
      ? db.d1
          .prepare(`UPDATE billing SET state = ?3, period_ends_at = COALESCE(?4, period_ends_at), stripe_as_of = ?2, updated_at = ?5 WHERE ${newer}`)
          .bind(firm, event.created, change.state, change.periodEndsAt, now)
      : change.kind === 'payment_failed'
        ? db.d1.prepare(`UPDATE billing SET state = 'past_due', stripe_as_of = ?2, updated_at = ?3 WHERE ${newer} AND state <> 'cancelled'`).bind(firm, event.created, now)
        : change.kind === 'card_added'
          ? db.d1.prepare('UPDATE billing SET card_on_file = 1, updated_at = ?2 WHERE firm_id = ?1').bind(firm, now)
          : null;
  const results = await runTogether(db.d1, [
    db.d1
      .prepare('INSERT INTO billing_events (id, firm_id, type, at) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM billing WHERE firm_id = ?2) ON CONFLICT (id) DO NOTHING')
      .bind(event.id, firm, event.type, now),
    ...(update === null ? [] : [update]),
  ]);
  return results[0]?.meta.changes === 1;
}

/**
 * The firm a Stripe customer belongs to, for an event Stripe sends. A record
 * function that cannot take a firm: finding the firm is its job. It gives
 * only the firm's id.
 */
export async function findFirmByStripeCustomer(db: RecordDb, customer: string): Promise<FirmId | null> {
  if (!/^cus_[0-9A-Za-z]{1,80}$/.test(customer)) return null;
  const row = await db.d1.prepare('SELECT firm_id FROM billing WHERE stripe_customer = ?').bind(customer).first<{ firm_id: string }>();
  return row === null ? null : (row.firm_id as FirmId);
}

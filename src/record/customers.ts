// Customers: the firm's customers. A customer never logs in.

import { instant } from '../clock';
import { newId } from '../ids';
import { isUkLandline, isUkMobile, type UkLandline, type UkMobile } from '../phone';
import { line, Refused, run, runTogether, words, type RecordDb } from './db';
import { historyStatement } from './history';
import {
  CUSTOMER_LIMITS,
  NO_TEXT_REASONS,
  type Customer,
  type CustomerId,
  type FirmId,
  type JobId,
  type NoTextReason,
} from './types';

export interface NewCustomer {
  name: string;
  mobile: UkMobile | null;
  /** A landline they rang from. */
  landline?: UkLandline | null;
  /** Why no text can reach them. Needed when there is no mobile, and only then. */
  noText?: NoTextReason | null;
  /** The address taken on the call. */
  address?: string | null;
}

export async function createCustomer(db: RecordDb, firm: FirmId, input: NewCustomer): Promise<CustomerId> {
  const id = newId() as CustomerId;
  await run(insertCustomer(db, firm, id, input));
  return id;
}

/**
 * The statement that adds a customer, checked first. recordCall() runs it in
 * the same step as the call.
 */
export function insertCustomer(db: RecordDb, firm: FirmId, id: CustomerId, input: NewCustomer): D1PreparedStatement {
  const landline = input.landline ?? null;
  const noText = input.noText ?? null;
  const address = input.address == null ? null : line(input.address, CUSTOMER_LIMITS.address);
  if (input.mobile !== null && !isUkMobile(input.mobile)) {
    throw new Refused();
  }
  if (landline !== null && !isUkLandline(landline)) {
    throw new Refused();
  }
  if ((input.mobile === null) !== (noText !== null) || (noText !== null && !NO_TEXT_REASONS.includes(noText))) {
    throw new Refused();
  }
  return db.d1
    .prepare(
      `INSERT INTO customers (id, firm_id, name, mobile, landline, no_text, address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, firm, words(input.name), input.mobile, landline, noText, address, db.clock.now());
}

export async function getCustomer(db: RecordDb, firm: FirmId, customer: CustomerId): Promise<Customer | null> {
  const row = await db.d1
    .prepare(`${SELECT_CUSTOMER} WHERE firm_id = ? AND id = ?`)
    .bind(firm, customer)
    .first<CustomerRow>();
  return row === null ? null : fromRow(row);
}

export async function listCustomers(db: RecordDb, firm: FirmId): Promise<Customer[]> {
  const { results } = await db.d1
    .prepare(`${SELECT_CUSTOMER} WHERE firm_id = ? ORDER BY created_at, id`)
    .bind(firm)
    .all<CustomerRow>();
  return results.map(fromRow);
}

/** This firm's customers with this mobile. Another firm's customer on the same number is never found. */
export async function findCustomersByMobile(db: RecordDb, firm: FirmId, mobile: UkMobile): Promise<Customer[]> {
  if (!isUkMobile(mobile)) {
    throw new Refused();
  }
  const { results } = await db.d1
    .prepare(`${SELECT_CUSTOMER} WHERE firm_id = ? AND mobile = ? ORDER BY created_at, id`)
    .bind(firm, mobile)
    .all<CustomerRow>();
  return results.map(fromRow);
}

/** This firm's customers who rang from this landline. Another firm's are never found. */
export async function findCustomersByLandline(
  db: RecordDb,
  firm: FirmId,
  landline: UkLandline,
): Promise<Customer[]> {
  if (!isUkLandline(landline)) {
    throw new Refused();
  }
  const { results } = await db.d1
    .prepare(`${SELECT_CUSTOMER} WHERE firm_id = ? AND landline = ? ORDER BY created_at, id`)
    .bind(firm, landline)
    .all<CustomerRow>();
  return results.map(fromRow);
}

/** A customer's own details, as they confirm or correct them from their link. */
export interface CustomerDetails {
  name: string;
  address: string;
  /** Empty when they gave none. */
  email: string | null;
}

/**
 * The customer confirms or corrects their details from their link: their
 * name, their address, and an email if they give one. The address is also
 * where the job is, so the job the link is about moves with it. Recorded on
 * that job as done by the customer, as details confirmed when nothing
 * changed and details corrected otherwise; the old details are not kept.
 * Gives which.
 */
export async function confirmCustomerDetails(
  db: RecordDb,
  firm: FirmId,
  customer: CustomerId,
  job: JobId,
  details: CustomerDetails,
): Promise<'details_confirmed' | 'details_corrected'> {
  const name = line(details.name.trim(), CUSTOMER_LIMITS.name);
  const address = line(details.address.trim(), CUSTOMER_LIMITS.address);
  const email = details.email === null ? null : line(details.email.trim(), CUSTOMER_LIMITS.email);
  const before = await getCustomer(db, firm, customer);
  const place = await db.d1
    .prepare('SELECT place FROM jobs WHERE firm_id = ? AND id = ? AND customer_id = ?')
    .bind(firm, job, customer)
    .first<{ place: string }>();
  if (before === null || place === null) {
    throw new Refused();
  }
  const kind =
    before.name === name && (before.address ?? place.place) === address && place.place === address && before.email === email
      ? 'details_confirmed'
      : 'details_corrected';
  const now = db.clock.now();
  const results = await runTogether(db.d1, [
    db.d1
      .prepare(
        `UPDATE customers SET name = ?3, address = ?4, email = ?5, details_confirmed_at = ?6
         WHERE firm_id = ?1 AND id = ?2`,
      )
      .bind(firm, customer, name, address, email, now),
    db.d1.prepare('UPDATE jobs SET place = ?4 WHERE firm_id = ?1 AND id = ?2 AND customer_id = ?3').bind(firm, job, customer, address),
    historyStatement(db, firm, { kind, by: { kind: 'customer' }, job })[1],
  ]);
  if (results.some((result) => result.meta.changes !== 1)) {
    // Cannot happen once both were found above, short of the record changing underneath.
    throw new Refused();
  }
  return kind;
}

const SELECT_CUSTOMER =
  'SELECT id, name, mobile, landline, no_text, address, email, details_confirmed_at, created_at FROM customers';

interface CustomerRow {
  id: string;
  name: string;
  mobile: string | null;
  landline: string | null;
  no_text: string | null;
  address: string | null;
  email: string | null;
  details_confirmed_at: number | null;
  created_at: number;
}

function fromRow(row: CustomerRow): Customer {
  return {
    id: row.id as CustomerId,
    name: row.name,
    mobile: row.mobile as UkMobile | null,
    landline: row.landline as UkLandline | null,
    noText: row.no_text as NoTextReason | null,
    address: row.address,
    email: row.email,
    detailsConfirmedAt: row.details_confirmed_at === null ? null : instant(row.details_confirmed_at),
    createdAt: instant(row.created_at),
  };
}

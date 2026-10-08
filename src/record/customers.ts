// Customers: the firm's customers. A customer never logs in.

import { instant } from '../clock';
import { newId } from '../ids';
import { isUkLandline, isUkMobile, type UkLandline, type UkMobile } from '../phone';
import { Refused, run, words, type RecordDb } from './db';
import { NO_TEXT_REASONS, type Customer, type CustomerId, type FirmId, type NoTextReason } from './types';

export interface NewCustomer {
  name: string;
  mobile: UkMobile | null;
  /** A landline they rang from. */
  landline?: UkLandline | null;
  /** Why no text can reach them. Needed when there is no mobile, and only then. */
  noText?: NoTextReason | null;
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
      `INSERT INTO customers (id, firm_id, name, mobile, landline, no_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, firm, words(input.name), input.mobile, landline, noText, db.clock.now());
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

const SELECT_CUSTOMER = 'SELECT id, name, mobile, landline, no_text, created_at FROM customers';

interface CustomerRow {
  id: string;
  name: string;
  mobile: string | null;
  landline: string | null;
  no_text: string | null;
  created_at: number;
}

function fromRow(row: CustomerRow): Customer {
  return {
    id: row.id as CustomerId,
    name: row.name,
    mobile: row.mobile as UkMobile | null,
    landline: row.landline as UkLandline | null,
    noText: row.no_text as NoTextReason | null,
    createdAt: instant(row.created_at),
  };
}

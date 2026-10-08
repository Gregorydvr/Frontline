// Customers: the firm's customers. A customer never logs in.

import { instant } from '../clock';
import { newId } from '../ids';
import { isUkMobile, type UkMobile } from '../phone';
import { Refused, run, words, type RecordDb } from './db';
import type { Customer, CustomerId, FirmId } from './types';

export async function createCustomer(
  db: RecordDb,
  firm: FirmId,
  input: { name: string; mobile: UkMobile | null },
): Promise<CustomerId> {
  if (input.mobile !== null && !isUkMobile(input.mobile)) {
    throw new Refused();
  }
  const id = newId() as CustomerId;
  await run(
    db.d1
      .prepare('INSERT INTO customers (id, firm_id, name, mobile, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, firm, words(input.name), input.mobile, db.clock.now()),
  );
  return id;
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

const SELECT_CUSTOMER = 'SELECT id, name, mobile, created_at FROM customers';

interface CustomerRow {
  id: string;
  name: string;
  mobile: string | null;
  created_at: number;
}

function fromRow(row: CustomerRow): Customer {
  return {
    id: row.id as CustomerId,
    name: row.name,
    mobile: row.mobile as UkMobile | null,
    createdAt: instant(row.created_at),
  };
}

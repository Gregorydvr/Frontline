// Front-line's own staff, and the log of everything they view and do in the
// control room (rule 15 in CLAUDE.md). Staff belong to no firm. The log holds
// ids only, and the database refuses any edit or deletion of it.

import { instant } from '../clock';
import { isId, newId } from '../ids';
import { line, Refused, run, type RecordDb } from './db';
import {
  SERVICES,
  STAFF_ACTIONS,
  type CustomerId,
  type FirmId,
  type Service,
  type Staff,
  type StaffAction,
  type StaffId,
  type StaffLogId,
} from './types';

/** The longest an email may be. */
const EMAIL_LIMIT = 254;

// Each row is numbered in the order it was written.
const NEXT_SEQ = '(SELECT IFNULL(MAX(seq), 0) + 1 FROM staff_log)';

/**
 * The member of staff with this email, added the first time they come.
 * Cloudflare Access decides who is staff; this keeps who they are, so the
 * log can name them. A record function that cannot take a firm: staff
 * belong to none.
 */
export async function findOrAddStaff(db: RecordDb, email: string): Promise<Staff> {
  const checked = line(email.trim().toLowerCase(), EMAIL_LIMIT);
  if (!/^[^\s@]+@[^\s@]+$/.test(checked)) {
    throw new Refused();
  }
  await run(
    db.d1
      .prepare('INSERT INTO staff (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING')
      .bind(newId(), checked, db.clock.now()),
  );
  const row = await db.d1
    .prepare('SELECT id, email, created_at FROM staff WHERE email = ?')
    .bind(checked)
    .first<{ id: string; email: string; created_at: number }>();
  if (row === null) {
    throw new Refused();
  }
  return { id: row.id as StaffId, email: row.email, createdAt: instant(row.created_at) };
}

/** What a row of the staff log is about, beside the firm. */
export interface StaffLogAbout {
  customer?: CustomerId | null;
  service?: Service | null;
}

/**
 * Records that a member of staff viewed or did something about one firm.
 * Viewing the list of firms is recorded by listFirms() itself.
 */
export async function logStaff(
  db: RecordDb,
  firm: FirmId,
  staff: StaffId,
  what: Exclude<StaffAction, 'viewed_firms'>,
  about: StaffLogAbout = {},
): Promise<StaffLogId> {
  const [id, statement] = staffLogStatement(db, firm, staff, what, about);
  // The firm must exist: a row about a firm that never was is refused.
  const written = await run(statement);
  if (written.meta.changes !== 1) {
    throw new Refused();
  }
  return id;
}

/**
 * The statement that adds a row to the staff log, for running in the same
 * step as what it records. For a firm, it writes nothing when there is no
 * such firm, so whoever runs it checks that it wrote one row. For the list
 * of firms, the firm is null.
 */
export function staffLogStatement(
  db: RecordDb,
  firm: FirmId | null,
  staff: StaffId,
  what: StaffAction,
  about: StaffLogAbout = {},
): [StaffLogId, D1PreparedStatement] {
  if (!STAFF_ACTIONS.includes(what) || !isId(staff) || (firm !== null && !isId(firm)) || (firm === null) !== (what === 'viewed_firms')) {
    throw new Refused();
  }
  const customer = about.customer ?? null;
  const service = about.service ?? null;
  if ((customer !== null && !isId(customer)) || (service !== null && !SERVICES.includes(service))) {
    throw new Refused();
  }
  const id = newId() as StaffLogId;
  return [
    id,
    db.d1
      .prepare(
        `INSERT INTO staff_log (id, firm_id, staff_id, at, seq, what, customer_id, service)
         SELECT ?1, ?2, ?3, ?4, ${NEXT_SEQ}, ?5, ?6, ?7
         WHERE ?2 IS NULL OR EXISTS (SELECT 1 FROM firms WHERE id = ?2)`,
      )
      .bind(id, firm, staff, db.clock.now(), what, customer, service),
  ];
}

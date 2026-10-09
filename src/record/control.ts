// What the control room reads and does (slice G of docs/build-brief.md):
// the list of firms, finding one customer inside a firm, what an owner wrote
// in Message us, the things staff should look at, and exporting and deleting
// one customer.
//
// Staff read across every firm, but always one firm at a time: every function
// here takes the firm and looks only at its rows (rule 8), apart from
// listFirms(), which gives the list to choose from.
//
// Exporting and deleting a customer are built from one list, in erase.ts, of
// what is held about them in each table, so the two can never drift apart.
// The delete is one step: all of it or none. History is deleted only inside
// it, behind the permission slip in the erasing table (rule 15; see
// migrations/0008_control_room.sql), and the staff log keeps that it happened.

import { instant, type Instant } from '../clock';
import { isId } from '../ids';
import { callerNumber, type UkLandline, type UkMobile } from '../phone';
import { Refused, runTogether, type RecordDb } from './db';
import { BEFORE_THE_DELETES, CUSTOMER, eraseStatements, selectStatements, THEIR_NUMBERS } from './erase';
import { noteDeletion } from './files';
import { forExport, sameName } from './firm-file';
import { emptyBin } from './keeping';
import { getCustomer } from './customers';
import { CLAIM_HOLDS_FOR } from './due';
import { staffLogStatement } from './staff';
import {
  type CallId,
  type Customer,
  type CustomerId,
  type DueAction,
  type DueId,
  type Firm,
  type FirmId,
  type JobId,
  type MessageId,
  type MessageKind,
  type MessageReason,
  type OwnerId,
  type OwnerMessageId,
  type StaffId,
} from './types';
import { firmFromRow, FIRM_COLUMNS, type FirmRow } from './firms';

/**
 * Every firm, for the control room's list, oldest first. The view is written
 * to the staff log in the same step, so the list is never seen unrecorded. A
 * record function that cannot take a firm: it is how staff choose one.
 */
export async function listFirms(db: RecordDb, staff: StaffId): Promise<Firm[]> {
  const [, statement] = staffLogStatement(db, null, staff, 'viewed_firms');
  const [, listed] = await runTogether(db.d1, [statement, db.d1.prepare(`SELECT ${FIRM_COLUMNS} FROM firms ORDER BY created_at, id`)]);
  return ((listed?.results ?? []) as FirmRow[]).map(firmFromRow);
}

/** The most customers a search gives. */
export const FIND_LIMIT = 50;

/**
 * The firm's customers found by what staff typed: a mobile or a landline,
 * however it was written, or part of a name. Another firm's customers are
 * never found.
 */
export async function findCustomers(db: RecordDb, firm: FirmId, typed: string): Promise<Customer[]> {
  const asked = typed.trim().slice(0, 60);
  if (asked === '') {
    return [];
  }
  const number = callerNumber(asked);
  const { results } = await db.d1
    .prepare(
      `SELECT id FROM customers
       WHERE firm_id = ?1
         AND (CASE WHEN ?2 IS NOT NULL THEN (mobile = ?2 OR landline = ?2)
                   ELSE instr(lower(name), lower(?3)) > 0 END)
       ORDER BY created_at DESC, id
       LIMIT ?4`,
    )
    .bind(firm, number.kind === 'withheld' ? null : number.number, asked, FIND_LIMIT)
    .all<{ id: string }>();
  const found: Customer[] = [];
  for (const row of results) {
    const customer = await customerOf(db, firm, row.id as CustomerId);
    if (customer !== null) found.push(customer);
  }
  return found;
}

/** What an owner wrote in Message us, as staff see it. */
export interface OwnerMessageForStaff {
  id: OwnerMessageId;
  owner: { id: OwnerId; name: string };
  words: string;
  createdAt: Instant;
  /** Written after the last time any member of staff opened this firm's page. */
  unread: boolean;
}

/** The most recent of what the firm's owners wrote in Message us, newest first, each marked unread or not. */
export async function listOwnerMessages(db: RecordDb, firm: FirmId, limit = 50): Promise<OwnerMessageForStaff[]> {
  const { results } = await db.d1
    .prepare(
      `SELECT m.id, m.owner_id, o.name AS owner_name, m.words, m.created_at,
              m.created_at > IFNULL((SELECT MAX(l.at) FROM staff_log l WHERE l.firm_id = ?1 AND l.what = 'viewed_firm'), -1) AS unread
       FROM owner_messages m JOIN owners o ON o.firm_id = m.firm_id AND o.id = m.owner_id
       WHERE m.firm_id = ?1
       ORDER BY m.created_at DESC, m.rowid DESC
       LIMIT ?2`,
    )
    .bind(firm, Math.max(1, Math.min(limit, 200)))
    .all<{ id: string; owner_id: string; owner_name: string; words: string; created_at: number; unread: number }>();
  return results.map((row) => ({
    id: row.id as OwnerMessageId,
    owner: { id: row.owner_id as OwnerId, name: row.owner_name },
    words: row.words,
    createdAt: instant(row.created_at),
    unread: row.unread === 1,
  }));
}

/** A text that failed, as staff see it. */
export interface FailedText {
  id: MessageId;
  kind: MessageKind;
  reason: MessageReason | null;
  /** Who it was to: a customer by name, or an owner. */
  to: { kind: 'customer'; id: CustomerId; name: string } | { kind: 'owner'; id: OwnerId; name: string };
  job: JobId | null;
  createdAt: Instant;
}

/** The firm's texts that failed from one instant on, newest first, including those it is not clear went. */
export async function listFailedTexts(db: RecordDb, firm: FirmId, from: Instant): Promise<FailedText[]> {
  const { results } = await db.d1
    .prepare(
      `SELECT m.id, m.kind, m.reason, m.customer_id, c.name AS customer_name, m.owner_id, o.name AS owner_name,
              m.job_id, m.created_at
       FROM messages m
       LEFT JOIN customers c ON c.firm_id = m.firm_id AND c.id = m.customer_id
       LEFT JOIN owners o ON o.firm_id = m.firm_id AND o.id = m.owner_id
       WHERE m.firm_id = ? AND m.state = 'failed' AND m.created_at >= ?
       ORDER BY m.created_at DESC, m.rowid DESC`,
    )
    .bind(firm, instant(from))
    .all<{
      id: string;
      kind: MessageKind;
      reason: MessageReason | null;
      customer_id: string | null;
      customer_name: string | null;
      owner_id: string | null;
      owner_name: string | null;
      job_id: string | null;
      created_at: number;
    }>();
  return results.map((row) => ({
    id: row.id as MessageId,
    kind: row.kind,
    reason: row.reason,
    to:
      row.customer_id !== null
        ? { kind: 'customer', id: row.customer_id as CustomerId, name: row.customer_name ?? '' }
        : { kind: 'owner', id: row.owner_id as OwnerId, name: row.owner_name ?? '' },
    job: row.job_id as JobId | null,
    createdAt: instant(row.created_at),
  }));
}

/**
 * Something staff should look at, which until slice G only a log line told
 * them:
 * - stuck: a row in the due list a worker claimed and never finished
 * - nobody_to_alert: an urgent call whose alert had no owner to go to
 * - hold_let_go: a time held during a call that could not be booked, so the
 *   caller may have been told a time
 * - urgent_not_on_list: the voice agent thought the call urgent, for
 *   something not on the firm's urgent list
 * - call_while_off: a call that came while the firm's calls were switched off
 * - recording_not_kept: a call whose recording is not in Front-line's file
 *   store, because Vapi's report named somewhere else, or it never arrived
 *   in the inbox in time (slice H)
 */
export interface LookItem {
  kind: 'stuck' | 'nobody_to_alert' | 'hold_let_go' | 'urgent_not_on_list' | 'call_while_off' | 'recording_not_kept';
  at: Instant;
  due: { id: DueId; action: DueAction } | null;
  call: CallId | null;
  customer: { id: CustomerId; name: string } | null;
  /** For a call from someone who is not a customer: who rang. */
  caller: string | null;
}

/** What needs a look at the firm, from one instant on, oldest first. A stuck row is shown however old it is. */
export async function needsALook(db: RecordDb, firm: FirmId, from: Instant): Promise<LookItem[]> {
  const now = db.clock.now();
  const since = instant(from);
  const items: LookItem[] = [];

  const { results: stuck } = await db.d1
    .prepare(
      `SELECT id, action, claimed_at, call_id FROM due
       WHERE firm_id = ? AND state = 'claimed' AND claimed_at <= ?`,
    )
    .bind(firm, now - CLAIM_HOLDS_FOR)
    .all<{ id: string; action: DueAction; claimed_at: number; call_id: string | null }>();
  for (const row of stuck) {
    items.push({ kind: 'stuck', at: instant(row.claimed_at), due: { id: row.id as DueId, action: row.action }, call: row.call_id as CallId | null, customer: null, caller: null });
  }

  const { results: nobody } = await db.d1
    .prepare(
      `SELECT d.id, d.action, d.finished_at, d.call_id, k.customer_id, c.name AS customer_name, k.caller
       FROM due d
       LEFT JOIN calls k ON k.firm_id = d.firm_id AND k.id = d.call_id
       LEFT JOIN customers c ON c.firm_id = k.firm_id AND c.id = k.customer_id
       WHERE d.firm_id = ? AND d.action = 'alert_owner' AND d.outcome = 'nobody_to_tell' AND d.finished_at >= ?`,
    )
    .bind(firm, since)
    .all<{ id: string; action: DueAction; finished_at: number; call_id: string | null; customer_id: string | null; customer_name: string | null; caller: string | null }>();
  for (const row of nobody) {
    items.push({
      kind: 'nobody_to_alert',
      at: instant(row.finished_at),
      due: { id: row.id as DueId, action: row.action },
      call: row.call_id as CallId | null,
      customer: customerOrNull(row.customer_id, row.customer_name),
      caller: row.caller,
    });
  }

  const { results: holds } = await db.d1
    .prepare(
      `SELECT h.updated_at, k.id AS call_id, k.customer_id, c.name AS customer_name, k.caller
       FROM holds h
       LEFT JOIN calls k ON k.firm_id = h.firm_id AND k.provider = h.provider AND k.provider_call_id = h.provider_call_id
       LEFT JOIN customers c ON c.firm_id = k.firm_id AND c.id = k.customer_id
       WHERE h.firm_id = ? AND h.state = 'released' AND h.updated_at >= ?`,
    )
    .bind(firm, since)
    .all<{ updated_at: number; call_id: string | null; customer_id: string | null; customer_name: string | null; caller: string | null }>();
  for (const row of holds) {
    items.push({ kind: 'hold_let_go', at: instant(row.updated_at), due: null, call: row.call_id as CallId | null, customer: customerOrNull(row.customer_id, row.customer_name), caller: row.caller });
  }

  // A call came while the calls service was off when the firm's last switch
  // of it before the call was off, or it had never been switched on.
  const { results: calls } = await db.d1
    .prepare(
      `SELECT k.id, k.started_at, k.urgent_not_on_list, k.recording_state, k.customer_id, c.name AS customer_name, k.caller,
              IFNULL((SELECT h.kind FROM history h
                      WHERE h.firm_id = k.firm_id AND h.service = 'calls' AND h.kind IN ('service_on', 'service_off')
                        AND h.at <= k.started_at
                      ORDER BY h.at DESC, h.seq DESC LIMIT 1), 'service_off') = 'service_off' AS while_off
       FROM calls k
       LEFT JOIN customers c ON c.firm_id = k.firm_id AND c.id = k.customer_id
       WHERE k.firm_id = ? AND k.started_at >= ?`,
    )
    .bind(firm, since)
    .all<{
      id: string;
      started_at: number;
      urgent_not_on_list: number;
      recording_state: string;
      customer_id: string | null;
      customer_name: string | null;
      caller: string | null;
      while_off: number;
    }>();
  for (const row of calls) {
    const about = { at: instant(row.started_at), due: null, call: row.id as CallId, customer: customerOrNull(row.customer_id, row.customer_name), caller: row.caller };
    if (row.urgent_not_on_list === 1) items.push({ kind: 'urgent_not_on_list', ...about });
    if (row.while_off === 1) items.push({ kind: 'call_while_off', ...about });
    if (row.recording_state === 'not_kept') items.push({ kind: 'recording_not_kept', ...about });
  }

  return items.sort((x, y) => x.at - y.at);
}

function customerOrNull(id: string | null, name: string | null): { id: CustomerId; name: string } | null {
  return id === null || name === null ? null : { id: id as CustomerId, name };
}

/** The tables a customer's export and delete cover, in the order the delete removes them. */
export const CUSTOMER_TABLES = CUSTOMER.belongings.map((belonging) => belonging.table);


/** One customer's file: everything held about them, table by table, as an export gives it. */
export interface CustomerFile {
  firm: FirmId;
  customer: CustomerId;
  /** When the file was made, in UTC. */
  made: string;
  /** Each table's rows about the customer, with times in UTC and no keys. */
  tables: Record<string, Record<string, unknown>[]>;
  /** What the firm's owners wrote in Message us that names them or their number: not part of their record, and not deleted with it. */
  ownerMessagesNamingThem: Record<string, unknown>[];
}

/**
 * Everything the firm holds about one of its customers, for an export, or
 * null when the firm has no such customer. Built from the same list as the
 * delete (src/record/erase.ts).
 */
export async function customerFile(db: RecordDb, firm: FirmId, customer: CustomerId): Promise<CustomerFile | null> {
  const found = await customerOf(db, firm, customer);
  if (found === null) {
    return null;
  }
  const results = await runTogether(db.d1, selectStatements(db, firm, CUSTOMER, customer));
  const tables: Record<string, Record<string, unknown>[]> = {};
  CUSTOMER.belongings.forEach(({ table }, at) => {
    tables[table] = ((results[at]?.results ?? []) as Record<string, unknown>[]).map(forExport);
  });
  const named = await db.d1
    .prepare(
      `SELECT * FROM owner_messages
       WHERE firm_id = ?1 AND (instr(lower(words), lower(?2)) > 0
         OR (?3 IS NOT NULL AND instr(replace(words, ' ', ''), ?3) > 0)
         OR (?4 IS NOT NULL AND instr(replace(words, ' ', ''), ?4) > 0))
       ORDER BY created_at`,
    )
    .bind(firm, found.name, nationalDigits(found.mobile), nationalDigits(found.landline))
    .all();
  return {
    firm,
    customer,
    made: new Date(db.clock.now()).toISOString(),
    tables,
    ownerMessagesNamingThem: named.results.map(forExport),
  };
}

/** How many rows of each table a delete removed, and what it kept. */
export interface Deleted {
  removed: Record<string, number>;
  /** Their mobile, kept on the firm's list of numbers that get no text, if a STOP put it there. */
  keptOnStopList: boolean;
}

/**
 * Deletes one of the firm's customers and everything held about them. The
 * member of staff must give the customer's name as it is held, as they typed
 * it on the confirm page; anything else is refused. Gives null when the firm
 * has no such customer, such as when it was deleted already.
 *
 * The database and the file stores cannot change in one step, so:
 * 1. the delete is noted in the restore ledger, so it can be done again
 *    after a restore (docs/restore.md)
 * 2. in one step: the staff log, every row about them, and their files put
 *    in the bin
 * 3. the bin is emptied: their recordings are deleted from the file stores
 * Stopping after 1 leaves a note of a delete staff asked for; after 2, the
 * bin still names their files, and the firm's daily sweep, or the next
 * delete, empties it. Deleting a file that is gone does nothing.
 */
export async function deleteCustomer(
  db: RecordDb,
  firm: FirmId,
  customer: CustomerId,
  staff: StaffId,
  typedName: string,
): Promise<Deleted | null> {
  const found = await customerOf(db, firm, customer);
  if (found === null) {
    return null;
  }
  if (sameName(typedName) !== sameName(found.name)) {
    throw new Refused();
  }
  return eraseCustomer(db, firm, found, staff, 'deleted_customer');
}

/**
 * Deletes a customer as deleteCustomer() does, without the name typed: when
 * their delete is done again after a restore, as staff asked for it before.
 * Gives null when there is no such customer.
 */
export async function redoCustomerDelete(db: RecordDb, firm: FirmId, customer: CustomerId, staff: StaffId): Promise<Deleted | null> {
  const found = await customerOf(db, firm, customer);
  return found === null ? null : eraseCustomer(db, firm, found, staff, 'replayed_deletions');
}

/** The delete itself, by a member of staff, recorded in the staff log as `what`. */
async function eraseCustomer(
  db: RecordDb,
  firm: FirmId,
  found: Customer,
  staff: StaffId,
  what: 'deleted_customer' | 'replayed_deletions',
): Promise<Deleted> {
  const customer = found.id;
  // A delete done again after a restore is in the ledger already.
  if (what === 'deleted_customer') {
    await noteDeletion(db, { kind: 'customer', firm, customer });
  }
  const [, logged] = staffLogStatement(db, firm, staff, what, { customer });
  const removing = CUSTOMER.belongings.filter((belonging) => belonging.kept === undefined);
  const results = await runTogether(db.d1, [
    // Logged first, while the customer is still there to name.
    logged,
    ...eraseStatements(db, firm, CUSTOMER, customer),
  ]);
  const removed: Record<string, number> = {};
  removing.forEach(({ table }, at) => {
    removed[table] = results[at + 1 + BEFORE_THE_DELETES]?.meta.changes ?? 0;
  });
  if (removed.customers !== 1) {
    // Deleted by someone else in the meantime: cannot happen inside one step.
    throw new Refused();
  }
  await emptyBin(db, firm);
  const kept = found.mobile === null
    ? null
    : await db.d1.prepare('SELECT 1 AS yes FROM opted_out_numbers WHERE firm_id = ? AND mobile = ?').bind(firm, found.mobile).first<{ yes: number }>();
  return { removed, keptOnStopList: kept !== null };
}

/** How many rows of each table a delete would remove, for the confirm page, or null when there is no such customer. */
export async function customerFileCounts(db: RecordDb, firm: FirmId, customer: CustomerId): Promise<{ counts: Record<string, number>; othersOnTheirNumbers: number } | null> {
  const file = await customerFile(db, firm, customer);
  if (file === null) {
    return null;
  }
  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(file.tables)) {
    counts[table] = rows.length;
  }
  const others = await db.d1
    .prepare(
      `SELECT COUNT(*) AS n FROM customers other
       WHERE other.firm_id = ?1 AND other.id <> ?2
         AND (other.mobile IN ${THEIR_NUMBERS} OR other.landline IN ${THEIR_NUMBERS})`,
    )
    .bind(firm, customer)
    .first<{ n: number }>();
  return { counts, othersOnTheirNumbers: others?.n ?? 0 };
}


/** A stored number's national digits, such as 07700900003, for finding it in what an owner wrote. */
function nationalDigits(number: UkMobile | UkLandline | null): string | null {
  return number === null ? null : `0${number.slice(3)}`;
}


async function customerOf(db: RecordDb, firm: FirmId, customer: CustomerId): Promise<Customer | null> {
  return isId(customer) ? getCustomer(db, firm, customer) : null;
}

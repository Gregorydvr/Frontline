// Firms: the name, whether it is an example, a switch for each service, the
// stop button, the number customers ring, and what counts as urgent. Changing
// any of these records who did it, in the same step.

import { instant } from '../clock';
import { newId } from '../ids';
import { isUkMobile, type UkMobile } from '../phone';
import { bit, line, Refused, run, runTogether, words, type RecordDb } from './db';
import { firmEntry } from './history';
import { SERVICES, type Actor, type Firm, type FirmId, type Service } from './types';

/** The most items an urgent list holds, and the longest an item may be. */
export const URGENT_LIST_LIMITS = { items: 20, length: 60 } as const;

const SERVICE_COLUMNS = {
  calls: 'calls_on',
  quotes: 'quotes_on',
  followups: 'followups_on',
  paperwork: 'paperwork_on',
  invoices: 'invoices_on',
} as const satisfies Record<Service, string>;

/**
 * Makes a new firm, with every service off and the stop button off. One of
 * the three record functions that cannot take a firm, since the firm does not
 * exist yet.
 */
export async function createFirm(db: RecordDb, input: { name: string; isExample: boolean }): Promise<FirmId> {
  const id = newId() as FirmId;
  await run(
    db.d1
      .prepare('INSERT INTO firms (id, name, is_example, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, words(input.name), bit(input.isExample), db.clock.now()),
  );
  return id;
}

export async function getFirm(db: RecordDb, firm: FirmId): Promise<Firm | null> {
  const row = await db.d1
    .prepare(
      `SELECT id, name, is_example, calls_on, quotes_on, followups_on, paperwork_on, invoices_on,
              stopped, phone_number, urgent_list, created_at
       FROM firms WHERE id = ?`,
    )
    .bind(firm)
    .first<FirmRow>();
  return row === null ? null : fromRow(row);
}

/**
 * The firms marked as an example, such as the demo firm. A record function
 * that cannot take a firm: it finds them. It gives only their ids.
 */
export async function exampleFirms(db: RecordDb): Promise<FirmId[]> {
  const { results } = await db.d1
    .prepare('SELECT id FROM firms WHERE is_example = 1 ORDER BY created_at, id')
    .all<{ id: string }>();
  return results.map((row) => row.id as FirmId);
}

/**
 * The firm whose customers ring this number, when a call to it ends. The
 * third record function that cannot take a firm: finding the firm is its job.
 * It gives only the firm's id.
 */
export async function findFirmByNumber(db: RecordDb, number: UkMobile): Promise<FirmId | null> {
  if (!isUkMobile(number)) {
    throw new Refused();
  }
  const row = await db.d1.prepare('SELECT id FROM firms WHERE phone_number = ?').bind(number).first<{ id: string }>();
  return row === null ? null : (row.id as FirmId);
}

/** Gives the firm the number its customers ring and text, and records who did it. Another firm's number is refused. */
export async function setFirmNumber(db: RecordDb, firm: FirmId, number: UkMobile, by: Actor): Promise<void> {
  if (!isUkMobile(number)) {
    throw new Refused();
  }
  await changeFirm(db, [
    db.d1.prepare('UPDATE firms SET phone_number = ? WHERE id = ?').bind(number, firm),
    firmEntry(db, firm, 'number_set', by, null),
  ]);
}

/**
 * Sets what counts as urgent for the firm, such as "a leak", and records who
 * did it. Each item is one short line, and no item appears twice.
 */
export async function setUrgentList(db: RecordDb, firm: FirmId, items: readonly string[], by: Actor): Promise<void> {
  if (items.length > URGENT_LIST_LIMITS.items) {
    throw new Refused();
  }
  const checked = items.map((item) => line(item, URGENT_LIST_LIMITS.length));
  if (new Set(checked.map((item) => item.toLowerCase())).size !== checked.length) {
    throw new Refused();
  }
  await changeFirm(db, [
    db.d1.prepare('UPDATE firms SET urgent_list = ? WHERE id = ?').bind(JSON.stringify(checked), firm),
    firmEntry(db, firm, 'urgent_list_set', by, null),
  ]);
}

/** Switches one of the firm's services on or off, and records who did it. */
export async function setService(
  db: RecordDb,
  firm: FirmId,
  service: Service,
  on: boolean,
  by: Actor,
): Promise<void> {
  if (!SERVICES.includes(service)) {
    throw new Refused();
  }
  // The column comes from the fixed list above, never from the caller.
  const column = SERVICE_COLUMNS[service];
  await changeFirm(db, [
    db.d1.prepare(`UPDATE firms SET ${column} = ? WHERE id = ?`).bind(bit(on), firm),
    firmEntry(db, firm, on ? 'service_on' : 'service_off', by, service),
  ]);
}

/** Turns the firm's stop button on or off, and records who did it. */
export async function setStopButton(db: RecordDb, firm: FirmId, on: boolean, by: Actor): Promise<void> {
  await changeFirm(db, [
    db.d1.prepare('UPDATE firms SET stopped = ? WHERE id = ?').bind(bit(on), firm),
    firmEntry(db, firm, on ? 'stop_on' : 'stop_off', by, null),
  ]);
}

/** Runs a change to the firm and its history entry as one step. */
async function changeFirm(db: RecordDb, statements: D1PreparedStatement[]): Promise<void> {
  // A firm that does not exist changes nothing, and its history entry is
  // refused by the database, which undoes the whole step.
  const [changed] = await runTogether(db.d1, statements);
  if (changed?.meta.changes !== 1) {
    throw new Refused();
  }
}

interface FirmRow {
  id: string;
  name: string;
  is_example: number;
  calls_on: number;
  quotes_on: number;
  followups_on: number;
  paperwork_on: number;
  invoices_on: number;
  stopped: number;
  phone_number: string | null;
  urgent_list: string;
  created_at: number;
}

function fromRow(row: FirmRow): Firm {
  return {
    id: row.id as FirmId,
    name: row.name,
    isExample: row.is_example === 1,
    services: {
      calls: row.calls_on === 1,
      quotes: row.quotes_on === 1,
      followups: row.followups_on === 1,
      paperwork: row.paperwork_on === 1,
      invoices: row.invoices_on === 1,
    },
    stopped: row.stopped === 1,
    phoneNumber: row.phone_number as UkMobile | null,
    urgentList: urgentListFrom(row.urgent_list),
    createdAt: instant(row.created_at),
  };
}

/** Reads the stored list back, keeping only what setUrgentList() could have written. */
function urgentListFrom(stored: string): string[] {
  const list: unknown = JSON.parse(stored);
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
}

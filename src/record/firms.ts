// Firms: the name, whether it is an example, a switch for each service, the
// stop button, the number customers ring, and what counts as urgent. Changing
// any of these records who did it, in the same step.

import { instant } from '../clock';
import { newId } from '../ids';
import { isUkMobile, type UkMobile } from '../phone';
import { diaryRulesProblems, NAME_LIMITS, nameProblems, urgentListProblems } from '../set-up';
import { bit, Refused, runTogether, type RecordDb } from './db';
import { firmEntry } from './history';
import { staffLogStatement } from './staff';
import {
  SERVICES,
  VISIT_KINDS,
  type Actor,
  type DiaryRules,
  type Firm,
  type FirmId,
  type Service,
  type StaffAction,
  type StaffId,
  type VisitKind,
} from './types';

export { DIARY_LIMITS, URGENT_LIST_LIMITS } from '../set-up';

const SERVICE_COLUMNS = {
  calls: 'calls_on',
  quotes: 'quotes_on',
  followups: 'followups_on',
  paperwork: 'paperwork_on',
  invoices: 'invoices_on',
} as const satisfies Record<Service, string>;

const frontline = { kind: 'frontline' } as const;

/**
 * Makes a new firm, with every service off and the stop button off, and
 * records who did it: the history entry firm_added and, for a member of
 * staff, the staff log, in the same step. Its name fills {firm} in texts, so
 * a text must be able to carry it. One of the record functions that cannot
 * take a firm, since the firm does not exist yet.
 */
export async function createFirm(db: RecordDb, input: { name: string; isExample: boolean }, by: Actor = frontline): Promise<FirmId> {
  if (nameProblems(input.name, NAME_LIMITS.firm).length > 0 || (by.kind !== 'frontline' && by.kind !== 'staff')) {
    throw new Refused();
  }
  const id = newId() as FirmId;
  await changeFirm(db, [
    db.d1
      .prepare('INSERT INTO firms (id, name, is_example, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, input.name, bit(input.isExample), db.clock.now()),
    ...recorded(db, id, 'firm_added', by, 'added_firm'),
  ]);
  return id;
}

export async function getFirm(db: RecordDb, firm: FirmId): Promise<Firm | null> {
  const row = await db.d1
    .prepare(`SELECT ${FIRM_COLUMNS} FROM firms WHERE id = ?`)
    .bind(firm)
    .first<FirmRow>();
  return row === null ? null : firmFromRow(row);
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
 * It gives only the firm's id. A firm that is leaving is not found, so its
 * calls and texts are no longer kept.
 */
export async function findFirmByNumber(db: RecordDb, number: UkMobile): Promise<FirmId | null> {
  if (!isUkMobile(number)) {
    throw new Refused();
  }
  const row = await db.d1.prepare('SELECT id FROM firms WHERE phone_number = ? AND left_at IS NULL').bind(number).first<{ id: string }>();
  return row === null ? null : (row.id as FirmId);
}

/**
 * What setting a firm's number did: set; not, because another firm has it
 * (one that is leaving keeps it until it is deleted); not, because it is
 * the mobile of one of the firm's owners; or not, because Calls & bookings
 * is on and the firm already has a number, which customers reply to.
 */
export type NumberSet = 'set' | 'taken' | 'owners_mobile' | 'calls_on';

/**
 * Gives the firm the number its customers ring and text, and records who did
 * it. No two firms have the same number: the database holds to that too
 * (migration 0002). A number already set can be changed only while Calls &
 * bookings is off: the build's reading of question 5 of the slice H2 plan,
 * waiting for Greg.
 */
export async function setFirmNumber(db: RecordDb, firm: FirmId, number: UkMobile, by: Actor): Promise<NumberSet> {
  if (!isUkMobile(number)) {
    throw new Refused();
  }
  const why = await db.d1
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM firms WHERE phone_number = ?2 AND id <> ?1) AS taken,
         EXISTS (SELECT 1 FROM owners WHERE firm_id = ?1 AND mobile = ?2) AS owners_mobile,
         EXISTS (SELECT 1 FROM firms WHERE id = ?1 AND calls_on = 1 AND phone_number IS NOT NULL AND phone_number <> ?2) AS calls_on`,
    )
    .bind(firm, number)
    .first<{ taken: number; owners_mobile: number; calls_on: number }>();
  if (why === null) throw new Refused();
  if (why.taken === 1) return 'taken';
  if (why.owners_mobile === 1) return 'owners_mobile';
  if (why.calls_on === 1) return 'calls_on';
  // Should another firm take the number in between, the database refuses
  // this step whole (migration 0002's index), history entry and all.
  await changeFirm(db, [
    db.d1.prepare('UPDATE firms SET phone_number = ? WHERE id = ?').bind(number, firm),
    ...recorded(db, firm, 'number_set', by, 'set_number'),
  ]);
  return 'set';
}

/**
 * Sets what counts as urgent for the firm, such as "a leak", and records who
 * did it. Each item is one short line, and no item appears twice.
 */
export async function setUrgentList(db: RecordDb, firm: FirmId, items: readonly string[], by: Actor): Promise<void> {
  if (urgentListProblems(items).length > 0) {
    throw new Refused();
  }
  await changeFirm(db, [
    db.d1.prepare('UPDATE firms SET urgent_list = ? WHERE id = ?').bind(JSON.stringify(items), firm),
    ...recorded(db, firm, 'urgent_list_set', by, 'set_urgent_list'),
  ]);
}

/**
 * Sets when the firm's visits can be booked and how long each kind takes,
 * and records who did it. The rules must make sense: hours within a day,
 * the last start before the close, lengths that fit. Null takes them away,
 * and the firm is offered no times.
 */
export async function setDiaryRules(db: RecordDb, firm: FirmId, rules: DiaryRules | null, by: Actor): Promise<void> {
  if (rules !== null && !areDiaryRules(rules)) {
    throw new Refused();
  }
  const stored = rules === null ? null : JSON.stringify(diaryRulesOf(rules));
  await changeFirm(db, [
    db.d1.prepare('UPDATE firms SET diary_rules = ? WHERE id = ?').bind(stored, firm),
    ...recorded(db, firm, 'diary_rules_set', by, 'set_diary_rules'),
  ]);
}

/** Whether something is diary rules that make sense, since types can be got round. */
function areDiaryRules(rules: unknown): rules is DiaryRules {
  return diaryRulesProblems(rules).length === 0;
}

/** Just the fields of the rules, in a set order. */
function diaryRulesOf(rules: DiaryRules): DiaryRules {
  const lengths: Partial<Record<VisitKind, number>> = {};
  for (const kind of VISIT_KINDS) {
    const length = rules.lengths[kind];
    if (length !== undefined) lengths[kind] = length;
  }
  return {
    days: [...rules.days].sort((x, y) => x - y),
    opens: rules.opens,
    closes: rules.closes,
    every: rules.every,
    lengths,
    daysAhead: rules.daysAhead,
  };
}

/**
 * The statements that record a change to the firm: its history entry, and,
 * when a member of staff made it, the row in the staff log, for the same step.
 */
function recorded(
  db: RecordDb,
  firm: FirmId,
  kind: 'firm_added' | 'number_set' | 'urgent_list_set' | 'diary_rules_set',
  by: Actor,
  action: StaffAction,
): D1PreparedStatement[] {
  return [firmEntry(db, firm, kind, by, null), ...(by.kind === 'staff' ? [staffLogStatement(db, firm, by.staff, action)[1]] : [])];
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

/** Runs a change to the firm and how it is recorded as one step. */
async function changeFirm(db: RecordDb, statements: D1PreparedStatement[]): Promise<void> {
  // A firm that does not exist changes nothing, and its history entry is
  // refused by the database, which undoes the whole step. A row of the staff
  // log about a firm that is not there writes nothing.
  const results = await runTogether(db.d1, statements);
  if (results.some((result) => result.meta.changes !== 1)) {
    throw new Refused();
  }
}

/** The columns a firm is read from, for firmFromRow(). */
export const FIRM_COLUMNS = `id, name, is_example, calls_on, quotes_on, followups_on, paperwork_on, invoices_on,
  stopped, phone_number, urgent_list, diary_rules, clock_ahead, left_at, left_by, created_at`;

export interface FirmRow {
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
  diary_rules: string | null;
  clock_ahead: number;
  left_at: number | null;
  left_by: string | null;
  created_at: number;
}

export function firmFromRow(row: FirmRow): Firm {
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
    diaryRules: diaryRulesFrom(row.diary_rules),
    clockAhead: row.clock_ahead,
    leaving: row.left_at === null || row.left_by === null ? null : { at: instant(row.left_at), by: row.left_by as StaffId },
    createdAt: instant(row.created_at),
  };
}

/** Reads the stored list back, keeping only what setUrgentList() could have written. */
function urgentListFrom(stored: string): string[] {
  const list: unknown = JSON.parse(stored);
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
}

/** Reads the stored rules back, keeping them only if setDiaryRules() could have written them. */
function diaryRulesFrom(stored: string | null): DiaryRules | null {
  if (stored === null) return null;
  const rules: unknown = JSON.parse(stored);
  return areDiaryRules(rules) ? diaryRulesOf(rules) : null;
}

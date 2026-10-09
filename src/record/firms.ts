// Firms: the name, whether it is an example, a switch for each service, the
// stop button, the number customers ring, and what counts as urgent. Changing
// any of these records who did it, in the same step.

import { instant } from '../clock';
import { newId } from '../ids';
import { isUkMobile, type UkMobile } from '../phone';
import { bit, line, Refused, run, runTogether, words, type RecordDb } from './db';
import { firmEntry } from './history';
import {
  SERVICES,
  VISIT_KINDS,
  type Actor,
  type DiaryRules,
  type Firm,
  type FirmId,
  type Service,
  type StaffId,
  type VisitKind,
} from './types';

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

/** The longest a visit may be, and the most days ahead times may be offered. */
export const DIARY_LIMITS = { length: 12 * 60, daysAhead: 90 } as const;

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
    firmEntry(db, firm, 'diary_rules_set', by, null),
  ]);
}

/** Whether something is diary rules that make sense, since types can be got round. */
function areDiaryRules(rules: unknown): rules is DiaryRules {
  if (typeof rules !== 'object' || rules === null) return false;
  const { days, opens, closes, every, lengths, daysAhead } = rules as Record<string, unknown>;
  const minuteOfDay = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 24 * 60;
  if (!Array.isArray(days) || days.length === 0 || !days.every((day) => Number.isSafeInteger(day) && day >= 0 && day <= 6)) return false;
  if (new Set(days).size !== days.length) return false;
  if (!minuteOfDay(opens) || !minuteOfDay(closes) || opens >= closes) return false;
  if (!Number.isSafeInteger(every) || (every as number) < 5 || (every as number) > closes - opens) return false;
  if (!Number.isSafeInteger(daysAhead) || (daysAhead as number) < 1 || (daysAhead as number) > DIARY_LIMITS.daysAhead) return false;
  if (typeof lengths !== 'object' || lengths === null || Array.isArray(lengths)) return false;
  return Object.entries(lengths).every(
    ([kind, length]) =>
      VISIT_KINDS.includes(kind as VisitKind) &&
      Number.isSafeInteger(length) &&
      (length as number) >= 5 &&
      (length as number) <= Math.min(DIARY_LIMITS.length, closes - opens),
  );
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

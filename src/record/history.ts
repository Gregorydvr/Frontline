// The history of who did what. An entry holds ids, a kind and a time, never
// words. It is never edited: the database refuses (rule 15 in CLAUDE.md).

import { instant, type Instant } from '../clock';
import { isId, newId } from '../ids';
import { Refused, run, type RecordDb } from './db';
import {
  HISTORY_KINDS,
  type Actor,
  type CallId,
  type CustomerId,
  type FirmId,
  type HistoryEntry,
  type HistoryId,
  type HistoryKind,
  type JobId,
  type NewHistory,
  type OptOutKind,
  type OwnerId,
  type Service,
  type StaffId,
  type TextInId,
  type VisitId,
  type VisitKind,
} from './types';

// Each entry is numbered in the order it was written.
const NEXT_SEQ = '(SELECT IFNULL(MAX(seq), 0) + 1 FROM history)';

const ENTRY_COLUMNS = 'id, firm_id, at, seq, actor, owner_id, staff_id, kind';

/** Adds an entry about a job, a customer or a visit of this firm, at the clock's time. */
export async function addHistory(db: RecordDb, firm: FirmId, entry: NewHistory): Promise<HistoryId> {
  const [id, statement] = historyStatement(db, firm, entry);
  // Nothing is written when what it is about is not this firm's.
  const result = await run(statement);
  if (result.meta.changes !== 1) {
    throw new Refused();
  }
  return id;
}

/**
 * The statement that adds an entry about a job, a customer or a visit, for
 * running in the same step as what it records. It writes nothing when what
 * the entry is about is not this firm's, so whoever runs it checks that it
 * wrote one row.
 */
export function historyStatement(
  db: RecordDb,
  firm: FirmId,
  entry: NewHistory,
  /** For an entry about a visit: write it only if the visit starts then, such as after it was moved in the same step. */
  onlyIfVisitStartsAt: Instant | null = null,
): [HistoryId, D1PreparedStatement] {
  const about = aboutOf(entry.kind);
  const id = newId() as HistoryId;
  const [actor, owner, staff] = actorColumns(entry.by);
  const start = [id, firm, db.clock.now(), actor, owner, staff, entry.kind] as const;

  if (about === 'visit' && 'visit' in entry) {
    return [
      id,
      db.d1
        .prepare(
          `INSERT INTO history (${ENTRY_COLUMNS}, customer_id, job_id, visit_id)
           SELECT ?1, ?2, ?3, ${NEXT_SEQ}, ?4, ?5, ?6, ?7, jobs.customer_id, visits.job_id, visits.id
           FROM visits JOIN jobs ON jobs.firm_id = visits.firm_id AND jobs.id = visits.job_id
           WHERE visits.firm_id = ?2 AND visits.id = ?8 AND (?9 IS NULL OR visits.starts_at = ?9)`,
        )
        .bind(...start, entry.visit, onlyIfVisitStartsAt === null ? null : instant(onlyIfVisitStartsAt)),
    ];
  }
  if (about === 'job' && 'job' in entry) {
    return [
      id,
      db.d1
        .prepare(
          `INSERT INTO history (${ENTRY_COLUMNS}, customer_id, job_id)
           SELECT ?1, ?2, ?3, ${NEXT_SEQ}, ?4, ?5, ?6, ?7, jobs.customer_id, jobs.id
           FROM jobs WHERE jobs.firm_id = ?2 AND jobs.id = ?8`,
        )
        .bind(...start, entry.job),
    ];
  }
  if (about === 'customer' && 'customer' in entry) {
    return [
      id,
      db.d1
        .prepare(
          `INSERT INTO history (${ENTRY_COLUMNS}, customer_id)
           SELECT ?1, ?2, ?3, ${NEXT_SEQ}, ?4, ?5, ?6, ?7, customers.id
           FROM customers WHERE customers.firm_id = ?2 AND customers.id = ?8`,
        )
        .bind(...start, entry.customer),
    ];
  }
  throw new Refused();
}

/**
 * The statement for an entry about the firm itself, such as a service switched
 * on. Only firms.ts and owners.ts use it, in the same step as the change it
 * records.
 */
export function firmEntry(
  db: RecordDb,
  firm: FirmId,
  kind:
    | 'service_on'
    | 'service_off'
    | 'stop_on'
    | 'stop_off'
    | 'number_set'
    | 'urgent_list_set'
    | 'owner_mobile_set'
    | 'diary_rules_set',
  by: Actor,
  service: Service | null,
): D1PreparedStatement {
  const [actor, owner, staff] = actorColumns(by);
  return db.d1
    .prepare(
      `INSERT INTO history (${ENTRY_COLUMNS}, service)
       VALUES (?1, ?2, ?3, ${NEXT_SEQ}, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(newId(), firm, db.clock.now(), actor, owner, staff, kind, service);
}

/**
 * The statement for an entry written with a call: the call answered, the
 * caller's details taken, a message taken, or details missing. Only
 * recordCall() uses it, in the same step as the call, its customer and its
 * job. The database checks that the call, the customer and the job are all
 * this firm's, and that the call is about the same customer and job.
 */
export function callEntry(
  db: RecordDb,
  firm: FirmId,
  kind: 'call_answered' | 'details_taken' | 'message_taken' | 'details_missing',
  by: Actor,
  about: { customer: CustomerId | null; job: JobId | null; call: CallId | null },
): D1PreparedStatement {
  const [actor, owner, staff] = actorColumns(by);
  return db.d1
    .prepare(
      `INSERT INTO history (${ENTRY_COLUMNS}, customer_id, job_id, call_id)
       VALUES (?1, ?2, ?3, ${NEXT_SEQ}, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(newId(), firm, db.clock.now(), actor, owner, staff, kind, about.customer, about.job, about.call);
}

/**
 * The statement for an entry about a customer opting out of a kind of text,
 * or back in. Only opt-outs.ts and texts-in.ts use it, in the same step as
 * the change. One made by a customer's STOP or START text also names the job
 * the text went on, so the owner sees it there.
 */
export function optOutEntry(
  db: RecordDb,
  firm: FirmId,
  kind: 'opted_out' | 'opted_in',
  by: Actor,
  about: { customer: CustomerId; job: JobId | null },
  textKind: OptOutKind,
): D1PreparedStatement {
  const [actor, owner, staff] = actorColumns(by);
  return db.d1
    .prepare(
      `INSERT INTO history (${ENTRY_COLUMNS}, customer_id, job_id, text_kind)
       VALUES (?1, ?2, ?3, ${NEXT_SEQ}, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(newId(), firm, db.clock.now(), actor, owner, staff, kind, about.customer, about.job, textKind);
}

/**
 * The statement for the entry about a text that came in, on the customer's
 * job, or on the customer when there is no job. Only recordTextIn() uses it,
 * in the same step as the text. The database checks the text, the customer
 * and the job are all this firm's, and agree.
 */
export function textInEntry(
  db: RecordDb,
  firm: FirmId,
  about: { text: TextInId; customer: CustomerId; job: JobId | null },
): D1PreparedStatement {
  const [actor, owner, staff] = actorColumns({ kind: 'customer' });
  return db.d1
    .prepare(
      `INSERT INTO history (${ENTRY_COLUMNS}, customer_id, job_id, text_in_id)
       VALUES (?1, ?2, ?3, ${NEXT_SEQ}, ?4, ?5, ?6, 'text_received', ?7, ?8, ?9)`,
    )
    .bind(newId(), firm, db.clock.now(), actor, owner, staff, about.customer, about.job, about.text);
}

/** Everything about one job, in the order it happened. */
export async function historyForJob(db: RecordDb, firm: FirmId, job: JobId): Promise<HistoryEntry[]> {
  const { results } = await db.d1
    .prepare(`${SELECT_ENTRY} WHERE h.firm_id = ? AND h.job_id = ? ORDER BY h.at, h.seq`)
    .bind(firm, job)
    .all<EntryRow>();
  return results.map(fromRow);
}

/** Everything about one customer, in the order it happened. */
export async function historyForCustomer(
  db: RecordDb,
  firm: FirmId,
  customer: CustomerId,
): Promise<HistoryEntry[]> {
  const { results } = await db.d1
    .prepare(`${SELECT_ENTRY} WHERE h.firm_id = ? AND h.customer_id = ? ORDER BY h.at, h.seq`)
    .bind(firm, customer)
    .all<EntryRow>();
  return results.map(fromRow);
}

/** Everything the firm's history holds from one instant up to, not including, another. */
export async function historyBetween(
  db: RecordDb,
  firm: FirmId,
  from: Instant,
  to: Instant,
): Promise<HistoryEntry[]> {
  const { results } = await db.d1
    .prepare(`${SELECT_ENTRY} WHERE h.firm_id = ? AND h.at >= ? AND h.at < ? ORDER BY h.at, h.seq`)
    .bind(firm, instant(from), instant(to))
    .all<EntryRow>();
  return results.map(fromRow);
}

const SELECT_ENTRY = `
  SELECT h.id, h.at, h.actor, h.owner_id, h.staff_id, h.kind, h.customer_id,
         c.name AS customer_name, h.job_id, h.visit_id, v.kind AS visit_kind,
         v.starts_at AS visit_starts_at, h.call_id, k.caller AS call_caller,
         k.summary AS call_summary, h.text_in_id, t.words AS text_in_words, h.text_kind, h.service
  FROM history h
  LEFT JOIN customers c ON c.firm_id = h.firm_id AND c.id = h.customer_id
  LEFT JOIN visits v ON v.firm_id = h.firm_id AND v.id = h.visit_id
  LEFT JOIN calls k ON k.firm_id = h.firm_id AND k.id = h.call_id
  LEFT JOIN texts_in t ON t.firm_id = h.firm_id AND t.id = h.text_in_id`;

interface EntryRow {
  id: string;
  at: number;
  actor: Actor['kind'];
  owner_id: string | null;
  staff_id: string | null;
  kind: HistoryKind;
  customer_id: string | null;
  customer_name: string | null;
  job_id: string | null;
  visit_id: string | null;
  visit_kind: VisitKind | null;
  visit_starts_at: number | null;
  call_id: string | null;
  call_caller: string | null;
  call_summary: string | null;
  text_in_id: string | null;
  text_in_words: string | null;
  text_kind: OptOutKind | null;
  service: Service | null;
}

function fromRow(row: EntryRow): HistoryEntry {
  return {
    id: row.id as HistoryId,
    at: instant(row.at),
    by: actorFromRow(row),
    kind: row.kind,
    customer:
      row.customer_id === null || row.customer_name === null
        ? null
        : { id: row.customer_id as CustomerId, name: row.customer_name },
    job: row.job_id as JobId | null,
    visit:
      row.visit_id === null || row.visit_kind === null || row.visit_starts_at === null
        ? null
        : { id: row.visit_id as VisitId, kind: row.visit_kind, startsAt: instant(row.visit_starts_at) },
    call:
      row.call_id === null
        ? null
        : { id: row.call_id as CallId, caller: row.call_caller, summary: row.call_summary },
    textIn:
      row.text_in_id === null || row.text_in_words === null
        ? null
        : { id: row.text_in_id as TextInId, words: row.text_in_words },
    textKind: row.text_kind,
    service: row.service,
  };
}

function actorFromRow(row: EntryRow): Actor {
  switch (row.actor) {
    case 'owner':
      return { kind: 'owner', owner: row.owner_id as OwnerId };
    case 'staff':
      return { kind: 'staff', staff: row.staff_id as StaffId };
    case 'customer':
    case 'frontline':
      return { kind: row.actor };
  }
}

/** Checks the kind against the list, since types can be got round. */
function aboutOf(kind: HistoryKind): (typeof HISTORY_KINDS)[HistoryKind] {
  if (!Object.hasOwn(HISTORY_KINDS, kind)) {
    throw new Refused();
  }
  return HISTORY_KINDS[kind];
}

export function actorColumns(by: Actor): [Actor['kind'], OwnerId | null, StaffId | null] {
  switch (by.kind) {
    case 'frontline':
    case 'customer':
      return [by.kind, null, null];
    case 'owner':
      if (!isId(by.owner)) throw new Refused();
      return ['owner', by.owner, null];
    case 'staff':
      if (!isId(by.staff)) throw new Refused();
      return ['staff', null, by.staff];
    default:
      throw new Refused();
  }
}

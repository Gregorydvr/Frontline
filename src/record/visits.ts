// Visits: a time in the diary for a job. A visit booked from slice E on has
// an end, from the length the firm set for its kind; one from before has
// none, and counts as an hour long (src/record/holds.ts).
//
// Moving or cancelling a visit cancels its rows in the due list that are
// still waiting, and writes new ones, in the same step.

import { instant, type Instant } from '../clock';
import { newId } from '../ids';
import { Refused, run, runTogether, type RecordDb } from './db';
import { historyStatement } from './history';
import { HOLD_LASTS, timeIsFree } from './holds';
import {
  VISIT_KINDS,
  type Actor,
  type CustomerId,
  type HoldId,
  type DiaryVisit,
  type FirmId,
  type JobId,
  type Visit,
  type VisitId,
  type VisitKind,
  type VisitState,
} from './types';

export interface NewVisit {
  job: JobId;
  startsAt: Instant;
  endsAt?: Instant | null;
  kind: VisitKind;
}

/** Books a visit for one of this firm's jobs. Another firm's job is refused. */
export async function createVisit(db: RecordDb, firm: FirmId, input: NewVisit): Promise<VisitId> {
  const id = newId() as VisitId;
  await run(insertVisit(db, firm, id, input));
  return id;
}

/** The statement that books a visit, checked first. recordCall() runs it in the same step as the call. */
export function insertVisit(
  db: RecordDb,
  firm: FirmId,
  id: VisitId,
  input: NewVisit,
  /** Write it only while this hold of the firm's is held, for filing a call's booking. */
  onlyIfHeld: HoldId | null = null,
): D1PreparedStatement {
  if (!VISIT_KINDS.includes(input.kind)) {
    throw new Refused();
  }
  const startsAt = instant(input.startsAt);
  const endsAt = input.endsAt == null ? null : instant(input.endsAt);
  if (endsAt !== null && endsAt <= startsAt) {
    throw new Refused();
  }
  const state: VisitState = 'booked';
  return db.d1
    .prepare(
      `INSERT INTO visits (id, firm_id, job_id, starts_at, ends_at, kind, state, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
       WHERE ?9 IS NULL OR EXISTS (SELECT 1 FROM holds WHERE firm_id = ?2 AND id = ?9 AND state = 'held')`,
    )
    .bind(id, firm, input.job, startsAt, endsAt, input.kind, state, db.clock.now(), onlyIfHeld);
}

/** A row for the due list that comes with a visit's new time: its reminder. */
export interface VisitDue {
  action: 'send_reminder';
  runAt: Instant;
  latestAt: Instant;
}

/**
 * Moves one of the firm's booked visits to a new time, if nothing else takes
 * it, and records who did it. In the same step, its reminder that is still
 * waiting is cancelled and the rows given are written for the new time. A
 * confirmation still waiting is kept, since it reads the visit's time when
 * it goes, and may now go until the new start. Gives false when the visit is
 * not booked, the time is taken, or it already starts then.
 */
export async function moveVisit(
  db: RecordDb,
  firm: FirmId,
  visit: VisitId,
  to: { startsAt: Instant; endsAt: Instant },
  by: Actor,
  dues: readonly VisitDue[],
): Promise<boolean> {
  const startsAt = instant(to.startsAt);
  const endsAt = instant(to.endsAt);
  if (endsAt <= startsAt || dues.some((due) => !(['send_reminder'] as readonly string[]).includes(due.action))) {
    throw new Refused();
  }
  const now = db.clock.now();
  // Every statement after the first acts only if the visit now starts at its
  // new time, so all of it happens, or none of it does.
  const movedHere = `EXISTS (SELECT 1 FROM visits mv WHERE mv.firm_id = ?1 AND mv.id = ?2 AND mv.starts_at = ?3 AND mv.state = 'booked')`;
  const statements = [
    db.d1
      .prepare(
        `UPDATE visits SET starts_at = ?3, ends_at = ?4
         WHERE firm_id = ?1 AND id = ?2 AND state = 'booked' AND starts_at <> ?3
           AND ${timeIsFree({ firm: 1, starts: 3, ends: 4, holdsSince: 5, exceptProvider: 6, exceptCall: 6, exceptVisit: 2 })}`,
      )
      .bind(firm, visit, startsAt, endsAt, now - HOLD_LASTS, null),
    db.d1
      .prepare(
        `UPDATE due SET state = 'cancelled', outcome = 'cancelled', finished_at = ?4
         WHERE firm_id = ?1 AND visit_id = ?2 AND action = 'send_reminder' AND state = 'waiting' AND ${movedHere}`,
      )
      .bind(firm, visit, startsAt, now),
    db.d1
      .prepare(
        `UPDATE due SET latest_at = MAX(run_at, ?4)
         WHERE firm_id = ?1 AND visit_id = ?2 AND action = 'send_confirmation' AND state = 'waiting' AND ${movedHere}`,
      )
      .bind(firm, visit, startsAt, startsAt),
    ...dues.map((due) => {
      const runAt = instant(due.runAt);
      const latestAt = instant(due.latestAt);
      if (latestAt < runAt) throw new Refused();
      return db.d1
        .prepare(
          `INSERT INTO due (id, firm_id, action, visit_id, run_at, latest_at, state, created_at)
           SELECT ?4, ?1, ?5, ?2, ?6, ?7, 'waiting', ?8 WHERE ${movedHere}`,
        )
        .bind(firm, visit, startsAt, newId(), due.action, runAt, latestAt, now);
    }),
    historyStatement(db, firm, { kind: 'visit_moved', by, visit }, startsAt)[1],
  ];
  const [moved] = await runTogether(db.d1, statements);
  return moved?.meta.changes === 1;
}

/**
 * Cancels one of the firm's booked visits, and records who did it. Its rows
 * in the due list that are still waiting are cancelled too, in the same step.
 * Gives false when it was not booked.
 */
export async function cancelVisit(db: RecordDb, firm: FirmId, visit: VisitId, by: Actor): Promise<boolean> {
  const found = await getVisit(db, firm, visit);
  if (found?.state !== 'booked') {
    return false;
  }
  const now = db.clock.now();
  const cancelled: VisitState = 'cancelled';
  const [changed] = await runTogether(db.d1, [
    db.d1
      .prepare(`UPDATE visits SET state = ?3 WHERE firm_id = ?1 AND id = ?2 AND state = 'booked'`)
      .bind(firm, visit, cancelled),
    db.d1
      .prepare(
        `UPDATE due SET state = 'cancelled', outcome = 'cancelled', finished_at = ?3
         WHERE firm_id = ?1 AND visit_id = ?2 AND state = 'waiting'`,
      )
      .bind(firm, visit, now),
    historyStatement(db, firm, { kind: 'visit_cancelled', by, visit })[1],
  ]);
  // Two cancels at once: the second changed nothing, but wrote its entry.
  // Who did what is never edited, so it stays, and this says it was not this one.
  return changed?.meta.changes === 1;
}

export async function getVisit(db: RecordDb, firm: FirmId, visit: VisitId): Promise<Visit | null> {
  const row = await db.d1
    .prepare(`${SELECT_VISIT} WHERE firm_id = ? AND id = ?`)
    .bind(firm, visit)
    .first<VisitRow>();
  return row === null ? null : fromRow(row);
}

/** A job's visits, earliest first. */
export async function listVisitsForJob(db: RecordDb, firm: FirmId, job: JobId): Promise<Visit[]> {
  const { results } = await db.d1
    .prepare(`${SELECT_VISIT} WHERE firm_id = ? AND job_id = ? ORDER BY starts_at, id`)
    .bind(firm, job)
    .all<VisitRow>();
  return results.map(fromRow);
}

/** The firm's booked visits that start at or after an instant, earliest first, each with its customer. */
export async function listVisitsFrom(db: RecordDb, firm: FirmId, from: Instant): Promise<DiaryVisit[]> {
  const { results } = await db.d1
    .prepare(
      `SELECT v.id, v.job_id, v.starts_at, v.ends_at, v.kind, v.state, v.created_at,
              c.id AS customer_id, c.name AS customer_name
       FROM visits v
       JOIN jobs j ON j.firm_id = v.firm_id AND j.id = v.job_id
       JOIN customers c ON c.firm_id = j.firm_id AND c.id = j.customer_id
       WHERE v.firm_id = ? AND v.state = 'booked' AND v.starts_at >= ?
       ORDER BY v.starts_at, v.id`,
    )
    .bind(firm, instant(from))
    .all<VisitRow & { customer_id: string; customer_name: string }>();
  return results.map((row) => ({
    ...fromRow(row),
    customer: { id: row.customer_id as CustomerId, name: row.customer_name },
  }));
}

const SELECT_VISIT = 'SELECT id, job_id, starts_at, ends_at, kind, state, created_at FROM visits';

interface VisitRow {
  id: string;
  job_id: string;
  starts_at: number;
  ends_at: number | null;
  kind: VisitKind;
  state: VisitState;
  created_at: number;
}

function fromRow(row: VisitRow): Visit {
  return {
    id: row.id as VisitId,
    job: row.job_id as JobId,
    startsAt: instant(row.starts_at),
    endsAt: row.ends_at === null ? null : instant(row.ends_at),
    kind: row.kind,
    state: row.state,
    createdAt: instant(row.created_at),
  };
}

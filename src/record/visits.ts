// Visits: a time in the diary for a job. How long a visit takes waits for
// open question 4 in docs/decisions.md, so a visit has a start and no end yet.

import { instant, type Instant } from '../clock';
import { newId } from '../ids';
import { Refused, run, type RecordDb } from './db';
import {
  VISIT_KINDS,
  type CustomerId,
  type DiaryVisit,
  type FirmId,
  type JobId,
  type Visit,
  type VisitId,
  type VisitKind,
  type VisitState,
} from './types';

/** Books a visit for one of this firm's jobs. Another firm's job is refused. */
export async function createVisit(
  db: RecordDb,
  firm: FirmId,
  input: { job: JobId; startsAt: Instant; kind: VisitKind },
): Promise<VisitId> {
  if (!VISIT_KINDS.includes(input.kind)) {
    throw new Refused();
  }
  const id = newId() as VisitId;
  const state: VisitState = 'booked';
  await run(
    db.d1
      .prepare(
        `INSERT INTO visits (id, firm_id, job_id, starts_at, kind, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, firm, input.job, instant(input.startsAt), input.kind, state, db.clock.now()),
  );
  return id;
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
      `SELECT v.id, v.job_id, v.starts_at, v.kind, v.state, v.created_at,
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

const SELECT_VISIT = 'SELECT id, job_id, starts_at, kind, state, created_at FROM visits';

interface VisitRow {
  id: string;
  job_id: string;
  starts_at: number;
  kind: VisitKind;
  state: VisitState;
  created_at: number;
}

function fromRow(row: VisitRow): Visit {
  return {
    id: row.id as VisitId,
    job: row.job_id as JobId,
    startsAt: instant(row.starts_at),
    kind: row.kind,
    state: row.state,
    createdAt: instant(row.created_at),
  };
}

// Jobs: one piece of work for one customer. A job's state is not stored: it
// is worked out from its records (src/job-state.ts).

import { instant } from '../clock';
import { newId } from '../ids';
import { bit, run, words, type RecordDb } from './db';
import type { CustomerId, FirmId, Job, JobId } from './types';

/** Opens a job for one of this firm's customers. Another firm's customer is refused. */
export async function createJob(
  db: RecordDb,
  firm: FirmId,
  input: { customer: CustomerId; about: string; place: string; urgent: boolean },
): Promise<JobId> {
  const id = newId() as JobId;
  await run(
    db.d1
      .prepare(
        `INSERT INTO jobs (id, firm_id, customer_id, about, place, urgent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, firm, input.customer, words(input.about), words(input.place), bit(input.urgent), db.clock.now()),
  );
  return id;
}

export async function getJob(db: RecordDb, firm: FirmId, job: JobId): Promise<Job | null> {
  const row = await db.d1
    .prepare(`${SELECT_JOB} WHERE firm_id = ? AND id = ?`)
    .bind(firm, job)
    .first<JobRow>();
  return row === null ? null : fromRow(row);
}

export async function listJobs(db: RecordDb, firm: FirmId): Promise<Job[]> {
  const { results } = await db.d1
    .prepare(`${SELECT_JOB} WHERE firm_id = ? ORDER BY created_at, id`)
    .bind(firm)
    .all<JobRow>();
  return results.map(fromRow);
}

export async function listJobsForCustomer(db: RecordDb, firm: FirmId, customer: CustomerId): Promise<Job[]> {
  const { results } = await db.d1
    .prepare(`${SELECT_JOB} WHERE firm_id = ? AND customer_id = ? ORDER BY created_at, id`)
    .bind(firm, customer)
    .all<JobRow>();
  return results.map(fromRow);
}

const SELECT_JOB = 'SELECT id, customer_id, about, place, urgent, created_at FROM jobs';

interface JobRow {
  id: string;
  customer_id: string;
  about: string;
  place: string;
  urgent: number;
  created_at: number;
}

function fromRow(row: JobRow): Job {
  return {
    id: row.id as JobId,
    customer: row.customer_id as CustomerId,
    about: row.about,
    place: row.place,
    urgent: row.urgent === 1,
    createdAt: instant(row.created_at),
  };
}

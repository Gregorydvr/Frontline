// Keeping and deleting (slice H of docs/build-brief.md, rule 14 in
// CLAUDE.md): each thing held about a person is deleted by the clock when its
// period runs out. The periods are in periods.ts.
//
// - A call's recording is moved from the inbox into the kept store by its
//   own row in the due list, and deleted by another at the end of its period.
//   The call, its summary and its transcript stay.
// - Everything else goes in each firm's daily sweep: enquiries that never
//   became a job, expired links, ended logins, old Message us, held times,
//   old exports, the bin, the inbox, and the staff log and restore ledger at
//   the end of theirs.
//
// Every row and period is read on the firm's own clock: the real time for
// every real firm, and an example firm's moved on in the control room. Files'
// own times, set by the file store, are read on the real clock.
//
// What an enquiry is: a job with no visit that is not urgent (and, from
// Releases 2 and 3, no quote or invoice), a call with no job, or a text from
// a number that is not a customer's. Each is deleted 12 months after the last
// thing on it. A customer whose last job goes is deleted with it (the
// build's reading of the Assumed row; question 3 of the slice H plan).

import { instant, type Instant } from '../clock';
import { inLondon, londonInstant } from '../london';
import { isId, newId } from '../ids';
import { run, runTogether, type RecordDb } from './db';
import { END_OF_TIME } from './due';
import { CUSTOMER, eraseStatements, JOB, LONE_CALL } from './erase';
import {
  deleteFiles,
  exportKey,
  hasFile,
  listFiles,
  moveFile,
  readFile,
  recordingKey,
  trimLedger,
  type StoreName,
} from './files';
import { recordingEntry } from './history';
import { LOGIN_LASTS } from './logins';
import { monthsBefore, PERIODS } from './periods';
import {
  RECORDING_STATES,
  type CallId,
  type CallRecording,
  type CustomerId,
  type DueId,
  type FirmExportId,
  type FirmId,
  type JobId,
  type RecordingState,
} from './types';

/** The most enquiries one sweep deletes; when there are more, it runs again in a few minutes. */
export const SWEEP_LIMIT = 200;

/** When each firm's daily sweep runs, UK time: 3:15am, when little else is happening. */
export const SWEEP_AT = { hour: 3, minute: 15 } as const;

/** A call's recording, as the record holds it, or null when the firm has no such call. */
export async function getCallRecording(db: RecordDb, firm: FirmId, call: CallId): Promise<CallRecording | null> {
  const row = await db.d1
    .prepare('SELECT recording_state, recording_from, recording_key, recording_until, recording_gone_at FROM calls WHERE firm_id = ? AND id = ?')
    .bind(firm, call)
    .first<RecordingRow>();
  return row === null ? null : recordingFromRow(row);
}

interface RecordingRow {
  recording_state: RecordingState;
  recording_from: string | null;
  recording_key: string | null;
  recording_until: number | null;
  recording_gone_at: number | null;
}

function recordingFromRow(row: RecordingRow): CallRecording {
  return {
    state: RECORDING_STATES.includes(row.recording_state) ? row.recording_state : 'none',
    from: row.recording_from,
    key: row.recording_key,
    until: row.recording_until === null ? null : instant(row.recording_until),
    goneAt: row.recording_gone_at === null ? null : instant(row.recording_gone_at),
  };
}

/**
 * Moves a call's recording from the inbox into the kept store, and marks the
 * call as keeping it. Gives:
 * - kept: it is kept now
 * - waiting: it is not in the inbox yet, as when Vapi is still writing it;
 *   the row waits and tries again
 * - nothing_to_do: the call is gone, or its recording is not waiting
 * Running it again at any point does no harm (files.ts, moveFile()).
 */
export async function moveRecording(db: RecordDb, firm: FirmId, call: CallId): Promise<'kept' | 'waiting' | 'nothing_to_do'> {
  const now = await getCallRecording(db, firm, call);
  if (now?.state !== 'waiting' || now.from === null) {
    return 'nothing_to_do';
  }
  const key = recordingKey(firm, call, now.from);
  if ((await moveFile(db, firm, now.from, key)) === 'missing') {
    return 'waiting';
  }
  await run(
    db.d1
      .prepare(
        `UPDATE calls SET recording_state = 'kept', recording_key = ?3, recording_from = NULL
         WHERE firm_id = ?1 AND id = ?2 AND recording_state = 'waiting'`,
      )
      .bind(firm, call, key),
  );
  return 'kept';
}

/**
 * Gives up moving a call's recording, when its row ran past its latest
 * time: the call is marked not kept, for staff to see, and whatever is in the
 * inbox under its name goes in the bin.
 */
export async function giveUpRecording(db: RecordDb, firm: FirmId, call: CallId): Promise<void> {
  await runTogether(db.d1, [
    db.d1
      .prepare(
        `INSERT INTO files_to_delete (firm_id, bucket, key, at)
         SELECT firm_id, 'inbox', recording_from, ?3 FROM calls
         WHERE firm_id = ?1 AND id = ?2 AND recording_state = 'waiting' AND recording_from IS NOT NULL
         ON CONFLICT DO NOTHING`,
      )
      .bind(firm, call, db.clock.now()),
    db.d1
      .prepare(
        `UPDATE calls SET recording_state = 'not_kept', recording_from = NULL
         WHERE firm_id = ?1 AND id = ?2 AND recording_state = 'waiting'`,
      )
      .bind(firm, call),
  ]);
  await emptyBin(db, firm);
}

/**
 * Deletes a call's recording at the end of its period. The call stays, with
 * its summary and transcript; its history says the recording was deleted,
 * by Front-line. Gives deleted, or nothing_to_do when there is no recording
 * to delete (the call is gone, or it was never kept). The file goes first:
 * stopping after that leaves the call marked as keeping a file that is gone,
 * and running again finishes the job.
 */
export async function deleteRecording(db: RecordDb, firm: FirmId, call: CallId): Promise<'deleted' | 'nothing_to_do'> {
  const now = await getCallRecording(db, firm, call);
  if (now === null || (now.state !== 'kept' && now.state !== 'waiting')) {
    return 'nothing_to_do';
  }
  if (now.key !== null) await deleteFiles(db, firm, 'kept', [now.key]);
  if (now.from !== null) await deleteFiles(db, firm, 'inbox', [now.from]);
  const goneAt = db.clock.now();
  await runTogether(db.d1, [
    db.d1
      .prepare(
        `UPDATE calls SET recording_state = 'deleted', recording_key = NULL, recording_from = NULL, recording_gone_at = ?3
         WHERE firm_id = ?1 AND id = ?2 AND recording_state IN ('kept', 'waiting')`,
      )
      .bind(firm, call, goneAt),
    recordingEntry(db, firm, call, goneAt),
  ]);
  return 'deleted';
}

/** A call's kept recording, to read once, with the name it is kept under, or null when it has none. */
export async function readCallRecording(
  db: RecordDb,
  firm: FirmId,
  call: CallId,
): Promise<{ key: string; body: ReadableStream<Uint8Array>; size: number } | null> {
  const now = await getCallRecording(db, firm, call);
  if (now?.state !== 'kept' || now.key === null) {
    return null;
  }
  const file = await readFile(db, firm, now.key);
  return file === null ? null : { key: now.key, ...file };
}

/**
 * After the database is restored to an earlier point, calls can say they
 * keep a recording that was deleted since. Marks each of the firm's calls
 * whose kept file is gone as deleted. Gives how many.
 */
export async function markMissingRecordings(db: RecordDb, firm: FirmId): Promise<number> {
  const { results } = await db.d1
    .prepare(`SELECT id, recording_key FROM calls WHERE firm_id = ? AND recording_state = 'kept' AND recording_key IS NOT NULL`)
    .bind(firm)
    .all<{ id: string; recording_key: string }>();
  let marked = 0;
  for (const row of results) {
    if (await hasFile(db, firm, row.recording_key)) continue;
    const goneAt = db.clock.now();
    await runTogether(db.d1, [
      db.d1
        .prepare(
          `UPDATE calls SET recording_state = 'deleted', recording_key = NULL, recording_gone_at = ?3
           WHERE firm_id = ?1 AND id = ?2 AND recording_state = 'kept'`,
        )
        .bind(firm, row.id, goneAt),
      recordingEntry(db, firm, row.id as CallId, goneAt),
    ]);
    marked += 1;
  }
  return marked;
}

/**
 * Empties the firm's bin: deletes each file it names from its store, then
 * the note of it. Deleting a file that is gone does nothing, so stopping
 * halfway and running again does no harm. Gives how many it emptied.
 */
export async function emptyBin(db: RecordDb, firm: FirmId): Promise<number> {
  let emptied = 0;
  for (;;) {
    const { results } = await db.d1
      .prepare('SELECT bucket, key FROM files_to_delete WHERE firm_id = ? ORDER BY at, key LIMIT 500')
      .bind(firm)
      .all<{ bucket: StoreName; key: string }>();
    if (results.length === 0) return emptied;
    for (const store of ['kept', 'inbox'] as const) {
      const keys = results.filter((row) => row.bucket === store).map((row) => row.key);
      if (keys.length === 0) continue;
      await deleteFiles(db, firm, store, keys);
      await runTogether(
        db.d1,
        keys.map((key) => db.d1.prepare('DELETE FROM files_to_delete WHERE firm_id = ? AND bucket = ? AND key = ?').bind(firm, store, key)),
      );
    }
    emptied += results.length;
  }
}

/** What one sweep did, by count. */
export interface Swept {
  /** More enquiries are past their period than one sweep deletes: run it again soon. */
  more: boolean;
  counts: Record<string, number>;
}

/**
 * The firm's daily sweep: deletes whatever has run past its period, on the
 * firm's own clock. Each part is its own step, so stopping halfway and
 * running again does no harm: what is done is gone, and what is left is
 * still past its period.
 */
export async function sweepFirm(db: RecordDb, firm: FirmId): Promise<Swept> {
  const now = db.clock.now();
  const real = db.realClock.now();
  const counts: Record<string, number> = {};
  const changes = async (name: string, statement: D1PreparedStatement) => {
    counts[name] = (await run(statement)).meta.changes;
  };

  // Enquiries that never became a job, 12 months after the last thing on them.
  const enquiryBefore = monthsBefore(now, PERIODS.enquiryMonths);
  const enquiries = await enquiriesBefore(db, firm, enquiryBefore);
  const byCustomer = new Map<CustomerId, JobId[]>();
  for (const { job, customer } of enquiries.jobs) {
    byCustomer.set(customer, [...(byCustomer.get(customer) ?? []), job]);
  }
  for (const [customer, jobs] of byCustomer) {
    const all = await db.d1
      .prepare('SELECT COUNT(*) AS n FROM jobs WHERE firm_id = ? AND customer_id = ?')
      .bind(firm, customer)
      .first<{ n: number }>();
    if ((all?.n ?? 0) <= jobs.length) {
      // These are all the customer's jobs: the customer goes with them.
      await runTogether(db.d1, eraseStatements(db, firm, CUSTOMER, customer));
      counts.customers = (counts.customers ?? 0) + 1;
    } else {
      for (const job of jobs) {
        await runTogether(db.d1, eraseStatements(db, firm, JOB, job));
      }
    }
  }
  for (const call of enquiries.calls) {
    await runTogether(db.d1, eraseStatements(db, firm, LONE_CALL, call));
  }
  counts.enquiries = enquiries.jobs.length;
  counts.lone_calls = enquiries.calls.length;
  await changes(
    'lone_texts_in',
    db.d1.prepare('DELETE FROM texts_in WHERE firm_id = ? AND customer_id IS NULL AND received_at < ?').bind(firm, enquiryBefore),
  );

  // Customers' links once they expire, and owners' login links a day after.
  await changes('links', db.d1.prepare('DELETE FROM links WHERE firm_id = ? AND expires_at <= ?').bind(firm, now - PERIODS.linkAfterExpiry));
  await changes(
    'login_links',
    db.d1.prepare('DELETE FROM login_links WHERE firm_id = ? AND expires_at <= ?').bind(firm, now - PERIODS.loginLinkAfterExpiry),
  );
  // Logins a day after they ended: logged out, unused too long, or at their longest.
  const ended = now - PERIODS.sessionAfterEnd;
  await changes(
    'sessions',
    db.d1
      .prepare(
        `DELETE FROM sessions WHERE firm_id = ?1
           AND (ended_at <= ?2 OR last_used_at <= ?3 OR created_at <= ?4)`,
      )
      .bind(firm, ended, ended - LOGIN_LASTS.unused, ended - LOGIN_LASTS.longest),
  );
  // What owners wrote in Message us, 12 months on.
  await changes(
    'owner_messages',
    db.d1.prepare('DELETE FROM owner_messages WHERE firm_id = ? AND created_at < ?').bind(firm, monthsBefore(now, PERIODS.ownerMessageMonths)),
  );
  // Times held during a call, 30 days after their last change.
  await changes('holds', db.d1.prepare('DELETE FROM holds WHERE firm_id = ? AND updated_at <= ?').bind(firm, now - PERIODS.hold));

  // Exports 30 days on: the file into the bin and the row out, in one step.
  const { results: oldExports } = await db.d1
    .prepare('SELECT id FROM firm_exports WHERE firm_id = ? AND asked_at <= ?')
    .bind(firm, now - PERIODS.firmExport)
    .all<{ id: string }>();
  for (const { id } of oldExports) {
    await runTogether(db.d1, [
      db.d1
        .prepare(`INSERT INTO files_to_delete (firm_id, bucket, key, at) VALUES (?, 'kept', ?, ?) ON CONFLICT DO NOTHING`)
        .bind(firm, exportKey(firm, id as FirmExportId), now),
      db.d1.prepare('DELETE FROM firm_exports WHERE firm_id = ? AND id = ?').bind(firm, id),
    ]);
  }
  counts.firm_exports = oldExports.length;

  // Anything left in the inbox a day after it was written, by the file
  // store's own time, such as a second copy Vapi wrote.
  const stale = (await listFiles(db, firm, 'inbox')).filter((file) => file.uploaded <= real - PERIODS.inbox);
  await deleteFiles(db, firm, 'inbox', stale.map((file) => file.key));
  counts.inbox = stale.length;

  counts.bin = await emptyBin(db, firm);

  // The staff log at the end of its period: this firm's rows, and those of
  // no firm or of a firm no longer held, which belong to no firm's sweep.
  // Then any member of staff no row names any more. Read on the real clock.
  const staffLogBefore = monthsBefore(real, PERIODS.staffLogYears * 12);
  const [, trimmed] = await runTogether(db.d1, [
    db.d1.prepare('INSERT INTO staff_log_trimming (before) VALUES (?)').bind(staffLogBefore),
    db.d1
      .prepare(
        `DELETE FROM staff_log WHERE at < ?2
           AND (firm_id = ?1 OR firm_id IS NULL OR NOT EXISTS (SELECT 1 FROM firms f WHERE f.id = staff_log.firm_id))`,
      )
      .bind(firm, staffLogBefore),
    db.d1.prepare('DELETE FROM staff_log_trimming'),
  ]);
  counts.staff_log = trimmed?.meta.changes ?? 0;
  await changes(
    'staff',
    db.d1
      .prepare(
        `DELETE FROM staff WHERE created_at < ?1
           AND NOT EXISTS (SELECT 1 FROM staff_log l WHERE l.staff_id = staff.id)
           AND NOT EXISTS (SELECT 1 FROM firm_exports e WHERE e.staff_id = staff.id)
           AND NOT EXISTS (SELECT 1 FROM deleted_firms d WHERE d.staff_id = staff.id)`,
      )
      .bind(staffLogBefore),
  );
  counts.ledger = await trimLedger(db, instant(real - PERIODS.ledger));

  return { more: enquiries.more, counts };
}

/**
 * The firm's enquiries past their period, at most SWEEP_LIMIT jobs and as
 * many calls: jobs with no visit that are not urgent, with nothing on them
 * since the cut-off, and calls with no job from before it.
 */
async function enquiriesBefore(
  db: RecordDb,
  firm: FirmId,
  before: number,
): Promise<{ jobs: { job: JobId; customer: CustomerId }[]; calls: CallId[]; more: boolean }> {
  const { results: jobs } = await db.d1
    .prepare(
      `SELECT j.id, j.customer_id FROM jobs j
       WHERE j.firm_id = ?1 AND j.urgent = 0
         AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.firm_id = j.firm_id AND v.job_id = j.id)
         AND j.created_at < ?2
         AND NOT EXISTS (SELECT 1 FROM history h WHERE h.firm_id = j.firm_id AND h.job_id = j.id AND h.at >= ?2)
         AND NOT EXISTS (SELECT 1 FROM calls k WHERE k.firm_id = j.firm_id AND k.job_id = j.id AND k.started_at >= ?2)
         AND NOT EXISTS (SELECT 1 FROM texts_in t WHERE t.firm_id = j.firm_id AND t.job_id = j.id AND t.received_at >= ?2)
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.firm_id = j.firm_id AND m.job_id = j.id AND m.created_at >= ?2)
       ORDER BY j.created_at, j.id
       LIMIT ?3`,
    )
    .bind(firm, before, SWEEP_LIMIT + 1)
    .all<{ id: string; customer_id: string }>();
  const { results: calls } = await db.d1
    .prepare(
      `SELECT id FROM calls WHERE firm_id = ?1 AND job_id IS NULL AND started_at < ?2
       ORDER BY started_at, id LIMIT ?3`,
    )
    .bind(firm, before, SWEEP_LIMIT + 1)
    .all<{ id: string }>();
  return {
    jobs: jobs.slice(0, SWEEP_LIMIT).map((row) => ({ job: row.id as JobId, customer: row.customer_id as CustomerId })),
    calls: calls.slice(0, SWEEP_LIMIT).map((row) => row.id as CallId),
    more: jobs.length > SWEEP_LIMIT || calls.length > SWEEP_LIMIT,
  };
}

/** The next time a firm's sweep runs after `now`, on the firm's clock: 3:15am UK time. */
export function nextSweepAt(now: Instant): Instant {
  const today = inLondon(now);
  const at = londonInstant(today.year, today.month, today.day, SWEEP_AT.hour, SWEEP_AT.minute);
  return at > now ? at : londonInstant(today.year, today.month, today.day + 1, SWEEP_AT.hour, SWEEP_AT.minute);
}

/**
 * Gives every firm that has no daily sweep waiting one, for the next 3:15am
 * on its own clock. Run by the clock every minute, so a new firm gets its
 * first, each firm gets the next once one is done, and one that went missing
 * comes back. The database holds each firm to one. A record function that
 * takes no firm, like findDue(): the clock works for every firm at once. It
 * gives only ids.
 */
export async function addMissingSweeps(db: RecordDb): Promise<{ firm: FirmId; due: DueId }[]> {
  const real = db.realClock.now();
  const { results } = await db.d1
    .prepare(
      `SELECT f.id, f.clock_ahead FROM firms f
       WHERE NOT EXISTS (SELECT 1 FROM due d WHERE d.firm_id = f.id AND d.action = 'sweep' AND d.state IN ('waiting', 'claimed'))`,
    )
    .all<{ id: string; clock_ahead: number }>();
  const added: { firm: FirmId; due: DueId }[] = [];
  for (const row of results) {
    if (!isId(row.id)) continue;
    const firmNow = instant(real + row.clock_ahead);
    const due = newId() as DueId;
    const written = await run(
      db.d1
        .prepare(
          `INSERT INTO due (id, firm_id, action, run_at, latest_at, state, created_at)
           VALUES (?, ?, 'sweep', ?, ?, 'waiting', ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(due, row.id, nextSweepAt(firmNow), END_OF_TIME, firmNow),
    );
    if (written.meta.changes === 1) added.push({ firm: row.id as FirmId, due });
  }
  return added;
}

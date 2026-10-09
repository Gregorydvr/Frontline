// The due list: everything timed is a row here (rule 20 in CLAUDE.md). A row
// says what to do, the earliest time to do it and the latest time it is
// still worth doing. Every minute the clock finds the rows that are due and
// puts them on a queue; a worker claims a row in one step, acts, and marks it
// done. A row past its latest time is skipped, and that is kept on the row.

import { instant, type Instant } from '../clock';
import { isId, newId, type Id } from '../ids';
import { Refused, run, type RecordDb } from './db';
import {
  DUE_ACTIONS,
  DUE_OUTCOMES,
  type CallId,
  type ClaimedDue,
  type Due,
  type DueAction,
  type DueId,
  type DueOutcome,
  type DueState,
  type FirmId,
  type VisitId,
} from './types';

/** How long the clock waits before putting a row on the queue again, in case the first went astray. */
export const REQUEUE_AFTER = 5 * 60_000;
/** How long a claim holds. A worker that stopped halfway leaves its row to be claimed again after this. */
export const CLAIM_HOLDS_FOR = 10 * 60_000;
/** The most rows the clock puts on the queue in one minute. */
export const MOST_PER_MINUTE = 500;
/**
 * The latest time of a row that deletes something: the largest instant a
 * date can hold, so a deletion is never skipped as too late (slice H).
 */
export const END_OF_TIME = instant(8_640_000_000_000_000);

export interface NewDue {
  action: DueAction;
  call?: CallId | null;
  visit?: VisitId | null;
  runAt: Instant;
  latestAt: Instant;
}

/** Adds a row to the firm's due list. Something of another firm's to act on is refused. */
export async function addDue(db: RecordDb, firm: FirmId, input: NewDue): Promise<DueId> {
  const id = newId() as DueId;
  await run(insertDue(db, firm, id, input));
  return id;
}

/** The statement that adds a row, checked first. recordCall() runs it in the same step as an urgent call. */
export function insertDue(db: RecordDb, firm: FirmId, id: DueId, input: NewDue): D1PreparedStatement {
  if (!DUE_ACTIONS.includes(input.action)) {
    throw new Refused();
  }
  const runAt = instant(input.runAt);
  const latestAt = instant(input.latestAt);
  if (latestAt < runAt) {
    throw new Refused();
  }
  const waiting: DueState = 'waiting';
  return db.d1
    .prepare(
      `INSERT INTO due (id, firm_id, action, call_id, visit_id, run_at, latest_at, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, firm, input.action, input.call ?? null, input.visit ?? null, runAt, latestAt, waiting, db.clock.now());
}

/**
 * The rows that are due now, for every firm, marked as put on the queue. The
 * one record function besides the three that find or make a firm that takes
 * no firm: the clock works for all of them at once. It gives only ids.
 *
 * A row is due when its time has come and it is waiting, and it was not put
 * on the queue in the last few minutes; or when a worker claimed it and has
 * held it too long, so has likely stopped.
 */
export async function findDue(db: RecordDb): Promise<{ firm: FirmId; due: DueId }[]> {
  // Each firm's rows are due by its own clock: the real time, moved on by
  // how far ahead the firm's clock runs, which is 0 for every real firm. A
  // row's times were written by that clock too.
  const now = db.realClock.now();
  const { results } = await db.d1
    .prepare(
      `UPDATE due SET queued_at = ?1 + (SELECT f.clock_ahead FROM firms f WHERE f.id = due.firm_id)
       WHERE id IN (
         SELECT d.id FROM due d JOIN firms f ON f.id = d.firm_id
         WHERE d.run_at <= ?1 + f.clock_ahead
           AND ((d.state = 'waiting' AND (d.queued_at IS NULL OR d.queued_at <= ?2 + f.clock_ahead))
             OR (d.state = 'claimed' AND d.claimed_at <= ?3 + f.clock_ahead AND (d.queued_at IS NULL OR d.queued_at <= ?2 + f.clock_ahead)))
         ORDER BY d.run_at - f.clock_ahead, d.id
         LIMIT ?4)
       RETURNING firm_id, id`,
    )
    .bind(now, now - REQUEUE_AFTER, now - CLAIM_HOLDS_FOR, MOST_PER_MINUTE)
    .all<{ firm_id: string; id: string }>();
  return results.map((row) => ({ firm: row.firm_id as FirmId, due: row.id as DueId }));
}

/**
 * Claims one of the firm's rows, in one step, for the worker that asked. Only
 * one worker wins: the row must be due and waiting, or held by a claim that
 * has run out. Gives the row with its claim, or null when it was not won.
 */
export async function claimDue(db: RecordDb, firm: FirmId, due: DueId): Promise<ClaimedDue | null> {
  const now = db.clock.now();
  const claim = newId();
  const row = await db.d1
    .prepare(
      `UPDATE due SET state = 'claimed', claim = ?3, claimed_at = ?4
       WHERE firm_id = ?1 AND id = ?2 AND run_at <= ?4
         AND (state = 'waiting' OR (state = 'claimed' AND claimed_at <= ?5))
       RETURNING ${DUE_COLUMNS}`,
    )
    .bind(firm, due, claim, now, now - CLAIM_HOLDS_FOR)
    .first<DueRow>();
  return row === null ? null : { ...fromRow(row), claim };
}

/**
 * Marks a claimed row done, or skipped, with how it ended. Only the worker
 * holding the claim can: one whose claim ran out and was taken by another
 * changes nothing, and is told so.
 */
export async function finishDue(
  db: RecordDb,
  firm: FirmId,
  due: DueId,
  claim: Id,
  outcome: DueOutcome,
): Promise<boolean> {
  if (!DUE_OUTCOMES.includes(outcome) || outcome === 'cancelled' || !isId(claim)) {
    throw new Refused();
  }
  const state: DueState = outcome === 'too_late' ? 'skipped' : 'done';
  const result = await run(
    db.d1
      .prepare(
        `UPDATE due SET state = ?4, outcome = ?5, finished_at = ?6, claim = NULL, claimed_at = NULL
         WHERE firm_id = ?1 AND id = ?2 AND state = 'claimed' AND claim = ?3`,
      )
      .bind(firm, due, claim, state, outcome, db.clock.now()),
  );
  return result.meta.changes === 1;
}

/**
 * Puts a claimed row back to wait, such as a text to a customer while the
 * firm's stop button is on: the clock offers it again in a few minutes, until
 * it is done or past its latest time. Given a time, the row waits until then
 * instead, such as 8am after quiet hours; a time past the row's latest is
 * refused, and the row is left as it was.
 */
export async function releaseDue(db: RecordDb, firm: FirmId, due: DueId, claim: Id, until: Instant | null = null): Promise<boolean> {
  if (!isId(claim)) {
    throw new Refused();
  }
  const runAt = until === null ? null : instant(until);
  const result = await run(
    db.d1
      .prepare(
        `UPDATE due SET state = 'waiting', claim = NULL, claimed_at = NULL,
                        run_at = COALESCE(?4, run_at),
                        queued_at = CASE WHEN ?4 IS NULL THEN queued_at ELSE NULL END
         WHERE firm_id = ?1 AND id = ?2 AND state = 'claimed' AND claim = ?3
           AND (?4 IS NULL OR ?4 <= latest_at)`,
      )
      .bind(firm, due, claim, runAt),
  );
  return result.meta.changes === 1;
}

/**
 * Cancels one of the firm's rows that is still waiting, such as the reminder
 * for a visit that was moved. A row already claimed or finished is left as
 * it is, and the answer is false.
 */
export async function cancelDue(db: RecordDb, firm: FirmId, due: DueId): Promise<boolean> {
  const result = await run(
    db.d1
      .prepare(
        `UPDATE due SET state = 'cancelled', outcome = 'cancelled', finished_at = ?3
         WHERE firm_id = ?1 AND id = ?2 AND state = 'waiting'`,
      )
      .bind(firm, due, db.clock.now()),
  );
  return result.meta.changes === 1;
}

export async function getDue(db: RecordDb, firm: FirmId, due: DueId): Promise<Due | null> {
  const row = await db.d1
    .prepare(`SELECT ${DUE_COLUMNS} FROM due WHERE firm_id = ? AND id = ?`)
    .bind(firm, due)
    .first<DueRow>();
  return row === null ? null : fromRow(row);
}

/** The firm's rows about one call, in the order they were written. */
export async function listDueForCall(db: RecordDb, firm: FirmId, call: CallId): Promise<Due[]> {
  const { results } = await db.d1
    .prepare(`SELECT ${DUE_COLUMNS} FROM due WHERE firm_id = ? AND call_id = ? ORDER BY created_at, id`)
    .bind(firm, call)
    .all<DueRow>();
  return results.map(fromRow);
}

/** The firm's rows about one visit, in the order they were written. */
export async function listDueForVisit(db: RecordDb, firm: FirmId, visit: VisitId): Promise<Due[]> {
  const { results } = await db.d1
    .prepare(`SELECT ${DUE_COLUMNS} FROM due WHERE firm_id = ? AND visit_id = ? ORDER BY created_at, rowid`)
    .bind(firm, visit)
    .all<DueRow>();
  return results.map(fromRow);
}

const DUE_COLUMNS = 'id, action, call_id, visit_id, run_at, latest_at, state, outcome, created_at, finished_at';

interface DueRow {
  id: string;
  action: DueAction;
  call_id: string | null;
  visit_id: string | null;
  run_at: number;
  latest_at: number;
  state: DueState;
  outcome: DueOutcome | null;
  created_at: number;
  finished_at: number | null;
}

function fromRow(row: DueRow): Due {
  return {
    id: row.id as DueId,
    action: row.action,
    call: row.call_id as CallId | null,
    visit: row.visit_id as VisitId | null,
    runAt: instant(row.run_at),
    latestAt: instant(row.latest_at),
    state: row.state,
    outcome: row.outcome,
    createdAt: instant(row.created_at),
    finishedAt: row.finished_at === null ? null : instant(row.finished_at),
  };
}

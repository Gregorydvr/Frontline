// What a delete removes, in one place, so exporting and deleting can never
// drift apart (slices G and H of docs/build-brief.md). Three kinds of delete:
// - a customer, and everything held about them: staff deleting a customer
//   from the control room, and the sweep when their last job, an enquiry,
//   runs past its period
// - one job that was an enquiry, and what is about it, when the customer
//   has other jobs
// - one call with no job, such as a caller whose details did not come
//   through, when it runs past its period
//
// Each list is table by table, in the order the delete removes them, so
// nothing is removed before what points at it. In each, ?1 is the firm and
// ?2 the customer, job or call. History is deleted only inside such a
// delete, behind the permission slip the database checks
// (migrations/0008_control_room.sql).
//
// A recording or a file still in the inbox, named by a call that goes, is
// put in the bin (files_to_delete) in the same step, so no file is ever left
// without a note of it. The bin is emptied straight after (keeping.ts).

import type { RecordDb } from './db';
import type { FirmId } from './types';

export interface Belonging {
  table: string;
  /** Which of the firm's rows in the table are about what is deleted. */
  where: string;
  /** Kept when it is deleted, and why. */
  kept?: 'stop_list';
}

export interface Scope {
  belongings: readonly Belonging[];
  /** The calls the delete removes, whose files go in the bin. */
  calls: string;
}

// A customer. Beside what names them, it covers calls and texts that came
// from one of their numbers but were never tied to a customer (such as a
// call whose details did not come through), as long as no other customer of
// the firm has that number.
export const THEIR_NUMBERS = `(SELECT mobile FROM customers WHERE firm_id = ?1 AND id = ?2
                        UNION SELECT landline FROM customers WHERE firm_id = ?1 AND id = ?2)`;
const nobodyElseOn = (column: string) =>
  `NOT EXISTS (SELECT 1 FROM customers other
               WHERE other.firm_id = ?1 AND other.id <> ?2 AND (other.mobile = ${column} OR other.landline = ${column}))`;
const THEIR_JOBS = 'SELECT id FROM jobs WHERE firm_id = ?1 AND customer_id = ?2';
const THEIR_VISITS = `SELECT id FROM visits WHERE firm_id = ?1 AND job_id IN (${THEIR_JOBS})`;
const THEIR_CALLS = `SELECT k.id FROM calls k WHERE k.firm_id = ?1 AND (k.customer_id = ?2
  OR (k.customer_id IS NULL AND k.from_number IN ${THEIR_NUMBERS} AND ${nobodyElseOn('k.from_number')}))`;
const THEIR_TEXTS_IN = `SELECT t.id FROM texts_in t WHERE t.firm_id = ?1 AND (t.customer_id = ?2
  OR (t.customer_id IS NULL AND t.from_number IN ${THEIR_NUMBERS} AND ${nobodyElseOn('t.from_number')}))`;
const THEIR_DUES = `SELECT id FROM due WHERE firm_id = ?1 AND (call_id IN (${THEIR_CALLS}) OR visit_id IN (${THEIR_VISITS}))`;

/** The time held during one of these calls. */
const holdsOf = (calls: string, visits: string) => `visit_id IN (${visits})
  OR EXISTS (SELECT 1 FROM calls k WHERE k.firm_id = holds.firm_id AND k.provider = holds.provider
             AND k.provider_call_id = holds.provider_call_id AND k.id IN (${calls}))`;

export const CUSTOMER: Scope = {
  calls: THEIR_CALLS,
  belongings: [
    {
      table: 'history',
      where: `customer_id = ?2 OR job_id IN (${THEIR_JOBS}) OR call_id IN (${THEIR_CALLS}) OR text_in_id IN (${THEIR_TEXTS_IN})`,
    },
    // Texts to them, and the owner's alerts about their calls, which carry their name and number.
    {
      table: 'messages',
      where: `customer_id = ?2 OR job_id IN (${THEIR_JOBS}) OR visit_id IN (${THEIR_VISITS}) OR call_id IN (${THEIR_CALLS}) OR due_id IN (${THEIR_DUES})`,
    },
    { table: 'links', where: 'customer_id = ?2' },
    // An owner's link to log in that would land on one of their jobs.
    { table: 'login_links', where: `job_id IN (${THEIR_JOBS})` },
    { table: 'due', where: `id IN (${THEIR_DUES})` },
    { table: 'texts_in', where: `id IN (${THEIR_TEXTS_IN})` },
    { table: 'opt_outs', where: 'customer_id = ?2' },
    // A STOP from their mobile is kept on the firm's list of numbers that get
    // no text, with nothing else about them, so a customer made later on the
    // same number still gets none (Greg to confirm: question 5 of the slice
    // H plan).
    { table: 'opted_out_numbers', where: `mobile IN ${THEIR_NUMBERS}`, kept: 'stop_list' },
    { table: 'holds', where: holdsOf(THEIR_CALLS, THEIR_VISITS) },
    { table: 'calls', where: `id IN (${THEIR_CALLS})` },
    { table: 'visits', where: `id IN (${THEIR_VISITS})` },
    { table: 'jobs', where: 'customer_id = ?2' },
    { table: 'customers', where: 'id = ?2' },
  ],
};

// One job of a customer who has others: an enquiry that ran past its period.
const JOBS_VISITS = 'SELECT id FROM visits WHERE firm_id = ?1 AND job_id = ?2';
const JOBS_CALLS = 'SELECT id FROM calls WHERE firm_id = ?1 AND job_id = ?2';
const JOBS_TEXTS_IN = 'SELECT id FROM texts_in WHERE firm_id = ?1 AND job_id = ?2';
const JOBS_DUES = `SELECT id FROM due WHERE firm_id = ?1 AND (call_id IN (${JOBS_CALLS}) OR visit_id IN (${JOBS_VISITS}))`;

export const JOB: Scope = {
  calls: JOBS_CALLS,
  belongings: [
    { table: 'history', where: `job_id = ?2 OR call_id IN (${JOBS_CALLS}) OR text_in_id IN (${JOBS_TEXTS_IN})` },
    { table: 'messages', where: `job_id = ?2 OR visit_id IN (${JOBS_VISITS}) OR call_id IN (${JOBS_CALLS}) OR due_id IN (${JOBS_DUES})` },
    { table: 'links', where: 'job_id = ?2' },
    { table: 'login_links', where: 'job_id = ?2' },
    { table: 'due', where: `id IN (${JOBS_DUES})` },
    { table: 'texts_in', where: `id IN (${JOBS_TEXTS_IN})` },
    { table: 'holds', where: holdsOf(JOBS_CALLS, JOBS_VISITS) },
    { table: 'calls', where: `id IN (${JOBS_CALLS})` },
    { table: 'visits', where: `id IN (${JOBS_VISITS})` },
    { table: 'jobs', where: 'id = ?2' },
  ],
};

// One call with no job: a caller who was not a customer, or whose details
// did not come through.
const THE_CALL = 'SELECT id FROM calls WHERE firm_id = ?1 AND id = ?2 AND job_id IS NULL';
const THE_CALLS_DUES = `SELECT id FROM due WHERE firm_id = ?1 AND call_id IN (${THE_CALL})`;

export const LONE_CALL: Scope = {
  calls: THE_CALL,
  belongings: [
    { table: 'history', where: `call_id IN (${THE_CALL})` },
    // The owner's alert about it, if it was urgent.
    { table: 'messages', where: `call_id IN (${THE_CALL}) OR due_id IN (${THE_CALLS_DUES})` },
    { table: 'due', where: `id IN (${THE_CALLS_DUES})` },
    { table: 'holds', where: holdsOf(THE_CALL, 'SELECT NULL WHERE 0') },
    { table: 'calls', where: `id IN (${THE_CALL})` },
  ],
};

/**
 * The statements that delete what a scope covers, for running as one step:
 * the permission slip for history, the calls' files into the bin, every
 * table in order, and the slip taken away. What a scope keeps is left.
 */
export function eraseStatements(db: RecordDb, firm: FirmId, scope: Scope, id: string): D1PreparedStatement[] {
  const now = db.clock.now();
  return [
    db.d1.prepare('INSERT INTO erasing (firm_id) VALUES (?)').bind(firm),
    ...binStatements(db, firm, scope.calls, id, now),
    // The table names come from the fixed lists above, never from a caller.
    ...scope.belongings
      .filter((belonging) => belonging.kept === undefined)
      .map(({ table, where }) => db.d1.prepare(`DELETE FROM ${table} WHERE firm_id = ?1 AND (${where})`).bind(firm, id)),
    db.d1.prepare('DELETE FROM erasing WHERE firm_id = ?').bind(firm),
  ];
}

/** How many statements eraseStatements() runs before the deletes, so their results can be found. */
export const BEFORE_THE_DELETES = 3;

/** The statements that put the files named by some calls in the bin: a kept recording, and one still in the inbox. */
function binStatements(db: RecordDb, firm: FirmId, calls: string, id: string, now: number): D1PreparedStatement[] {
  return [
    db.d1
      .prepare(
        `INSERT INTO files_to_delete (firm_id, bucket, key, at)
         SELECT firm_id, 'kept', recording_key, ?3 FROM calls
         WHERE firm_id = ?1 AND recording_key IS NOT NULL AND id IN (${calls})
         ON CONFLICT DO NOTHING`,
      )
      .bind(firm, id, now),
    db.d1
      .prepare(
        `INSERT INTO files_to_delete (firm_id, bucket, key, at)
         SELECT firm_id, 'inbox', recording_from, ?3 FROM calls
         WHERE firm_id = ?1 AND recording_from IS NOT NULL AND id IN (${calls})
         ON CONFLICT DO NOTHING`,
      )
      .bind(firm, id, now),
  ];
}

/** The rows a scope would delete, or export, table by table. */
export function selectStatements(db: RecordDb, firm: FirmId, scope: Scope, id: string): D1PreparedStatement[] {
  return scope.belongings.map(({ table, where }) =>
    db.d1.prepare(`SELECT * FROM ${table} WHERE firm_id = ?1 AND (${where}) ORDER BY rowid`).bind(firm, id),
  );
}

// Every table that holds a firm's rows, in the order a firm's delete removes
// them, so nothing is removed before what points at it. The firm's own row
// goes last. A test fails when a table is added that is not here.
export const FIRM_TABLES = [
  'files_to_delete',
  'firm_exports',
  'history',
  'messages',
  'links',
  'login_links',
  'sessions',
  'due',
  'texts_in',
  'opt_outs',
  'opted_out_numbers',
  'holds',
  'calls',
  'visits',
  'jobs',
  'customers',
  'wording',
  'owner_messages',
  'owners',
] as const;

/**
 * The statements that delete a firm and every row it holds, for running as
 * one step. Every statement checks the guard again, inside the database: an
 * example firm, for a reset, or a firm that is leaving, for its delete. So a
 * firm that is neither cannot lose a row, even if the code before were wrong.
 */
export function eraseFirmStatements(db: RecordDb, firm: FirmId, guard: 'example' | 'leaving'): D1PreparedStatement[] {
  const allowed =
    guard === 'example'
      ? 'EXISTS (SELECT 1 FROM firms WHERE id = ?1 AND is_example = 1)'
      : 'EXISTS (SELECT 1 FROM firms WHERE id = ?1 AND left_at IS NOT NULL)';
  const only = guard === 'example' ? 'is_example = 1' : 'left_at IS NOT NULL';
  return [
    db.d1.prepare(`INSERT INTO erasing (firm_id) SELECT ?1 WHERE ${allowed}`).bind(firm),
    // The table names come from the fixed list above, never from a caller.
    ...FIRM_TABLES.map((table) => db.d1.prepare(`DELETE FROM ${table} WHERE firm_id = ?1 AND ${allowed}`).bind(firm)),
    db.d1.prepare('DELETE FROM erasing WHERE firm_id = ?1').bind(firm),
    db.d1.prepare(`DELETE FROM firms WHERE id = ?1 AND ${only}`).bind(firm),
  ];
}

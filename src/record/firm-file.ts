// One firm's records as a file, a firm leaving, and deleting a firm (slice H
// of docs/build-brief.md). When a firm leaves, its records are handed over
// as a file and deleted within 30 days (docs/decisions.md):
//
// 1. Staff say the firm is leaving, typing its name. In the same step: the
//    stop button goes on, every service off, every text still waiting is
//    cancelled, the export is asked for, and a row in the due list will
//    delete the firm 30 days on. Its number no longer finds it, so its calls
//    and texts are no longer kept.
// 2. The export is made by a row in the due list (src/firm-export.ts), and
//    staff download it from the control room to hand over.
// 3. The firm is deleted: by staff, once the export is made, typing its name
//    again; or by the clock at the end of the 30 days, whether or not it was
//    downloaded. Its files go first, then every row it holds, in one step.
//    A list of deleted firms, ids only, keeps when and how.
//
// Until the firm is deleted, staff can cancel its leaving.

import { instant, type Instant } from '../clock';
import { isId, newId } from '../ids';
import { Refused, run, runTogether, type RecordDb } from './db';
import { END_OF_TIME } from './due';
import { eraseFirmStatements, FIRM_TABLES } from './erase';
import { deleteAllFiles, exportKey, noteDeletion, readFile, writeFile, type FileWriter } from './files';
import { firmEntry } from './history';
import { PERIODS } from './periods';
import { staffLogStatement } from './staff';
import { SERVICES, type DueId, type FirmExportId, type FirmId, type StaffId } from './types';
import { getFirm } from './firms';

/** A file of one firm's records. */
export interface FirmExport {
  id: FirmExportId;
  state: 'asked' | 'ready';
  /** Its size in bytes, once made. */
  size: number | null;
  askedAt: Instant;
  readyAt: Instant | null;
  downloadedAt: Instant | null;
}

/** Columns never put in an export: the keys a link opens with, and a worker's claim. */
const NEVER_EXPORTED = new Set(['token', 'claim']);

/** A row as an export gives it: times as UTC dates, and no keys. */
export function forExport(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (NEVER_EXPORTED.has(column)) continue;
    out[column] = (column === 'at' || column.endsWith('_at')) && typeof value === 'number' ? new Date(value).toISOString() : value;
  }
  return out;
}

/** The tables a firm's export reads, the firm's own row first. */
export const EXPORTED_TABLES = ['firms', ...FIRM_TABLES.filter((table) => table !== 'files_to_delete' && table !== 'firm_exports')] as const;
export type ExportedTable = (typeof EXPORTED_TABLES)[number];

/**
 * Asks for a file of the firm's records, by a member of staff: a row in the
 * due list makes it. Recorded in the staff log in the same step.
 */
export async function askFirmExport(db: RecordDb, firm: FirmId, staff: StaffId): Promise<FirmExportId> {
  const [id, statements] = askExportStatements(db, firm, staff);
  const [, logged] = staffLogStatement(db, firm, staff, 'asked_firm_export');
  const results = await runTogether(db.d1, [...statements, logged]);
  if (results[0]?.meta.changes !== 1) {
    throw new Refused();
  }
  return id;
}

function askExportStatements(db: RecordDb, firm: FirmId, staff: StaffId): [FirmExportId, D1PreparedStatement[]] {
  if (!isId(staff)) {
    throw new Refused();
  }
  const id = newId() as FirmExportId;
  const now = db.clock.now();
  return [
    id,
    [
      db.d1
        .prepare(
          `INSERT INTO firm_exports (id, firm_id, staff_id, state, asked_at)
           SELECT ?1, ?2, ?3, 'asked', ?4 WHERE EXISTS (SELECT 1 FROM firms WHERE id = ?2)`,
        )
        .bind(id, firm, staff, now),
      db.d1
        .prepare(
          `INSERT INTO due (id, firm_id, action, run_at, latest_at, state, created_at)
           SELECT ?1, ?2, 'make_firm_export', ?3, ?4, 'waiting', ?3 WHERE EXISTS (SELECT 1 FROM firms WHERE id = ?2)`,
        )
        .bind(newId(), firm, now, END_OF_TIME),
    ],
  ];
}

/** The firm's exports, newest first. */
export async function listFirmExports(db: RecordDb, firm: FirmId): Promise<FirmExport[]> {
  const { results } = await db.d1
    .prepare(`SELECT ${EXPORT_COLUMNS} FROM firm_exports WHERE firm_id = ? ORDER BY asked_at DESC, rowid DESC`)
    .bind(firm)
    .all<ExportRow>();
  return results.map(exportFromRow);
}

/** The firm's oldest export still to make, if any. */
export async function exportToMake(db: RecordDb, firm: FirmId): Promise<FirmExportId | null> {
  const row = await db.d1
    .prepare(`SELECT id FROM firm_exports WHERE firm_id = ? AND state = 'asked' ORDER BY asked_at, rowid LIMIT 1`)
    .bind(firm)
    .first<{ id: string }>();
  return row === null ? null : (row.id as FirmExportId);
}

/**
 * One page of one of the firm's tables, for its export, in the order the
 * rows were written: up to `limit` rows after the row numbered `after`, as
 * an export gives them. The table must be one EXPORTED_TABLES names.
 */
export async function firmTablePage(
  db: RecordDb,
  firm: FirmId,
  table: ExportedTable,
  after: number,
  limit = 500,
): Promise<{ rows: Record<string, unknown>[]; last: number | null }> {
  if (!(EXPORTED_TABLES as readonly string[]).includes(table)) {
    throw new Refused();
  }
  const column = table === 'firms' ? 'id' : 'firm_id';
  // The table name comes from the fixed list above, never from a caller.
  const { results } = await db.d1
    .prepare(`SELECT rowid AS row_number, * FROM ${table} WHERE ${column} = ? AND rowid > ? ORDER BY rowid LIMIT ?`)
    .bind(firm, after, Math.max(1, Math.min(limit, 1_000)))
    .all<Record<string, unknown> & { row_number: number }>();
  const last = results.at(-1)?.row_number ?? null;
  return {
    rows: results.map((found) => {
      const row: Record<string, unknown> = { ...found };
      delete row.row_number;
      return forExport(row);
    }),
    last,
  };
}

/**
 * Starts writing the file of one of the firm's exports. Nothing is in the
 * file store under its name until the writer finishes.
 */
export async function openFirmExportFile(db: RecordDb, firm: FirmId, id: FirmExportId): Promise<FileWriter> {
  const asked = await db.d1.prepare(`SELECT 1 AS yes FROM firm_exports WHERE firm_id = ? AND id = ? AND state = 'asked'`).bind(firm, id).first();
  if (asked === null) {
    throw new Refused();
  }
  return writeFile(db, firm, exportKey(firm, id));
}

/** Marks one of the firm's exports made, once its file is whole in the file store. */
export async function markFirmExportReady(db: RecordDb, firm: FirmId, id: FirmExportId, size: number): Promise<void> {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Refused();
  }
  const result = await run(
    db.d1
      .prepare(`UPDATE firm_exports SET state = 'ready', size = ?3, ready_at = ?4 WHERE firm_id = ?1 AND id = ?2 AND state = 'asked'`)
      .bind(firm, id, size, db.clock.now()),
  );
  if (result.meta.changes !== 1) {
    throw new Refused();
  }
}

/**
 * One of the firm's exports, to download, for a member of staff: the
 * download is recorded in the staff log first. Null when there is no such
 * export, or it is not made yet.
 */
export async function downloadFirmExport(
  db: RecordDb,
  firm: FirmId,
  id: FirmExportId,
  staff: StaffId,
): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null> {
  if (!isId(id)) {
    return null;
  }
  const ready = await db.d1.prepare(`SELECT 1 AS yes FROM firm_exports WHERE firm_id = ? AND id = ? AND state = 'ready'`).bind(firm, id).first();
  if (ready === null) {
    return null;
  }
  const [, logged] = staffLogStatement(db, firm, staff, 'downloaded_firm_export');
  await runTogether(db.d1, [
    logged,
    db.d1.prepare('UPDATE firm_exports SET downloaded_at = ?3 WHERE firm_id = ?1 AND id = ?2').bind(firm, id, db.clock.now()),
  ]);
  return readFile(db, firm, exportKey(firm, id));
}

/** A name as compared on a confirm page: spaces and capitals do not count. */
export function sameName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Marks the firm as leaving, by a member of staff who typed its name as it
 * is held. In one step: the stop button on, every service off (each in the
 * firm's history, by staff), every text still waiting cancelled, its export
 * asked for, and the row in the due list that deletes it at the end of its
 * 30 days. Refused for a firm already leaving, or the wrong name.
 */
export async function markLeaving(db: RecordDb, firm: FirmId, staff: StaffId, typedName: string): Promise<DueId> {
  const found = await getFirm(db, firm);
  if (found === null || found.leaving !== null || sameName(typedName) !== sameName(found.name)) {
    throw new Refused();
  }
  const now = db.clock.now();
  const by = { kind: 'staff', staff } as const;
  const deleteRow = newId() as DueId;
  const [, logged] = staffLogStatement(db, firm, staff, 'marked_leaving');
  const [, exportStatements] = askExportStatements(db, firm, staff);
  const results = await runTogether(db.d1, [
    logged,
    db.d1
      .prepare(
        `UPDATE firms SET left_at = ?2, left_by = ?3, stopped = 1,
                          calls_on = 0, quotes_on = 0, followups_on = 0, paperwork_on = 0, invoices_on = 0
         WHERE id = ?1 AND left_at IS NULL`,
      )
      .bind(firm, now, staff),
    ...(found.stopped ? [] : [firmEntry(db, firm, 'stop_on', by, null)]),
    ...SERVICES.filter((service) => found.services[service]).map((service) => firmEntry(db, firm, 'service_off', by, service)),
    db.d1
      .prepare(
        `UPDATE due SET state = 'cancelled', outcome = 'cancelled', finished_at = ?2
         WHERE firm_id = ?1 AND state = 'waiting'
           AND action IN ('alert_owner', 'send_reminder', 'send_confirmation', 'send_login_link')`,
      )
      .bind(firm, now),
    ...exportStatements,
    db.d1
      .prepare(
        `INSERT INTO due (id, firm_id, action, run_at, latest_at, state, created_at)
         VALUES (?, ?, 'delete_firm', ?, ?, 'waiting', ?)`,
      )
      .bind(deleteRow, firm, now + PERIODS.leaving, END_OF_TIME, now),
  ]);
  if (results[1]?.meta.changes !== 1) {
    // Marked leaving by someone else in the meantime: the unique row that
    // deletes the firm makes this cannot happen inside one step.
    throw new Refused();
  }
  return deleteRow;
}

/**
 * Cancels a firm's leaving, by a member of staff, while it is still there:
 * its delete is cancelled. Its services and stop button stay as they are,
 * for staff to set. Refused when the firm is not leaving, or its delete has
 * already started.
 */
export async function cancelLeaving(db: RecordDb, firm: FirmId, staff: StaffId): Promise<void> {
  const deleting = await db.d1
    .prepare(`SELECT 1 AS yes FROM due WHERE firm_id = ? AND action = 'delete_firm' AND state = 'claimed'`)
    .bind(firm)
    .first();
  if (deleting !== null) {
    throw new Refused();
  }
  const [, logged] = staffLogStatement(db, firm, staff, 'cancelled_leaving');
  const [changed] = await runTogether(db.d1, [
    db.d1.prepare('UPDATE firms SET left_at = NULL, left_by = NULL WHERE id = ? AND left_at IS NOT NULL').bind(firm),
    db.d1
      .prepare(
        `UPDATE due SET state = 'cancelled', outcome = 'cancelled', finished_at = ?2
         WHERE firm_id = ?1 AND action = 'delete_firm' AND state = 'waiting'
           AND EXISTS (SELECT 1 FROM firms WHERE id = ?1 AND left_at IS NULL)`,
      )
      .bind(firm, db.clock.now()),
  ]);
  if (changed?.meta.changes !== 1) {
    throw new Refused();
  }
  await run(logged);
}

/**
 * Deletes a leaving firm before its 30 days are up, by a member of staff who
 * typed its name as it is held, once its export is made. Refused otherwise:
 * a firm that is not leaving, the wrong name, or no export made.
 */
export async function deleteFirm(db: RecordDb, firm: FirmId, staff: StaffId, typedName: string): Promise<void> {
  const found = await getFirm(db, firm);
  if (found?.leaving == null || sameName(typedName) !== sameName(found.name)) {
    throw new Refused();
  }
  const made = await db.d1.prepare(`SELECT 1 AS yes FROM firm_exports WHERE firm_id = ? AND state = 'ready'`).bind(firm).first();
  if (made === null) {
    throw new Refused();
  }
  await eraseFirm(db, firm, { by: 'staff', staff, what: 'deleted_firm' });
}

/**
 * Deletes a leaving firm at the end of its 30 days, by the clock, whether or
 * not its export was downloaded. Gives nothing_to_do when the firm is gone,
 * or no longer leaving.
 */
export async function deleteLeftFirm(db: RecordDb, firm: FirmId): Promise<'deleted' | 'nothing_to_do'> {
  const found = await getFirm(db, firm);
  if (found?.leaving == null) {
    return 'nothing_to_do';
  }
  await eraseFirm(db, firm, { by: 'clock' });
  return 'deleted';
}

/**
 * Deletes a firm again after the database was restored to a point before it
 * was deleted, as staff asked for it before (docs/restore.md). A firm that
 * was not leaving at that point is marked leaving, by the member of staff
 * doing it, in the same step as its delete.
 */
export async function redoFirmDelete(db: RecordDb, firm: FirmId, staff: StaffId): Promise<'deleted' | 'nothing_to_do'> {
  const found = await getFirm(db, firm);
  if (found === null) {
    return 'nothing_to_do';
  }
  await eraseFirm(db, firm, { by: 'staff', staff, what: 'replayed_deletions' });
  return 'deleted';
}

type EraseBy = { by: 'clock' } | { by: 'staff'; staff: StaffId; what: 'deleted_firm' | 'replayed_deletions' };

/**
 * The delete of a firm. The database and the file stores cannot change in
 * one step, so:
 * 1. it is noted in the restore ledger, so it can be done again after a
 *    restore (docs/restore.md)
 * 2. every file under the firm's path goes, from both stores
 * 3. in one step: who did it, every row of the firm's, the firm itself, and
 *    the list of deleted firms
 * Stopping halfway leaves the firm leaving, with its delete row to run
 * again: the files left are found and deleted, and nothing new comes for a
 * firm that is leaving.
 */
async function eraseFirm(db: RecordDb, firm: FirmId, who: EraseBy): Promise<void> {
  // A delete done again after a restore is in the ledger already.
  if (who.by === 'clock' || who.what !== 'replayed_deletions') {
    await noteDeletion(db, { kind: 'firm', firm });
  }
  await deleteAllFiles(db, firm, 'kept');
  await deleteAllFiles(db, firm, 'inbox');
  const now = db.clock.now();
  const staff = who.by === 'staff' ? who.staff : null;
  const logged = who.by === 'staff' ? [staffLogStatement(db, firm, who.staff, who.what)[1]] : [];
  const results = await runTogether(db.d1, [
    ...logged,
    // Done again after a restore, a firm that was not yet leaving is marked
    // leaving first, so the delete's own checks still hold.
    ...(who.by === 'staff' && who.what === 'replayed_deletions'
      ? [db.d1.prepare('UPDATE firms SET left_at = ?2, left_by = ?3 WHERE id = ?1 AND left_at IS NULL').bind(firm, now, who.staff)]
      : []),
    db.d1
      .prepare(
        `INSERT INTO deleted_firms (firm_id, left_at, deleted_at, by, staff_id)
         SELECT id, left_at, ?2, ?3, ?4 FROM firms WHERE id = ?1 AND left_at IS NOT NULL
         ON CONFLICT DO NOTHING`,
      )
      .bind(firm, now, who.by, staff),
    ...eraseFirmStatements(db, firm, 'leaving'),
  ]);
  if (results.at(-1)?.meta.changes !== 1) {
    throw new Refused();
  }
}

/** When each firm deleted so far went, and how. Ids only. */
export async function wasFirmDeleted(db: RecordDb, firm: FirmId): Promise<{ deletedAt: Instant; by: 'staff' | 'clock' } | null> {
  const row = await db.d1
    .prepare('SELECT deleted_at, by FROM deleted_firms WHERE firm_id = ?')
    .bind(firm)
    .first<{ deleted_at: number; by: 'staff' | 'clock' }>();
  return row === null ? null : { deletedAt: instant(row.deleted_at), by: row.by };
}

const EXPORT_COLUMNS = 'id, state, size, asked_at, ready_at, downloaded_at';

interface ExportRow {
  id: string;
  state: 'asked' | 'ready';
  size: number | null;
  asked_at: number;
  ready_at: number | null;
  downloaded_at: number | null;
}

function exportFromRow(row: ExportRow): FirmExport {
  return {
    id: row.id as FirmExportId,
    state: row.state,
    size: row.size,
    askedAt: instant(row.asked_at),
    readyAt: row.ready_at === null ? null : instant(row.ready_at),
    downloadedAt: row.downloaded_at === null ? null : instant(row.downloaded_at),
  };
}

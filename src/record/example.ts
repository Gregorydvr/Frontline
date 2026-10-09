// The demo firm in the control room, on practice and this machine only
// (slice G of docs/build-brief.md): moving its clock on, and deleting it so
// it can be loaded fresh. Both are refused for a firm that is not an example,
// here and by the database itself. Keeping them off live is the control
// room's job (src/control-room.ts); a real firm is never an example.

import { instant, type Instant } from '../clock';
import { Refused, runTogether, type RecordDb } from './db';
import { eraseFirmStatements } from './erase';
import { deleteAllFiles } from './files';
import { staffLogStatement } from './staff';
import type { FirmId, StaffId } from './types';

/**
 * Sets an example firm's clock to read `to` now, and records who did it.
 * Moving on only goes forward. Starting it, as a reset does, may set any
 * time, such as the example's "today". Refused for a firm that is not an
 * example.
 */
export async function setExampleClock(
  db: RecordDb,
  firm: FirmId,
  to: Instant,
  staff: StaffId,
  how: 'move_on' | 'start',
): Promise<void> {
  // The firm's clock is the real time plus how far ahead it runs.
  const real = db.realClock.now();
  const ahead = instant(to) - real;
  const before = await db.d1.prepare('SELECT clock_ahead FROM firms WHERE id = ? AND is_example = 1').bind(firm).first<{ clock_ahead: number }>();
  if (before === null || (how === 'move_on' && ahead <= before.clock_ahead)) {
    throw new Refused();
  }
  const [, logged] = staffLogStatement(db, firm, staff, how === 'move_on' ? 'moved_clock' : 'loaded_example');
  // The database refuses a clock moved on a firm that is not an example.
  await runTogether(db.d1, [db.d1.prepare('UPDATE firms SET clock_ahead = ?2 WHERE id = ?1').bind(firm, ahead), logged]);
}

export { FIRM_TABLES } from './erase';

/**
 * Deletes an example firm and everything in it, so the example can be loaded
 * fresh: its rows in one step, and any files it has. Refused for a firm that
 * is not an example, and nothing is deleted. The staff log keeps who did it.
 */
export async function deleteExampleFirm(db: RecordDb, firm: FirmId, staff: StaffId): Promise<void> {
  const isExample = await db.d1.prepare('SELECT 1 AS yes FROM firms WHERE id = ? AND is_example = 1').bind(firm).first<{ yes: number }>();
  if (isExample === null) {
    throw new Refused();
  }
  // The demo firm's files, such as a recording of a call played on this
  // machine. Without a file store, as in most tests, it has none.
  if (db.files !== null) {
    await deleteAllFiles(db, firm, 'kept');
    await deleteAllFiles(db, firm, 'inbox');
  }
  const [, logged] = staffLogStatement(db, firm, staff, 'reset_example');
  await runTogether(db.d1, [logged, ...eraseFirmStatements(db, firm, 'example')]);
}

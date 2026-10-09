// What every record function is given: the database, the file stores and
// the clock. Only the files in src/record/ talk to the database (rule 8 in
// CLAUDE.md), and only src/record/files.ts to the file stores; lint enforces
// both.

import { aheadBy, type Clock } from '../clock';
import type { FileStores } from './files';

export interface RecordDb {
  readonly d1: D1Database;
  /**
   * The file stores: the one that keeps recordings and exports, and the
   * inbox Vapi writes recordings into. Null where nothing needs them, such
   * as most tests; a record function that needs them refuses without.
   */
  readonly files: FileStores | null;
  /** The time as the firm being worked for reads it: the real time, or an example firm's own (withFirmClock()). */
  readonly clock: Clock;
  /** The system's own clock, under any firm's. */
  readonly realClock: Clock;
}

export function openRecord(d1: D1Database, clock: Clock, files: FileStores | null = null): RecordDb {
  return { d1, files, clock, realClock: clock };
}

/**
 * The record as one firm reads the time: the real time, moved on by the
 * firm's own clock. Only an example firm's clock is ever moved (slice G), so
 * for every real firm this is the real time.
 */
export function withFirmClock(db: RecordDb, firm: { clockAhead: number }): RecordDb {
  return { d1: db.d1, files: db.files, realClock: db.realClock, clock: aheadBy(db.realClock, firm.clockAhead) };
}

/**
 * The record will not do what was asked: usually because something named
 * belongs to another firm or does not exist. It carries no details, so it is
 * safe to log.
 */
export class Refused extends Error {
  override name = 'Refused';
  constructor() {
    super('Refused by the record');
  }
}

/** Runs one statement. A broken rule in the database, such as a link to another firm's row, becomes a refusal. */
export async function run(statement: D1PreparedStatement): Promise<D1Result> {
  try {
    return await statement.run();
  } catch (thrown) {
    throw refusalOr(thrown);
  }
}

/** Runs statements as one step: all of them or none. */
export async function runTogether(d1: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  try {
    return await d1.batch(statements);
  } catch (thrown) {
    throw refusalOr(thrown);
  }
}

function refusalOr(thrown: unknown): unknown {
  return thrown instanceof Error && /constraint failed|SQLITE_CONSTRAINT/.test(thrown.message)
    ? new Refused()
    : thrown;
}

/** SQLite holds true and false as 1 and 0. */
export function bit(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

/** Refuses a name or description that is empty. */
export function words(value: string): string {
  if (value.trim() === '') {
    throw new Refused();
  }
  return value;
}

/** Refuses text that is empty, longer than `longest`, or more than one line. */
export function line(value: string, longest: number): string {
  // Control characters include line breaks and tabs.
  if (words(value).length > longest || /\p{Cc}/u.test(value)) {
    throw new Refused();
  }
  return value;
}

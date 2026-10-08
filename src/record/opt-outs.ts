// Opt-outs: held for each customer and each kind of text, or for every kind.
// send() checks them before every text to a customer (rule 3 in CLAUDE.md).
// Each change records who made it, in the same step.

import { isUkMobile, type UkMobile } from '../phone';
import { Refused, run, runTogether, type RecordDb } from './db';
import { optOutEntry } from './history';
import { MESSAGE_KINDS, type Actor, type CustomerId, type FirmId, type OptOutKind } from './types';

/** Opts one of the firm's customers out of a kind of text, or every kind, and records who did it. */
export async function optOut(
  db: RecordDb,
  firm: FirmId,
  customer: CustomerId,
  kind: OptOutKind,
  by: Actor,
): Promise<void> {
  checkKind(kind);
  // The customer must be this firm's: the opt-out's link refuses another
  // firm's, and the history entry with it.
  await runTogether(db.d1, [
    db.d1
      .prepare('INSERT OR IGNORE INTO opt_outs (firm_id, customer_id, kind, at) VALUES (?, ?, ?, ?)')
      .bind(firm, customer, kind, db.clock.now()),
    optOutEntry(db, firm, 'opted_out', by, { customer, job: null }, kind),
  ]);
}

/**
 * Opts one of the firm's customers back in to a kind of text, and records who
 * did it. Opting back in to every kind clears all of their opt-outs.
 */
export async function optIn(
  db: RecordDb,
  firm: FirmId,
  customer: CustomerId,
  kind: OptOutKind,
  by: Actor,
): Promise<void> {
  checkKind(kind);
  await runTogether(db.d1, [
    db.d1
      .prepare("DELETE FROM opt_outs WHERE firm_id = ?1 AND customer_id = ?2 AND (kind = ?3 OR ?3 = 'every')")
      .bind(firm, customer, kind),
    optOutEntry(db, firm, 'opted_in', by, { customer, job: null }, kind),
  ]);
}

/** What one of the firm's customers has opted out of. */
export async function listOptOuts(db: RecordDb, firm: FirmId, customer: CustomerId): Promise<OptOutKind[]> {
  const { results } = await db.d1
    .prepare('SELECT kind FROM opt_outs WHERE firm_id = ? AND customer_id = ? ORDER BY kind')
    .bind(firm, customer)
    .all<{ kind: OptOutKind }>();
  return results.map((row) => row.kind);
}

/**
 * Opts a mobile out of every text from the firm, whichever customer the text
 * is for, such as when the provider says the number unsubscribed with it. A
 * STOP texted to the firm does this too, in the same step as the text
 * (recordTextIn()).
 */
export async function optOutNumber(db: RecordDb, firm: FirmId, mobile: UkMobile): Promise<void> {
  if (!isUkMobile(mobile)) {
    throw new Refused();
  }
  await run(
    db.d1
      .prepare('INSERT OR IGNORE INTO opted_out_numbers (firm_id, mobile, at) VALUES (?, ?, ?)')
      .bind(firm, mobile, db.clock.now()),
  );
}

/** Whether a mobile is opted out of every text from the firm. */
export async function isNumberOptedOut(db: RecordDb, firm: FirmId, mobile: UkMobile): Promise<boolean> {
  if (!isUkMobile(mobile)) {
    throw new Refused();
  }
  const row = await db.d1
    .prepare('SELECT 1 AS yes FROM opted_out_numbers WHERE firm_id = ? AND mobile = ?')
    .bind(firm, mobile)
    .first<{ yes: number }>();
  return row !== null;
}

function checkKind(kind: OptOutKind): void {
  // A kind of text to customers: the type says so, and this checks it, since
  // types can be got round.
  const known = kind === 'every' || (Object.hasOwn(MESSAGE_KINDS, kind) && (MESSAGE_KINDS[kind].to as string) === 'customer');
  if (!known) {
    throw new Refused();
  }
}

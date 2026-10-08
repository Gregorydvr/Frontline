// Opt-outs: held for each customer and each kind of text, or for every kind.
// send() checks them before every text to a customer (rule 3 in CLAUDE.md).
// Each change records who made it, in the same step.

import { Refused, runTogether, type RecordDb } from './db';
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

function checkKind(kind: OptOutKind): void {
  // A kind of text to customers: the type says so, and this checks it, since
  // types can be got round.
  const known = kind === 'every' || (Object.hasOwn(MESSAGE_KINDS, kind) && (MESSAGE_KINDS[kind].to as string) === 'customer');
  if (!known) {
    throw new Refused();
  }
}

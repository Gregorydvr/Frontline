// Asking a provider to make something for a firm at set-up (task 3 of queue 2
// in docs/autopilot.md): its number bought in Twilio, its voice agent made in
// Vapi. Each request is written before the provider is asked, with a row in
// the staff log naming who asked, so the same thing is never made twice for
// a firm: while one request is asked, done or unclear, the database refuses
// another (migration 0013). Only one that clearly failed can be asked again.
// The staff log keeps every press, whether or not it was the one that asked.

import { instant } from '../clock';
import { isId, newId } from '../ids';
import { Refused, runTogether, type RecordDb } from './db';
import { staffLogStatement } from './staff';
import { PROVISIONS, type FirmId, type Provision, type Provisioning, type ProvisioningId, type ProvisionState, type StaffId } from './types';

const STAFF_ACTION = { number: 'asked_for_number', agent: 'asked_for_agent' } as const satisfies Record<Provision, string>;

/**
 * Writes that a member of staff asked for the firm's number or agent to be
 * made, before the provider is asked. Null, with nothing written, when one
 * is already asked, made, or not clearly either.
 */
export async function askProvisioning(db: RecordDb, firm: FirmId, what: Provision, staff: StaffId): Promise<ProvisioningId | null> {
  if (!PROVISIONS.includes(what) || !isId(staff)) throw new Refused();
  const id = newId() as ProvisioningId;
  const now = db.clock.now();
  // The firm must be there, and nothing may be waiting or made already. The
  // index in migration 0013 holds to the second even with two at once.
  const results = await runTogether(db.d1, [
    db.d1
      .prepare(
        `INSERT INTO provisioning (id, firm_id, what, state, asked_at, finished_at, made)
         SELECT ?1, ?2, ?3, 'asked', ?4, NULL, NULL
         WHERE EXISTS (SELECT 1 FROM firms WHERE id = ?2)
           AND NOT EXISTS (SELECT 1 FROM provisioning WHERE firm_id = ?2 AND what = ?3 AND state <> 'failed')`,
      )
      .bind(id, firm, what, now),
    // The staff log keeps every press, even one that found a request already made.
    staffLogStatement(db, firm, staff, STAFF_ACTION[what])[1],
  ]);
  return results[0]?.meta.changes === 1 ? id : null;
}

/** Writes how a request ended: made, with what was made; clearly not made; or not clear. Only once. */
export async function finishProvisioning(
  db: RecordDb,
  firm: FirmId,
  id: ProvisioningId,
  ended: { state: 'done'; made: string } | { state: 'failed' | 'unclear' },
): Promise<void> {
  if (!isId(id) || !['done', 'failed', 'unclear'].includes(ended.state)) throw new Refused();
  const made = ended.state === 'done' ? ended.made : null;
  if (made !== null && !/^[0-9a-z+-]{1,60}$/.test(made)) throw new Refused();
  const { meta } = await db.d1
    .prepare("UPDATE provisioning SET state = ?1, made = ?2, finished_at = ?3 WHERE id = ?4 AND firm_id = ?5 AND state = 'asked'")
    .bind(ended.state, made, db.clock.now(), id, firm)
    .run();
  if (meta.changes !== 1) throw new Refused();
}

/** Every request made for the firm, newest first. */
export async function listProvisioning(db: RecordDb, firm: FirmId): Promise<Provisioning[]> {
  const { results } = await db.d1
    .prepare('SELECT id, what, state, asked_at, finished_at, made FROM provisioning WHERE firm_id = ? ORDER BY asked_at DESC, rowid DESC')
    .bind(firm)
    .all<{ id: string; what: Provision; state: ProvisionState; asked_at: number; finished_at: number | null; made: string | null }>();
  return results.map((row) => ({
    id: row.id as ProvisioningId,
    what: row.what,
    state: row.state,
    askedAt: instant(row.asked_at),
    finishedAt: row.finished_at === null ? null : instant(row.finished_at),
    made: row.made,
  }));
}

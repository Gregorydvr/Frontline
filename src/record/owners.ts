// The owner: the person at a firm who approves things and uses the app. Their
// mobile is for alerts and, from slice F, the login link.

import { instant } from '../clock';
import { newId } from '../ids';
import { isUkMobile, type UkMobile } from '../phone';
import { NAME_LIMITS, nameProblems } from '../set-up';
import { Refused, runTogether, type RecordDb } from './db';
import { firmEntry } from './history';
import { staffLogStatement } from './staff';
import type { Actor, FirmId, Owner, OwnerId } from './types';

const frontline = { kind: 'frontline' } as const;

/**
 * Adds one of the firm's owners, and records who did it: the history entry
 * owner_added and, for a member of staff, the staff log, in the same step.
 * Their name fills {owner} in texts, so a text must be able to carry it.
 * Their mobile cannot be the firm's own number, which the texts come from.
 */
export async function createOwner(
  db: RecordDb,
  firm: FirmId,
  input: { name: string; mobile?: UkMobile | null },
  by: Actor = frontline,
): Promise<OwnerId> {
  const id = newId() as OwnerId;
  const mobile = input.mobile ?? null;
  if (
    (mobile !== null && !isUkMobile(mobile)) ||
    nameProblems(input.name, NAME_LIMITS.owner).length > 0 ||
    by.kind === 'customer' ||
    (mobile !== null && (await isFirmsNumber(db, firm, mobile)))
  ) {
    throw new Refused();
  }
  const results = await runTogether(db.d1, [
    db.d1
      .prepare('INSERT INTO owners (id, firm_id, name, mobile, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, firm, input.name, mobile, db.clock.now()),
    firmEntry(db, firm, 'owner_added', by, null),
    ...(by.kind === 'staff' ? [staffLogStatement(db, firm, by.staff, 'added_owner', { owner: id })[1]] : []),
  ]);
  if (results.some((result) => result.meta.changes !== 1)) {
    throw new Refused();
  }
  return id;
}

/**
 * Sets or clears the owner's mobile, and records who did it. Another firm's
 * owner is refused, and so is the firm's own number.
 *
 * In the same step, everything that would let the old mobile in ends: every
 * login the owner has, every login link not yet used, and any login text
 * still waiting to go. Whoever holds the old phone, lost or passed on, can
 * neither stay logged in nor use a link already sent to it. The owner logs
 * in again with a link sent to the new mobile.
 */
export async function setOwnerMobile(
  db: RecordDb,
  firm: FirmId,
  owner: OwnerId,
  mobile: UkMobile | null,
  by: Actor,
): Promise<void> {
  if (
    (mobile !== null && !isUkMobile(mobile)) ||
    (await getOwner(db, firm, owner)) === null ||
    (mobile !== null && (await isFirmsNumber(db, firm, mobile)))
  ) {
    throw new Refused();
  }
  const now = db.clock.now();
  const [changed, entry, ...rest] = await runTogether(db.d1, [
    db.d1.prepare('UPDATE owners SET mobile = ?3 WHERE firm_id = ?1 AND id = ?2').bind(firm, owner, mobile),
    firmEntry(db, firm, 'owner_mobile_set', by, null),
    db.d1
      .prepare('UPDATE sessions SET ended_at = ?3 WHERE firm_id = ?1 AND owner_id = ?2 AND ended_at IS NULL')
      .bind(firm, owner, now),
    db.d1
      .prepare(
        `UPDATE due SET state = 'cancelled', outcome = 'cancelled', finished_at = ?3
         WHERE firm_id = ?1 AND state = 'waiting' AND action = 'send_login_link'
           AND id IN (SELECT due_id FROM login_links WHERE firm_id = ?1 AND owner_id = ?2 AND used_at IS NULL)`,
      )
      .bind(firm, owner, now),
    db.d1.prepare('DELETE FROM login_links WHERE firm_id = ?1 AND owner_id = ?2 AND used_at IS NULL').bind(firm, owner),
    ...(by.kind === 'staff' ? [staffLogStatement(db, firm, by.staff, 'changed_owner_mobile', { owner })[1]] : []),
  ]);
  const logged = by.kind === 'staff' ? rest[rest.length - 1] : undefined;
  if (changed?.meta.changes !== 1 || entry?.meta.changes !== 1 || (logged !== undefined && logged.meta.changes !== 1)) {
    throw new Refused();
  }
}

/** Whether a mobile is the firm's own number, which its texts come from. */
async function isFirmsNumber(db: RecordDb, firm: FirmId, mobile: UkMobile): Promise<boolean> {
  const row = await db.d1.prepare('SELECT 1 AS yes FROM firms WHERE id = ? AND phone_number = ?').bind(firm, mobile).first<{ yes: number }>();
  return row !== null;
}

export async function getOwner(db: RecordDb, firm: FirmId, owner: OwnerId): Promise<Owner | null> {
  const row = await db.d1
    .prepare(`${SELECT_OWNER} WHERE firm_id = ? AND id = ?`)
    .bind(firm, owner)
    .first<OwnerRow>();
  return row === null ? null : fromRow(row);
}

export async function listOwners(db: RecordDb, firm: FirmId): Promise<Owner[]> {
  const { results } = await db.d1
    .prepare(`${SELECT_OWNER} WHERE firm_id = ? ORDER BY created_at, id`)
    .bind(firm)
    .all<OwnerRow>();
  return results.map(fromRow);
}

const SELECT_OWNER = 'SELECT id, name, mobile, created_at FROM owners';

interface OwnerRow {
  id: string;
  name: string;
  mobile: string | null;
  created_at: number;
}

function fromRow(row: OwnerRow): Owner {
  return {
    id: row.id as OwnerId,
    name: row.name,
    mobile: row.mobile as UkMobile | null,
    createdAt: instant(row.created_at),
  };
}

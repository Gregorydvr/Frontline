// The owner: the person at a firm who approves things and uses the app. Their
// mobile is for alerts and, from slice F, the login link.

import { instant } from '../clock';
import { newId } from '../ids';
import { isUkMobile, type UkMobile } from '../phone';
import { Refused, run, runTogether, words, type RecordDb } from './db';
import { firmEntry } from './history';
import type { Actor, FirmId, Owner, OwnerId } from './types';

export async function createOwner(
  db: RecordDb,
  firm: FirmId,
  input: { name: string; mobile?: UkMobile | null },
): Promise<OwnerId> {
  const id = newId() as OwnerId;
  const mobile = input.mobile ?? null;
  if (mobile !== null && !isUkMobile(mobile)) {
    throw new Refused();
  }
  await run(
    db.d1
      .prepare('INSERT INTO owners (id, firm_id, name, mobile, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, firm, words(input.name), mobile, db.clock.now()),
  );
  return id;
}

/** Sets or clears the owner's mobile, and records who did it. Another firm's owner is refused. */
export async function setOwnerMobile(
  db: RecordDb,
  firm: FirmId,
  owner: OwnerId,
  mobile: UkMobile | null,
  by: Actor,
): Promise<void> {
  if ((mobile !== null && !isUkMobile(mobile)) || (await getOwner(db, firm, owner)) === null) {
    throw new Refused();
  }
  await runTogether(db.d1, [
    db.d1.prepare('UPDATE owners SET mobile = ? WHERE firm_id = ? AND id = ?').bind(mobile, firm, owner),
    firmEntry(db, firm, 'owner_mobile_set', by, null),
  ]);
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

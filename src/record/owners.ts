// The owner: the person at a firm who approves things and uses the app.

import { instant } from '../clock';
import { newId } from '../ids';
import { run, words, type RecordDb } from './db';
import type { FirmId, Owner, OwnerId } from './types';

export async function createOwner(db: RecordDb, firm: FirmId, input: { name: string }): Promise<OwnerId> {
  const id = newId() as OwnerId;
  await run(
    db.d1
      .prepare('INSERT INTO owners (id, firm_id, name, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, firm, words(input.name), db.clock.now()),
  );
  return id;
}

export async function getOwner(db: RecordDb, firm: FirmId, owner: OwnerId): Promise<Owner | null> {
  const row = await db.d1
    .prepare('SELECT id, name, created_at FROM owners WHERE firm_id = ? AND id = ?')
    .bind(firm, owner)
    .first<OwnerRow>();
  return row === null ? null : fromRow(row);
}

export async function listOwners(db: RecordDb, firm: FirmId): Promise<Owner[]> {
  const { results } = await db.d1
    .prepare('SELECT id, name, created_at FROM owners WHERE firm_id = ? ORDER BY created_at, id')
    .bind(firm)
    .all<OwnerRow>();
  return results.map(fromRow);
}

interface OwnerRow {
  id: string;
  name: string;
  created_at: number;
}

function fromRow(row: OwnerRow): Owner {
  return { id: row.id as OwnerId, name: row.name, createdAt: instant(row.created_at) };
}

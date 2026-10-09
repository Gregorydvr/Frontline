// Each firm's own words: the wording agreed at set-up for each kind of text
// (rule 2 in CLAUDE.md), and the firm's own versions of the owner's lines.
// Every change is a new row, never an edit, so who set which words and when
// is kept. The words in use are the newest for each key.
//
// The words for a text name the owner who agreed those exact words, how and
// when; the database refuses them otherwise, and refuses an owner of
// another firm (migration 0010).

import { instant } from '../clock';
import { newId } from '../ids';
import { wordingProblems } from '../set-up';
import { Refused, runTogether, type RecordDb } from './db';
import { actorColumns, firmEntry } from './history';
import { staffLogStatement } from './staff';
import {
  AGREED_HOW,
  type Actor,
  type AgreedHow,
  type Agreement,
  type FirmId,
  type FirmWording,
  type MessageKind,
  type OwnerId,
  type StaffId,
  type WordingId,
  type WordingKey,
  type WordingVersion,
} from './types';

/**
 * Sets the firm's words for one key, and records who did it. Refused when
 * the words have any of the problems wordingProblems() finds: a key that is
 * not one of the lists, a gap the key does not have, or, for a text, a
 * character a text cannot carry (rule 4), or no {link} where it must have
 * one. The words for a text must say which of the firm's owners agreed them
 * and how; they are recorded as agreed now, with the history entry
 * wording_agreed and, for a member of staff, the staff log, in the same
 * step. A customer cannot set wording.
 */
export async function setWording(
  db: RecordDb,
  firm: FirmId,
  key: WordingKey,
  words: string,
  by: Actor,
  agreed: Agreement | null,
): Promise<WordingId> {
  if (wordingProblems(key, words).length > 0 || by.kind === 'customer') {
    throw new Refused();
  }
  const forText = key.startsWith('text:');
  if (forText !== (agreed !== null) || (agreed !== null && !AGREED_HOW.includes(agreed.how))) {
    throw new Refused();
  }
  const id = newId() as WordingId;
  const now = db.clock.now();
  const [actor, owner, staff] = actorColumns(by);
  const statements = [
    db.d1
      .prepare(
        `INSERT INTO wording (id, firm_id, key, words, at, seq, actor, owner_id, staff_id, agreed_owner_id, agreed_at, agreed_how)
         VALUES (?1, ?2, ?3, ?4, ?5, (SELECT IFNULL(MAX(seq), 0) + 1 FROM wording), ?6, ?7, ?8, ?9, ?10, ?11)`,
      )
      .bind(id, firm, key, words, now, actor, owner, staff, agreed?.owner ?? null, agreed === null ? null : now, agreed?.how ?? null),
  ];
  if (forText) {
    statements.push(firmEntry(db, firm, 'wording_agreed', by, null));
    if (by.kind === 'staff') {
      statements.push(staffLogStatement(db, firm, by.staff, 'agreed_wording', { messageKind: key.slice('text:'.length) as MessageKind })[1]);
    }
  }
  const written = await runTogether(db.d1, statements);
  if (written.some((result) => result.meta.changes !== 1)) {
    throw new Refused();
  }
  return id;
}

/** The firm's words in use: the newest for each key it has set. */
export async function firmWording(db: RecordDb, firm: FirmId): Promise<FirmWording> {
  const { results } = await db.d1
    .prepare(
      `SELECT w.id, w.key, w.words FROM wording w
       WHERE w.firm_id = ?1
         AND w.seq = (SELECT MAX(n.seq) FROM wording n WHERE n.firm_id = ?1 AND n.key = w.key)
       ORDER BY w.key`,
    )
    .bind(firm)
    .all<{ id: string; key: WordingKey; words: string }>();
  return Object.fromEntries(results.map((row) => [row.key, { id: row.id as WordingId, words: row.words }]));
}

/**
 * Every version of the firm's words for one key, newest first: the words,
 * who recorded them and when, and, for a text, the owner who agreed them,
 * how and when. Nothing for another firm's.
 */
export async function listWording(db: RecordDb, firm: FirmId, key: WordingKey): Promise<WordingVersion[]> {
  const { results } = await db.d1
    .prepare(
      `SELECT w.id, w.words, w.at, w.actor, w.owner_id, w.staff_id, s.email AS staff_email,
              w.agreed_owner_id, o.name AS agreed_name, w.agreed_at, w.agreed_how
       FROM wording w
       LEFT JOIN owners o ON o.firm_id = w.firm_id AND o.id = w.agreed_owner_id
       LEFT JOIN staff s ON s.id = w.staff_id
       WHERE w.firm_id = ?1 AND w.key = ?2
       ORDER BY w.seq DESC`,
    )
    .bind(firm, key)
    .all<{
      id: string;
      words: string;
      at: number;
      actor: 'frontline' | 'owner' | 'staff';
      owner_id: string | null;
      staff_id: string | null;
      staff_email: string | null;
      agreed_owner_id: string | null;
      agreed_name: string | null;
      agreed_at: number | null;
      agreed_how: string | null;
    }>();
  return results.map((row) => ({
    id: row.id as WordingId,
    words: row.words,
    at: instant(row.at),
    by: actorOf(row.actor, row.owner_id, row.staff_id),
    staffEmail: row.staff_email,
    agreed:
      row.agreed_owner_id === null || row.agreed_name === null || row.agreed_at === null || row.agreed_how === null
        ? null
        : {
            owner: { id: row.agreed_owner_id as OwnerId, name: row.agreed_name },
            how: row.agreed_how as AgreedHow,
            at: instant(row.agreed_at),
          },
  }));
}

function actorOf(actor: 'frontline' | 'owner' | 'staff', owner: string | null, staff: string | null): Actor {
  if (actor === 'owner' && owner !== null) return { kind: 'owner', owner: owner as OwnerId };
  if (actor === 'staff' && staff !== null) return { kind: 'staff', staff: staff as StaffId };
  return { kind: 'frontline' };
}

// Each firm's own words: the wording agreed at set-up for each kind of text
// (rule 2 in CLAUDE.md), and the firm's own versions of the owner's lines.
// Every change is a new row, never an edit, so who set which words and when
// is kept. The words in use are the newest for each key.

import { isGsm7 } from '../gsm';
import { newId } from '../ids';
import { Refused, run, type RecordDb } from './db';
import { actorColumns } from './history';
import {
  HISTORY_KINDS,
  LINE_GAPS,
  MESSAGE_KINDS,
  TEXT_LIMITS,
  type Actor,
  type FirmId,
  type FirmWording,
  type WordingId,
  type WordingKey,
} from './types';

/**
 * Sets the firm's words for one key, and records who did it. Refused when
 * the key is not one of the lists, when the words use a gap the key does not
 * have, or when the words for a text hold a character a text cannot carry
 * (rule 4). A customer cannot set wording.
 */
export async function setWording(
  db: RecordDb,
  firm: FirmId,
  key: WordingKey,
  words: string,
  by: Actor,
): Promise<WordingId> {
  checkWording(key, words);
  if (by.kind === 'customer') {
    throw new Refused();
  }
  const id = newId() as WordingId;
  const [actor, owner, staff] = actorColumns(by);
  await run(
    db.d1
      .prepare(
        `INSERT INTO wording (id, firm_id, key, words, at, seq, actor, owner_id, staff_id)
         VALUES (?1, ?2, ?3, ?4, ?5, (SELECT IFNULL(MAX(seq), 0) + 1 FROM wording), ?6, ?7, ?8)`,
      )
      .bind(id, firm, key, words, db.clock.now(), actor, owner, staff),
  );
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

/** The gaps in some words, such as "owner" in "Reminder: {owner}'s visit". */
export function gapsIn(words: string): string[] {
  return [...words.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? '');
}

function checkWording(key: WordingKey, words: string): void {
  if (typeof words !== 'string' || words.trim() === '' || words.length > TEXT_LIMITS.words || /[\r\t\v\f]/.test(words)) {
    throw new Refused();
  }
  const [type, name, form] = (key as string).split(':');
  let gaps: readonly string[];
  if (type === 'text' && name !== undefined && form === undefined && Object.hasOwn(MESSAGE_KINDS, name)) {
    // A text carries plain text characters only.
    if (!isGsm7(words)) {
      throw new Refused();
    }
    gaps = MESSAGE_KINDS[name as keyof typeof MESSAGE_KINDS].gaps;
  } else if (type === 'line' && name !== undefined && Object.hasOwn(HISTORY_KINDS, name) && (form === 'job' || form === 'feed')) {
    // An owner's line is one line.
    if (words.includes('\n')) {
      throw new Refused();
    }
    gaps = LINE_GAPS;
  } else {
    throw new Refused();
  }
  // Every brace must open or close a known gap.
  const braces = (words.match(/[{}]/g) ?? []).length;
  const found = gapsIn(words);
  if (braces !== found.length * 2 || !found.every((gap) => gaps.includes(gap))) {
    throw new Refused();
  }
}

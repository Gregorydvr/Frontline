// What an owner writes in Message us, for Front-line's staff (slice F of
// docs/build-brief.md). It is kept as written, never edited, with a history
// entry naming the owner, in the same step (rule 15 in CLAUDE.md). Staff see
// it in the control room (slice G).

import { newId } from '../ids';
import { Refused, runTogether, type RecordDb } from './db';
import { firmEntry } from './history';
import type { FirmId, OwnerId, OwnerMessageId } from './types';

/** The longest an owner's message may be. */
export const OWNER_MESSAGE_LIMIT = 2_000;

/** Keeps what one of the firm's owners wrote. Empty or too long is refused, as is another firm's owner. */
export async function recordOwnerMessage(db: RecordDb, firm: FirmId, owner: OwnerId, words: string): Promise<OwnerMessageId> {
  if (typeof words !== 'string' || words.trim() === '' || words.length > OWNER_MESSAGE_LIMIT) {
    throw new Refused();
  }
  const id = newId() as OwnerMessageId;
  await runTogether(db.d1, [
    db.d1
      .prepare('INSERT INTO owner_messages (id, firm_id, owner_id, words, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, firm, owner, words, db.clock.now()),
    firmEntry(db, firm, 'owner_message_sent', { kind: 'owner', owner }, null),
  ]);
  return id;
}

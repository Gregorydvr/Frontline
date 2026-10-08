// Texts sent, or claimed and not sent. A text is claimed before it goes by
// writing its row: its row in the due list and who it is to can be written
// only once, so the same text cannot go twice (rule 3 in CLAUDE.md). Only
// send() in src/send.ts writes here.
//
// A text only moves forward: sending, then sent, then delivered or failed.
// When it has gone, the history entry that says so is written in the same
// step, and is never edited (rule 15).

import { instant, type Instant } from '../clock';
import { isGsm7, segments as countSegments } from '../gsm';
import { newId } from '../ids';
import { isUkMobile, type UkMobile } from '../phone';
import { Refused, run, runTogether, type RecordDb } from './db';
import { historyStatement } from './history';
import {
  MESSAGE_KINDS,
  MESSAGE_REASONS,
  TEXT_LIMITS,
  TEXT_PROVIDERS,
  type CallId,
  type CustomerId,
  type DueId,
  type FirmId,
  type JobId,
  type Message,
  type MessageId,
  type MessageKind,
  type MessageReason,
  type MessageState,
  type NewHistory,
  type OwnerId,
  type Recipient,
  type TextProvider,
  type VisitId,
  type WordingId,
} from './types';

const frontline = { kind: 'frontline' } as const;

export interface NewMessage {
  due: DueId;
  kind: MessageKind;
  to: Recipient;
  about: { job: JobId | null; visit: VisitId | null; call: CallId | null };
  /** Set for a text that is going: its numbers, its words and the firm's wording they were made from. */
  going: { toNumber: UkMobile; fromNumber: UkMobile; words: string; wording: WordingId } | null;
  /** Set for a text that is not going, and why. */
  notSent: MessageReason | null;
}

/**
 * Claims a text: writes its row as sending, or as not sent with why. Refused
 * when the same row in the due list already has a text to this person, so a
 * second worker can never send it again. Who it is to, and what it is about,
 * must be this firm's.
 */
export async function claimMessage(db: RecordDb, firm: FirmId, input: NewMessage): Promise<MessageId> {
  const kind = MESSAGE_KINDS[input.kind];
  if (!Object.hasOwn(MESSAGE_KINDS, input.kind) || kind.to !== input.to.kind) {
    throw new Refused();
  }
  if ((input.going === null) === (input.notSent === null)) {
    throw new Refused();
  }
  if (input.notSent !== null && !MESSAGE_REASONS.includes(input.notSent)) {
    throw new Refused();
  }
  let segments: number | null = null;
  if (input.going !== null) {
    const { toNumber, fromNumber, words } = input.going;
    if (!isUkMobile(toNumber) || !isUkMobile(fromNumber) || words.length > TEXT_LIMITS.words || !isGsm7(words) || words.trim() === '') {
      throw new Refused();
    }
    segments = countSegments(words);
  }
  const customer: CustomerId | null = input.to.kind === 'customer' ? input.to.customer : null;
  const owner: OwnerId | null = input.to.kind === 'owner' ? input.to.owner : null;
  const state: MessageState = input.going === null ? 'not_sent' : 'sending';
  const id = newId() as MessageId;
  const now = db.clock.now();
  await run(
    db.d1
      .prepare(
        `INSERT INTO messages (id, firm_id, due_id, kind, customer_id, owner_id, recipient_id, job_id, visit_id,
                               call_id, to_number, from_number, words, wording_id, segments, state, reason,
                               created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)`,
      )
      .bind(
        id,
        firm,
        input.due,
        input.kind,
        customer,
        owner,
        customer ?? owner,
        input.about.job,
        input.about.visit,
        input.about.call,
        input.going?.toNumber ?? null,
        input.going?.fromNumber ?? null,
        input.going?.words ?? null,
        input.going?.wording ?? null,
        segments,
        state,
        input.notSent,
        now,
      ),
  );
  return id;
}

/**
 * Marks a claimed text as taken by the provider, with the provider's id for
 * it, and writes the history entry that says it went, in the same step: a
 * reminder sent, for a visit, or passed straight to the owner, for a job.
 */
export async function markMessageSent(
  db: RecordDb,
  firm: FirmId,
  message: MessageId,
  provider: TextProvider,
  providerId: string,
): Promise<void> {
  if (!TEXT_PROVIDERS.includes(provider) || typeof providerId !== 'string' || providerId === '' || providerId.length > TEXT_LIMITS.providerId) {
    throw new Refused();
  }
  const found = await getMessage(db, firm, message);
  if (found?.state !== 'sending') {
    throw new Refused();
  }
  const statements = [
    db.d1
      .prepare(
        `UPDATE messages SET state = 'sent', provider = ?3, provider_id = ?4, sent_at = ?5, updated_at = ?5
         WHERE firm_id = ?1 AND id = ?2 AND state = 'sending'`,
      )
      .bind(firm, message, provider, providerId, db.clock.now()),
  ];
  const entry = sentEntry(found);
  if (entry !== null) {
    statements.push(historyStatement(db, firm, entry)[1]);
  }
  const results = await runTogether(db.d1, statements);
  if (results.some((result) => result.meta.changes !== 1)) {
    // Cannot happen once the text was found above, short of the record
    // changing underneath. The text is marked, so it still cannot go twice.
    throw new Refused();
  }
}

/**
 * Marks a claimed text as failed, with why: the provider refused it, the
 * customer had unsubscribed with the provider, or it is not clear whether
 * the provider took it. It is never sent again.
 */
export async function markMessageFailed(
  db: RecordDb,
  firm: FirmId,
  message: MessageId,
  reason: 'refused' | 'unsubscribed' | 'unclear',
  errorCode: number | null,
): Promise<void> {
  if (!['refused', 'unsubscribed', 'unclear'].includes(reason) || (errorCode !== null && !Number.isSafeInteger(errorCode))) {
    throw new Refused();
  }
  const result = await run(
    db.d1
      .prepare(
        `UPDATE messages SET state = 'failed', reason = ?3, error_code = ?4, updated_at = ?5
         WHERE firm_id = ?1 AND id = ?2 AND state = 'sending'`,
      )
      .bind(firm, message, reason, errorCode, db.clock.now()),
  );
  if (result.meta.changes !== 1) {
    throw new Refused();
  }
}

/**
 * What the provider reported about one of the firm's texts, found by the
 * provider's id for it. A text only moves forward: a report that it was sent
 * changes nothing, and nothing changes one already delivered or failed.
 * Gives the text, or null when the firm has no such text.
 */
export async function recordDelivery(
  db: RecordDb,
  firm: FirmId,
  provider: TextProvider,
  providerId: string,
  report: { delivered: true } | { delivered: false; errorCode: number | null },
): Promise<MessageId | null> {
  if (!TEXT_PROVIDERS.includes(provider)) {
    throw new Refused();
  }
  const row = await db.d1
    .prepare('SELECT id FROM messages WHERE firm_id = ? AND provider = ? AND provider_id = ?')
    .bind(firm, provider, providerId)
    .first<{ id: string }>();
  if (row === null) {
    return null;
  }
  const errorCode = report.delivered || report.errorCode === null || !Number.isSafeInteger(report.errorCode) ? null : report.errorCode;
  await run(
    db.d1
      .prepare(
        `UPDATE messages SET state = ?3, reason = ?4, error_code = ?5, updated_at = ?6
         WHERE firm_id = ?1 AND id = ?2 AND state IN ('sending', 'sent')`,
      )
      .bind(firm, row.id, report.delivered ? 'delivered' : 'failed', report.delivered ? null : 'undelivered', errorCode, db.clock.now()),
  );
  return row.id as MessageId;
}

/** The text that one row in the due list sent, or claimed, to one person. */
export async function findMessageForDue(
  db: RecordDb,
  firm: FirmId,
  due: DueId,
  to: Recipient,
): Promise<Message | null> {
  const recipient = to.kind === 'customer' ? to.customer : to.owner;
  const row = await db.d1
    .prepare(`${SELECT_MESSAGE} WHERE firm_id = ? AND due_id = ? AND recipient_id = ?`)
    .bind(firm, due, recipient)
    .first<MessageRow>();
  return row === null ? null : fromRow(row);
}

export async function getMessage(db: RecordDb, firm: FirmId, message: MessageId): Promise<Message | null> {
  const row = await db.d1
    .prepare(`${SELECT_MESSAGE} WHERE firm_id = ? AND id = ?`)
    .bind(firm, message)
    .first<MessageRow>();
  return row === null ? null : fromRow(row);
}

/** The firm's texts claimed from one instant up to, not including, another, in the order they were claimed. */
export async function listMessagesBetween(db: RecordDb, firm: FirmId, from: Instant, to: Instant): Promise<Message[]> {
  const { results } = await db.d1
    .prepare(`${SELECT_MESSAGE} WHERE firm_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at, rowid`)
    .bind(firm, instant(from), instant(to))
    .all<MessageRow>();
  return results.map(fromRow);
}

/** The history entry that says a text went, for the kinds that write one. */
function sentEntry(message: Message): NewHistory | null {
  const history = MESSAGE_KINDS[message.kind].history;
  switch (history) {
    case 'reminder_sent':
      return message.visit === null ? null : { kind: history, by: frontline, visit: message.visit };
    case 'passed_to_owner':
      return message.job === null ? null : { kind: history, by: frontline, job: message.job };
  }
}

const SELECT_MESSAGE = `
  SELECT id, due_id, kind, customer_id, owner_id, job_id, visit_id, call_id, to_number, from_number, words,
         wording_id, segments, state, reason, provider, provider_id, error_code, created_at, sent_at, updated_at
  FROM messages`;

interface MessageRow {
  id: string;
  due_id: string;
  kind: MessageKind;
  customer_id: string | null;
  owner_id: string | null;
  job_id: string | null;
  visit_id: string | null;
  call_id: string | null;
  to_number: string | null;
  from_number: string | null;
  words: string | null;
  wording_id: string | null;
  segments: number | null;
  state: MessageState;
  reason: MessageReason | null;
  provider: TextProvider | null;
  provider_id: string | null;
  error_code: number | null;
  created_at: number;
  sent_at: number | null;
  updated_at: number;
}

function fromRow(row: MessageRow): Message {
  return {
    id: row.id as MessageId,
    due: row.due_id as DueId,
    kind: row.kind,
    to:
      row.customer_id !== null
        ? { kind: 'customer', customer: row.customer_id as CustomerId }
        : { kind: 'owner', owner: row.owner_id as OwnerId },
    job: row.job_id as JobId | null,
    visit: row.visit_id as VisitId | null,
    call: row.call_id as CallId | null,
    toNumber: row.to_number as UkMobile | null,
    fromNumber: row.from_number as UkMobile | null,
    words: row.words,
    wording: row.wording_id as WordingId | null,
    segments: row.segments,
    state: row.state,
    reason: row.reason,
    provider: row.provider,
    providerId: row.provider_id,
    errorCode: row.error_code,
    createdAt: instant(row.created_at),
    sentAt: row.sent_at === null ? null : instant(row.sent_at),
    updatedAt: instant(row.updated_at),
  };
}

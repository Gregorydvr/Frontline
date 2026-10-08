// Texts that come in to a firm's number. Each is stored against the customer
// it came from, and shown on their job's page. Nothing answers them in
// Release 1. What a customer wrote is data, never instructions (rule 17 in
// CLAUDE.md).

import { instant, type Instant } from '../clock';
import { newId } from '../ids';
import { isUkMobile, type UkMobile } from '../phone';
import { line, Refused, runTogether, type RecordDb } from './db';
import { textInEntry } from './history';
import { TEXT_LIMITS, TEXT_PROVIDERS, type CustomerId, type FirmId, type JobId, type TextIn, type TextInId, type TextProvider } from './types';

export interface NewTextIn {
  provider: TextProvider;
  providerId: string;
  /** The number it came from, as the provider gave it, or null when it gave none. */
  from: string | null;
  words: string;
}

export type RecordedTextIn =
  | { result: 'stored'; text: TextInId; customer: CustomerId | null; job: JobId | null }
  /** The record already held this text, so nothing changed. */
  | { result: 'repeat'; text: TextInId };

/**
 * Stores a text that came in to the firm's number, with its history entry, in
 * one step. It goes on:
 * - the customer it came from: of the firm's customers on that mobile, the
 *   one last texted from here, or failing that the newest
 * - their job: the job of the last text sent to them, or failing that their
 *   newest job
 * A text from a number that is not a customer's is kept with no customer,
 * for staff to see. The same text arriving twice is kept once.
 */
export async function recordTextIn(db: RecordDb, firm: FirmId, input: NewTextIn): Promise<RecordedTextIn> {
  if (!TEXT_PROVIDERS.includes(input.provider)) {
    throw new Refused();
  }
  line(input.providerId, TEXT_LIMITS.providerId);
  if (typeof input.words !== 'string' || input.words.length > TEXT_LIMITS.textIn) {
    throw new Refused();
  }
  const from = input.from !== null && /^\+\d{6,15}$/.test(input.from) ? input.from : null;

  const already = await findTextIn(db, firm, input.provider, input.providerId);
  if (already !== null) {
    return { result: 'repeat', text: already };
  }

  const found = from !== null && isUkMobile(from) ? await whoAndWhich(db, firm, from) : null;
  const text = newId() as TextInId;
  const statements = [
    db.d1
      .prepare(
        `INSERT INTO texts_in (id, firm_id, provider, provider_id, from_number, customer_id, job_id, words, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(text, firm, input.provider, input.providerId, from, found?.customer ?? null, found?.job ?? null, input.words, db.clock.now()),
  ];
  if (found !== null) {
    statements.push(textInEntry(db, firm, { text, customer: found.customer, job: found.job }));
  }
  try {
    await runTogether(db.d1, statements);
  } catch (thrown) {
    // The same text arriving twice at once: the second is refused by the
    // database, and finds the first.
    const first = thrown instanceof Refused ? await findTextIn(db, firm, input.provider, input.providerId) : null;
    if (first === null) {
      throw thrown;
    }
    return { result: 'repeat', text: first };
  }
  return { result: 'stored', text, customer: found?.customer ?? null, job: found?.job ?? null };
}

/** The firm's texts that came in from one instant up to, not including, another, in the order they came. */
export async function listTextsInBetween(db: RecordDb, firm: FirmId, from: Instant, to: Instant): Promise<TextIn[]> {
  const { results } = await db.d1
    .prepare(
      `SELECT t.id, t.provider, t.provider_id, t.from_number, t.customer_id, c.name AS customer_name, t.job_id,
              t.words, t.received_at
       FROM texts_in t LEFT JOIN customers c ON c.firm_id = t.firm_id AND c.id = t.customer_id
       WHERE t.firm_id = ? AND t.received_at >= ? AND t.received_at < ?
       ORDER BY t.received_at, t.rowid`,
    )
    .bind(firm, instant(from), instant(to))
    .all<TextInRow>();
  return results.map(fromRow);
}

async function findTextIn(db: RecordDb, firm: FirmId, provider: TextProvider, providerId: string): Promise<TextInId | null> {
  const row = await db.d1
    .prepare('SELECT id FROM texts_in WHERE firm_id = ? AND provider = ? AND provider_id = ?')
    .bind(firm, provider, providerId)
    .first<{ id: string }>();
  return row === null ? null : (row.id as TextInId);
}

/** The customer a text from this mobile is from, and the job it goes on. */
async function whoAndWhich(
  db: RecordDb,
  firm: FirmId,
  mobile: UkMobile,
): Promise<{ customer: CustomerId; job: JobId | null } | null> {
  const row = await db.d1
    .prepare(
      `SELECT c.id AS customer_id,
              COALESCE(
                (SELECT m.job_id FROM messages m
                 WHERE m.firm_id = c.firm_id AND m.customer_id = c.id AND m.job_id IS NOT NULL
                 ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1),
                (SELECT j.id FROM jobs j WHERE j.firm_id = c.firm_id AND j.customer_id = c.id
                 ORDER BY j.created_at DESC, j.rowid DESC LIMIT 1)) AS job_id
       FROM customers c
       WHERE c.firm_id = ?1 AND c.mobile = ?2
       ORDER BY (SELECT MAX(m.created_at) FROM messages m WHERE m.firm_id = c.firm_id AND m.customer_id = c.id) DESC NULLS LAST,
                c.created_at DESC, c.rowid DESC
       LIMIT 1`,
    )
    .bind(firm, mobile)
    .first<{ customer_id: string; job_id: string | null }>();
  return row === null ? null : { customer: row.customer_id as CustomerId, job: row.job_id as JobId | null };
}

interface TextInRow {
  id: string;
  provider: TextProvider;
  provider_id: string;
  from_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  job_id: string | null;
  words: string;
  received_at: number;
}

function fromRow(row: TextInRow): TextIn {
  return {
    id: row.id as TextInId,
    provider: row.provider,
    providerId: row.provider_id,
    from: row.from_number,
    customer:
      row.customer_id === null || row.customer_name === null
        ? null
        : { id: row.customer_id as CustomerId, name: row.customer_name },
    job: row.job_id as JobId | null,
    words: row.words,
    receivedAt: instant(row.received_at),
  };
}

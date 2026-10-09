// Links a customer opens from a text, with no login (rule 13 in CLAUDE.md).
// Each has its own token: 128 random bits from the cryptographic source, so
// it cannot be guessed. The address holds the token and nothing else. A link
// is for one customer and one job, and stops working when it expires.

import { instant, type Instant } from '../clock';
import { isId, newId } from '../ids';
import { Refused, run, type RecordDb } from './db';
import type { CustomerId, DueId, FirmId, JobId, LinkToken } from './types';

/** How long a link works: 14 days from when its text is made. */
export const LINK_LASTS = 14 * 24 * 60 * 60_000;

/**
 * The link for a customer and their job that the text from one row in the
 * due list carries. Running that row again gives the same link, so a text
 * claimed and sent once never carries two.
 */
export async function linkForDue(
  db: RecordDb,
  firm: FirmId,
  input: { due: DueId; customer: CustomerId; job: JobId },
): Promise<LinkToken> {
  const now = db.clock.now();
  await run(
    db.d1
      .prepare(
        `INSERT INTO links (token, firm_id, customer_id, job_id, due_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (firm_id, due_id) DO NOTHING`,
      )
      .bind(newId(), firm, input.customer, input.job, input.due, now + LINK_LASTS, now),
  );
  const row = await db.d1
    .prepare('SELECT token FROM links WHERE firm_id = ? AND due_id = ? AND customer_id = ? AND job_id = ?')
    .bind(firm, input.due, input.customer, input.job)
    .first<{ token: string }>();
  if (row === null) {
    // The row's link is for someone else: cannot happen through send().
    throw new Refused();
  }
  return row.token as LinkToken;
}

/**
 * What a link is for: the firm, the customer and the job, while it works.
 * A record function that cannot take the firm, since the token is how the
 * firm is found, as findFirmByNumber() finds it from a number. It gives only
 * ids, and nothing for a token that is not a link, or has expired.
 */
export async function findLink(
  db: RecordDb,
  token: string,
): Promise<{ firm: FirmId; customer: CustomerId; job: JobId; expiresAt: Instant } | null> {
  if (!isId(token)) {
    return null;
  }
  const row = await db.d1
    .prepare('SELECT firm_id, customer_id, job_id, expires_at FROM links WHERE token = ? AND expires_at > ?')
    .bind(token, db.clock.now())
    .first<{ firm_id: string; customer_id: string; job_id: string; expires_at: number }>();
  return row === null
    ? null
    : {
        firm: row.firm_id as FirmId,
        customer: row.customer_id as CustomerId,
        job: row.job_id as JobId,
        expiresAt: instant(row.expires_at),
      };
}

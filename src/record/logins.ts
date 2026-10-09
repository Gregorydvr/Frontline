// Logging an owner in (slice F of docs/build-brief.md). The owner asks for a
// link on the login page; it goes by text to the mobile held on their record,
// never to a number typed on the page. The link works once, for a short
// time, and opening it only shows a button: the tap on the button logs in, so
// a phone's link preview cannot use the link up.
//
// A login is what the owner's cookie stands for. Only the SHA-256 of the
// cookie's token is stored, so the record alone cannot be used to log in.
// Logging in and out is recorded and never edited (rule 15 in CLAUDE.md).

import { instant, type Instant } from '../clock';
import { isId, newId, type Id } from '../ids';
import { isUkMobile, type UkMobile } from '../phone';
import { Refused, runTogether, type RecordDb } from './db';
import { insertDue } from './due';
import { loginEntry } from './history';
import type { DueId, FirmId, JobId, LoginToken, OwnerId } from './types';

/** How long a login link works: 15 minutes from when it is asked for. */
export const LOGIN_LINK_LASTS = 15 * 60_000;

/**
 * How long a login lasts: 30 days after it was last used, and never more
 * than 90 days after the owner logged in. The build's answer to open
 * question 6, chosen at Greg's request; see docs/decisions.md.
 */
export const LOGIN_LASTS = { unused: 30 * 24 * 60 * 60_000, longest: 90 * 24 * 60 * 60_000 } as const;

/** The most login links one owner can be sent: in an hour, and in a day. */
export const LOGIN_LINK_LIMITS = { hour: 3, day: 10 } as const;

declare const sessionTokenBrand: unique symbol;
/** The token in an owner's cookie. It cannot be guessed, and is never stored. */
export type SessionToken = Id & { readonly [sessionTokenBrand]: true };

/**
 * The owners whose mobile this is, in any firm, so the login page can send
 * each a link. A record function that cannot take the firm, since finding it
 * is its job, as findFirmByNumber() finds one from the number rung. It gives
 * only ids.
 */
export async function findOwnersByMobile(db: RecordDb, mobile: UkMobile): Promise<{ firm: FirmId; owner: OwnerId }[]> {
  if (!isUkMobile(mobile)) {
    throw new Refused();
  }
  const { results } = await db.d1
    .prepare('SELECT firm_id, id FROM owners WHERE mobile = ? ORDER BY created_at, id')
    .bind(mobile)
    .all<{ firm_id: string; id: string }>();
  return results.map((row) => ({ firm: row.firm_id as FirmId, owner: row.id as OwnerId }));
}

/**
 * Makes a link that logs one of the firm's owners in, with the row in the due
 * list whose text carries it, in one step. The text goes to the mobile on the
 * owner's record. Given a job, the owner lands on it once logged in. The
 * link works until the row's latest time.
 */
export async function createLoginLink(
  db: RecordDb,
  firm: FirmId,
  input: { owner: OwnerId; job: JobId | null },
): Promise<{ token: LoginToken; due: DueId }> {
  const now = db.clock.now();
  const expiresAt = instant(now + LOGIN_LINK_LASTS);
  const due = newId() as DueId;
  const token = newId() as LoginToken;
  await runTogether(db.d1, [
    insertDue(db, firm, due, { action: 'send_login_link', runAt: now, latestAt: expiresAt }),
    db.d1
      .prepare(
        `INSERT INTO login_links (token, firm_id, owner_id, job_id, due_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(token, firm, input.owner, input.job, due, expiresAt, now),
  ]);
  return { token, due };
}

/** How many login links one of the firm's owners has been made after an instant, for the limits above. */
export async function countLoginLinks(db: RecordDb, firm: FirmId, owner: OwnerId, after: Instant): Promise<number> {
  const row = await db.d1
    .prepare('SELECT COUNT(*) AS n FROM login_links WHERE firm_id = ? AND owner_id = ? AND created_at > ?')
    .bind(firm, owner, instant(after))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** The login link that one of the firm's rows in the due list sends, and who to. */
export async function loginLinkForDue(
  db: RecordDb,
  firm: FirmId,
  due: DueId,
): Promise<{ token: LoginToken; owner: OwnerId; expiresAt: Instant } | null> {
  const row = await db.d1
    .prepare('SELECT token, owner_id, expires_at FROM login_links WHERE firm_id = ? AND due_id = ?')
    .bind(firm, due)
    .first<{ token: string; owner_id: string; expires_at: number }>();
  return row === null
    ? null
    : { token: row.token as LoginToken, owner: row.owner_id as OwnerId, expiresAt: instant(row.expires_at) };
}

/**
 * Whether a login link still works: not used, and not expired. A record
 * function that cannot take the firm, since the token is how it is found,
 * as findLink() finds a customer's. It gives only ids.
 */
export async function findLoginLink(
  db: RecordDb,
  token: string,
): Promise<{ firm: FirmId; owner: OwnerId; job: JobId | null } | null> {
  if (!isId(token)) {
    return null;
  }
  const row = await db.d1
    .prepare('SELECT firm_id, owner_id, job_id FROM login_links WHERE token = ? AND used_at IS NULL AND expires_at > ?')
    .bind(token, db.clock.now())
    .first<{ firm_id: string; owner_id: string; job_id: string | null }>();
  return row === null ? null : { firm: row.firm_id as FirmId, owner: row.owner_id as OwnerId, job: row.job_id as JobId | null };
}

/**
 * Logs in with a link: uses it up, starts a login for its owner, and records
 * it, all in one step. A link works once: of two taps at once, only one
 * logs in. Gives the token for the owner's cookie, or null for a link used,
 * expired or never made. Like findLoginLink(), it cannot take the firm.
 */
export async function logInWithLink(
  db: RecordDb,
  token: string,
): Promise<{ firm: FirmId; owner: OwnerId; job: JobId | null; session: SessionToken } | null> {
  if (!isId(token)) {
    return null;
  }
  const now = db.clock.now();
  const cookie = newId() as SessionToken;
  const session = await sessionId(cookie);
  const [used] = await runTogether(db.d1, [
    db.d1
      .prepare(
        `UPDATE login_links SET used_at = ?2, session_id = ?3
         WHERE token = ?1 AND used_at IS NULL AND expires_at > ?2`,
      )
      .bind(token, now, session),
    // Each of these acts only on the link this step used.
    db.d1
      .prepare(
        `INSERT INTO sessions (id, firm_id, owner_id, created_at, last_used_at)
         SELECT ?2, firm_id, owner_id, ?3, ?3 FROM login_links WHERE token = ?1 AND session_id = ?2`,
      )
      .bind(token, session, now),
    loginEntry(db, 'logged_in', session, null),
  ]);
  if (used?.meta.changes !== 1) {
    return null;
  }
  const row = await db.d1
    .prepare('SELECT firm_id, owner_id, job_id FROM login_links WHERE token = ? AND session_id = ?')
    .bind(token, session)
    .first<{ firm_id: string; owner_id: string; job_id: string | null }>();
  if (row === null) {
    throw new Refused();
  }
  return { firm: row.firm_id as FirmId, owner: row.owner_id as OwnerId, job: row.job_id as JobId | null, session: cookie };
}

/**
 * The firm and owner a cookie's login is for, while it lasts, marking it as
 * used now. A record function that cannot take the firm: the cookie is how
 * the firm is found. It gives only ids, and nothing for a login that has
 * ended or never was.
 */
export async function findSession(db: RecordDb, cookie: string): Promise<{ firm: FirmId; owner: OwnerId } | null> {
  if (!isId(cookie)) {
    return null;
  }
  const now = db.clock.now();
  const row = await db.d1
    .prepare(
      `UPDATE sessions SET last_used_at = ?2
       WHERE id = ?1 AND ended_at IS NULL AND last_used_at > ?3 AND created_at > ?4
       RETURNING firm_id, owner_id`,
    )
    .bind(await sessionId(cookie), now, now - LOGIN_LASTS.unused, now - LOGIN_LASTS.longest)
    .first<{ firm_id: string; owner_id: string }>();
  return row === null ? null : { firm: row.firm_id as FirmId, owner: row.owner_id as OwnerId };
}

/** Ends one of the firm's logins, when its owner logs out, and records it. Gives false when it had already ended. */
export async function endSession(db: RecordDb, firm: FirmId, cookie: SessionToken): Promise<boolean> {
  if (!isId(cookie)) {
    throw new Refused();
  }
  const session = await sessionId(cookie);
  const [entry, ended] = await runTogether(db.d1, [
    loginEntry(db, 'logged_out', session, firm),
    db.d1
      .prepare('UPDATE sessions SET ended_at = ?3 WHERE firm_id = ?1 AND id = ?2 AND ended_at IS NULL')
      .bind(firm, session, db.clock.now()),
  ]);
  return entry?.meta.changes === 1 && ended?.meta.changes === 1;
}

/** A login's id: the SHA-256 of the token in its cookie, as hex. */
async function sessionId(cookie: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cookie));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

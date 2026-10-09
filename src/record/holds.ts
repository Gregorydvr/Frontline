// Holds: a time taken in the diary during a call, before the call ends. The
// customer and the job are filed only when the call's report comes (slice C),
// so the time is held under the provider's id for the call, and the report
// files it as a visit on the job the call opened (recordCall()). A hold that
// is never filed stops counting after an hour, and the time is free again.
//
// A time is taken by a booked visit or a hold that still counts. Taking one
// checks and writes in a single statement, which the database runs on its
// own, so two calls can never both be given the same time.

import { instant, type Instant } from '../clock';
import { newId } from '../ids';
import { line, Refused, run, type RecordDb } from './db';
import {
  CALL_LIMITS,
  CALL_PROVIDERS,
  HOLD_STATES,
  VISIT_KINDS,
  type CallProvider,
  type FirmId,
  type Hold,
  type HoldId,
  type HoldState,
  type VisitId,
  type VisitKind,
} from './types';

/** How long a hold counts without its call being filed. */
export const HOLD_LASTS = 60 * 60_000;
/** How long a visit with no end, from before slice E, is taken to last. */
export const VISIT_WITHOUT_END = 60 * 60_000;

/**
 * The SQL that is true when nothing else takes a time: no booked visit and no
 * hold that still counts overlaps it. Given the numbers of the bound values
 * it reads: the firm, the start and end, the oldest a counting hold may be,
 * and the call and visit to leave out (each may be bound as null).
 */
export function timeIsFree(at: {
  firm: number;
  starts: number;
  ends: number;
  holdsSince: number;
  exceptProvider: number;
  exceptCall: number;
  exceptVisit: number;
}): string {
  const p = (n: number) => `?${String(n)}`;
  return `NOT EXISTS (
      SELECT 1 FROM visits tv
      WHERE tv.firm_id = ${p(at.firm)} AND tv.state = 'booked'
        AND tv.starts_at < ${p(at.ends)}
        AND COALESCE(tv.ends_at, tv.starts_at + ${String(VISIT_WITHOUT_END)}) > ${p(at.starts)}
        AND tv.id IS NOT ${p(at.exceptVisit)})
    AND NOT EXISTS (
      SELECT 1 FROM holds th
      WHERE th.firm_id = ${p(at.firm)} AND th.state = 'held' AND th.updated_at > ${p(at.holdsSince)}
        AND th.starts_at < ${p(at.ends)} AND th.ends_at > ${p(at.starts)}
        AND NOT (th.provider IS ${p(at.exceptProvider)} AND th.provider_call_id IS ${p(at.exceptCall)}))`;
}

export interface NewHold {
  provider: CallProvider;
  providerCallId: string;
  kind: VisitKind;
  startsAt: Instant;
  endsAt: Instant;
}

/**
 * Holds a time in the firm's diary for a call that is still going, if nothing
 * else takes it. The same call booking again moves its hold, so a call never
 * holds two times; booking again with the same details changes nothing.
 * Gives the hold, or null when the time is taken (or the call's hold was
 * already filed).
 */
export async function holdTime(db: RecordDb, firm: FirmId, input: NewHold): Promise<HoldId | null> {
  if (!CALL_PROVIDERS.includes(input.provider) || !VISIT_KINDS.includes(input.kind)) {
    throw new Refused();
  }
  line(input.providerCallId, CALL_LIMITS.providerCallId);
  const startsAt = instant(input.startsAt);
  const endsAt = instant(input.endsAt);
  if (endsAt <= startsAt) {
    throw new Refused();
  }
  const now = db.clock.now();
  const row = await run(
    db.d1
      .prepare(
        `INSERT INTO holds (id, firm_id, provider, provider_call_id, kind, starts_at, ends_at, state, created_at, updated_at)
         SELECT ?2, ?1, ?3, ?4, ?5, ?6, ?7, 'held', ?8, ?8
         WHERE ${timeIsFree({ firm: 1, starts: 6, ends: 7, holdsSince: 9, exceptProvider: 3, exceptCall: 4, exceptVisit: 10 })}
         ON CONFLICT (firm_id, provider, provider_call_id) DO UPDATE
           SET kind = excluded.kind, starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_at = excluded.updated_at
           WHERE holds.state = 'held'
         RETURNING id`,
      )
      .bind(firm, newId(), input.provider, input.providerCallId, input.kind, startsAt, endsAt, now, now - HOLD_LASTS, null),
  );
  const [held] = row.results as { id: string }[];
  return held === undefined ? null : (held.id as HoldId);
}

/** The time held for a call that has not been filed yet, if it still counts. */
export async function findHoldForCall(
  db: RecordDb,
  firm: FirmId,
  provider: CallProvider,
  providerCallId: string,
): Promise<Hold | null> {
  const row = await db.d1
    .prepare(
      `${SELECT_HOLD} WHERE firm_id = ? AND provider = ? AND provider_call_id = ? AND state = 'held' AND updated_at > ?`,
    )
    .bind(firm, provider, providerCallId, db.clock.now() - HOLD_LASTS)
    .first<HoldRow>();
  return row === null ? null : fromRow(row);
}

/**
 * Lets a held time go, such as when the call turned out urgent and was passed
 * to the owner. Gives false when it was not held.
 */
export async function releaseHold(db: RecordDb, firm: FirmId, hold: HoldId): Promise<boolean> {
  const result = await run(
    db.d1
      .prepare(`UPDATE holds SET state = 'released', updated_at = ?3 WHERE firm_id = ?1 AND id = ?2 AND state = 'held'`)
      .bind(firm, hold, db.clock.now()),
  );
  return result.meta.changes === 1;
}

/**
 * The times taken in the firm's diary from one instant up to, not including,
 * another: booked visits and holds that still count, earliest first. A call's
 * own hold can be left out, so it can be offered its own time again.
 */
export async function listTakenTimes(
  db: RecordDb,
  firm: FirmId,
  from: Instant,
  to: Instant,
  except: { provider: CallProvider; providerCallId: string } | null = null,
): Promise<{ startsAt: Instant; endsAt: Instant }[]> {
  const { results } = await db.d1
    .prepare(
      `SELECT starts_at, COALESCE(ends_at, starts_at + ${String(VISIT_WITHOUT_END)}) AS ends_at FROM visits
       WHERE firm_id = ?1 AND state = 'booked' AND starts_at < ?3
         AND COALESCE(ends_at, starts_at + ${String(VISIT_WITHOUT_END)}) > ?2
       UNION ALL
       SELECT starts_at, ends_at FROM holds
       WHERE firm_id = ?1 AND state = 'held' AND updated_at > ?4 AND starts_at < ?3 AND ends_at > ?2
         AND NOT (provider IS ?5 AND provider_call_id IS ?6)
       ORDER BY starts_at`,
    )
    .bind(firm, instant(from), instant(to), db.clock.now() - HOLD_LASTS, except?.provider ?? null, except?.providerCallId ?? null)
    .all<{ starts_at: number; ends_at: number }>();
  return results.map((row) => ({ startsAt: instant(row.starts_at), endsAt: instant(row.ends_at) }));
}

/** The statement that marks a hold filed as a visit. recordCall() runs it in the same step as the call. */
export function fileHold(db: RecordDb, firm: FirmId, hold: HoldId, visit: VisitId): D1PreparedStatement {
  return db.d1
    .prepare(`UPDATE holds SET state = 'filed', visit_id = ?3, updated_at = ?4 WHERE firm_id = ?1 AND id = ?2 AND state = 'held'`)
    .bind(firm, hold, visit, db.clock.now());
}

const SELECT_HOLD =
  'SELECT id, provider, provider_call_id, kind, starts_at, ends_at, state, visit_id, created_at, updated_at FROM holds';

interface HoldRow {
  id: string;
  provider: CallProvider;
  provider_call_id: string;
  kind: VisitKind;
  starts_at: number;
  ends_at: number;
  state: HoldState;
  visit_id: string | null;
  created_at: number;
  updated_at: number;
}

function fromRow(row: HoldRow): Hold {
  if (!HOLD_STATES.includes(row.state)) {
    throw new Refused();
  }
  return {
    id: row.id as HoldId,
    provider: row.provider,
    providerCallId: row.provider_call_id,
    kind: row.kind,
    startsAt: instant(row.starts_at),
    endsAt: instant(row.ends_at),
    state: row.state,
    visit: row.visit_id as VisitId | null,
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
  };
}

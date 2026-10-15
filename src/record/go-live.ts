// The go-live gate (task 4 of queue 2 in docs/autopilot.md): the evidence the
// record holds for a firm's checklist, the ticks staff make on it, never
// edited, and switching the firm to live. Going live is refused, with nothing
// changed, unless every item on the checklist is met (src/go-live.ts) and
// the member of staff is the one the copy names; the database itself holds
// to the second.

import { instant } from '../clock';
import { isId, newId } from '../ids';
import { readyToGoLive, TICKED_ITEMS, type GoLiveEvidence, type GoLiveState, type Tick, type TickedItem } from '../go-live';
import { getAgent } from './agents';
import { bit, Refused, runTogether, type RecordDb } from './db';
import { getFirm, SERVICE_COLUMNS } from './firms';
import { firmEntry } from './history';
import { listOwners } from './owners';
import { staffLogStatement } from './staff';
import { firmWording } from './wording';
import type { CallId, FirmId, StaffId } from './types';

/** When the firm's number (?1) was last set, or null if it has none: calls and texts before then were through another number. */
const NUMBER_SET_AT = "(SELECT MAX(at) FROM history WHERE firm_id = ?1 AND kind = 'number_set')";

/** Everything the firm's checklist is worked out from. Null for a firm that is not there. */
export async function goLiveState(db: RecordDb, firm: FirmId): Promise<GoLiveState | null> {
  const found = await getFirm(db, firm);
  if (found === null) return null;
  const since = NUMBER_SET_AT;
  const counts = await db.d1
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM calls WHERE firm_id = ?1 AND started_at >= ${since}) AS calls,
         (SELECT COUNT(*) FROM messages WHERE firm_id = ?1 AND state = 'delivered'
            AND from_number = (SELECT phone_number FROM firms WHERE id = ?1)) AS delivered,
         (SELECT COUNT(*) FROM texts_in WHERE firm_id = ?1 AND received_at >= ${since}) AS texts_in`,
    )
    .bind(firm)
    .first<{ calls: number; delivered: number; texts_in: number }>();
  const { results } = await db.d1
    .prepare('SELECT item, ticked, call_id, at FROM go_live_ticks WHERE firm_id = ? ORDER BY at, rowid')
    .bind(firm)
    .all<{ item: string; ticked: number; call_id: string | null; at: number }>();
  const ticks: Partial<Record<TickedItem, Tick>> = {};
  let testCall: { call: CallId; at: number } | null = null;
  for (const row of results) {
    const item = TICKED_ITEMS.find((one) => one === row.item);
    if (item !== undefined) ticks[item] = { ticked: row.ticked === 1, at: instant(row.at) };
    if (row.item === 'test_call') testCall = row.ticked === 1 && row.call_id !== null ? { call: row.call_id as CallId, at: row.at } : null;
  }
  // The test call counts only while it is still one of the firm's calls, made through its number as it is now.
  if (testCall !== null) {
    const still = await db.d1
      .prepare(`SELECT 1 AS still FROM calls WHERE firm_id = ?1 AND id = ?2 AND started_at >= ${since}`)
      .bind(firm, testCall.call)
      .first();
    if (still === null) testCall = null;
  }
  const evidence: GoLiveEvidence = {
    calls: counts?.calls ?? 0,
    textsDelivered: counts?.delivered ?? 0,
    textsIn: counts?.texts_in ?? 0,
    testCall: testCall === null ? null : { call: testCall.call, at: instant(testCall.at) },
    ticks,
  };
  return {
    firm: found,
    owners: await listOwners(db, firm),
    wording: await firmWording(db, firm),
    agent: await getAgent(db, firm),
    evidence,
  };
}

/** Ticks or unticks one of the items staff tick by hand, and records who did it in the staff log. */
export async function tickGoLive(db: RecordDb, firm: FirmId, item: TickedItem, ticked: boolean, staff: StaffId): Promise<void> {
  if (!TICKED_ITEMS.includes(item) || !isId(staff)) throw new Refused();
  const id = newId();
  const results = await runTogether(db.d1, [
    db.d1
      .prepare('INSERT INTO go_live_ticks (id, firm_id, item, ticked, call_id, at) SELECT ?1, ?2, ?3, ?4, NULL, ?5 WHERE EXISTS (SELECT 1 FROM firms WHERE id = ?2)')
      .bind(id, firm, item, bit(ticked), db.clock.now()),
    staffLogStatement(db, firm, staff, ticked ? 'ticked_go_live' : 'unticked_go_live')[1],
  ]);
  if (results[0]?.meta.changes !== 1) throw new Refused();
}

/**
 * Records one of the firm's own calls as the end-to-end test call that
 * passed, or, with null, that no call has passed. Another firm's call, one
 * that is not there, or one made before the firm's number was last set, is
 * refused.
 */
export async function recordTestCall(db: RecordDb, firm: FirmId, call: CallId | null, staff: StaffId): Promise<void> {
  if ((call !== null && !isId(call)) || !isId(staff)) throw new Refused();
  const id = newId();
  const results = await runTogether(db.d1, [
    db.d1
      .prepare(
        `INSERT INTO go_live_ticks (id, firm_id, item, ticked, call_id, at)
         SELECT ?1, ?2, 'test_call', ?3, ?4, ?5
         WHERE EXISTS (SELECT 1 FROM firms WHERE id = ?2)
           AND (?4 IS NULL OR EXISTS (
             SELECT 1 FROM calls WHERE firm_id = ?2 AND id = ?4
               AND started_at >= (SELECT MAX(at) FROM history WHERE firm_id = ?2 AND kind = 'number_set')))`,
      )
      .bind(id, firm, bit(call !== null), call, db.clock.now()),
    // In the staff log only if it was recorded.
    staffLogStatement(db, firm, staff, call === null ? 'unticked_go_live' : 'recorded_test_call', {}, { where: 'EXISTS (SELECT 1 FROM go_live_ticks WHERE id = ?)', binds: [id] })[1],
  ]);
  if (results[0]?.meta.changes !== 1) throw new Refused();
}

/** What switching a firm to live did. */
export type WentLive = 'live' | 'not_ready' | 'not_allowed' | 'already_live';

/**
 * Switches the firm to live, by the member of staff whose email the copy
 * names (Greg), once every item on its checklist is met: it is marked live,
 * by them, and the services it chose are switched on, each recorded in its
 * history, in one step. Anyone else is refused with nothing changed, and the
 * database checks it too. A firm leaving cannot go live, nor one already
 * live.
 */
export async function markLive(db: RecordDb, firm: FirmId, staff: StaffId, goLiveBy: string): Promise<WentLive> {
  if (!isId(staff) || goLiveBy.trim() === '') throw new Refused();
  const state = await goLiveState(db, firm);
  if (state === null) throw new Refused();
  if (state.firm.live !== null) return 'already_live';
  if (!readyToGoLive(state)) return 'not_ready';
  const now = db.clock.now();
  const by = { kind: 'staff', staff } as const;
  // The columns come from the fixed list, never from the caller.
  const switches = state.firm.servicesChosen.map((service) => `${SERVICE_COLUMNS[service]} = 1`).join(', ');
  const wentLive = { where: 'EXISTS (SELECT 1 FROM firms WHERE id = ? AND live_at = ? AND live_by = ?)', binds: [firm, now, staff] };
  const results = await runTogether(db.d1, [
    db.d1
      .prepare(
        `UPDATE firms SET live_at = ?1, live_by = ?2${switches === '' ? '' : `, ${switches}`}
         WHERE id = ?3 AND live_at IS NULL AND left_at IS NULL
           AND EXISTS (SELECT 1 FROM staff WHERE id = ?2 AND email = ?4)`,
      )
      .bind(now, staff, firm, goLiveBy.trim().toLowerCase()),
    firmEntry(db, firm, 'went_live', by, null, wentLive),
    ...state.firm.servicesChosen.map((service) => firmEntry(db, firm, 'service_on', by, service, wentLive)),
    staffLogStatement(db, firm, staff, 'went_live', {}, wentLive)[1],
  ]);
  return results[0]?.meta.changes === 1 ? 'live' : 'not_allowed';
}

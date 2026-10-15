// Each firm's voice agent in Vapi: which agent is the firm's, where it stands
// against the record, and the log of every push and check, never edited.
// Setting the agent, or changing anything it is made from, puts a row on the
// due list to push it (src/agent-push.ts), in the same step.

import { instant } from '../clock';
import { isId, newId } from '../ids';
import { VAPI_ID } from '../providers/vapi';
import { Refused, runTogether, type RecordDb } from './db';
import { staffLogStatement } from './staff';
import {
  AGENT_OUTCOMES,
  AGENT_STATES,
  type Agent,
  type AgentOutcome,
  type AgentPush,
  type AgentPushId,
  type AgentState,
  type DueId,
  type FirmId,
  type StaffId,
} from './types';

/** How long a push may keep trying while Vapi cannot be reached: a day. */
export const PUSH_TRIES_FOR = 24 * 3_600_000;

/** The names of settings, as stored: a JSON list of short names, in the order given. */
function settingNames(names: readonly string[]): string {
  if (!names.every((name) => /^[A-Za-z]{1,40}$/.test(name))) throw new Refused();
  return JSON.stringify(names);
}

function namesFrom(stored: string): string[] {
  const names: unknown = JSON.parse(stored);
  return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [];
}

/** The firm's agent in Vapi, or null if none is set. */
export async function getAgent(db: RecordDb, firm: FirmId): Promise<Agent | null> {
  const row = await db.d1
    .prepare('SELECT assistant_id, state, confirmed, checked_at, differing, set_at FROM agents WHERE firm_id = ?')
    .bind(firm)
    .first<{ assistant_id: string; state: string; confirmed: string | null; checked_at: number | null; differing: string; set_at: number }>();
  if (row === null) return null;
  return {
    assistantId: row.assistant_id,
    state: (AGENT_STATES as readonly string[]).includes(row.state) ? (row.state as AgentState) : 'stuck',
    confirmed: row.confirmed,
    checkedAt: row.checked_at === null ? null : instant(row.checked_at),
    differing: namesFrom(row.differing),
    setAt: instant(row.set_at),
  };
}

/**
 * Sets which agent in Vapi is the firm's, by a member of staff, and puts a
 * row on the due list to check it and push the record's settings to it. A
 * new id starts unchecked, with nothing confirmed. No agent is two firms':
 * one another firm has is "taken", and nothing changes.
 */
export async function setAgent(db: RecordDb, firm: FirmId, assistantId: string, staff: StaffId): Promise<'set' | 'taken'> {
  if (!VAPI_ID.test(assistantId) || !isId(staff)) throw new Refused();
  const taken = await db.d1.prepare('SELECT 1 AS taken FROM agents WHERE assistant_id = ? AND firm_id <> ?').bind(assistantId, firm).first();
  if (taken !== null) return 'taken';
  const now = db.clock.now();
  const results = await runTogether(db.d1, [
    db.d1
      .prepare(
        `INSERT INTO agents (firm_id, assistant_id, state, confirmed, checked_at, differing, set_at)
         SELECT ?1, ?2, 'unchecked', NULL, NULL, '[]', ?3 WHERE EXISTS (SELECT 1 FROM firms WHERE id = ?1)
         ON CONFLICT (firm_id) DO UPDATE SET assistant_id = excluded.assistant_id, state = 'unchecked',
           confirmed = NULL, checked_at = NULL, differing = '[]', set_at = excluded.set_at`,
      )
      .bind(firm, assistantId, now),
    staffLogStatement(db, firm, staff, 'set_agent')[1],
    pushRowStatement(db, firm),
  ]);
  if (results[0]?.meta.changes !== 1) throw new Refused();
  return 'set';
}

/**
 * The statements, for the same step as a change the agent is made from (such
 * as the urgent list), that mark the firm's agent behind and put one row on
 * the due list to push it. Each does nothing for a firm with no agent set,
 * and no second row is added while one already waits.
 */
export function pushAgentStatements(db: RecordDb, firm: FirmId): D1PreparedStatement[] {
  return [db.d1.prepare("UPDATE agents SET state = 'behind' WHERE firm_id = ?").bind(firm), pushRowStatement(db, firm)];
}

/** One row on the due list to push the firm's agent, if it has one and none already waits. */
function pushRowStatement(db: RecordDb, firm: FirmId): D1PreparedStatement {
  const now = db.clock.now();
  return db.d1
      .prepare(
        `INSERT INTO due (id, firm_id, action, call_id, visit_id, run_at, latest_at, state, created_at)
         SELECT ?1, ?2, 'push_agent', NULL, NULL, ?3, ?4, 'waiting', ?3
         WHERE EXISTS (SELECT 1 FROM agents WHERE firm_id = ?2)
           AND NOT EXISTS (SELECT 1 FROM due WHERE firm_id = ?2 AND action = 'push_agent' AND state = 'waiting')`,
      )
    .bind(newId(), firm, now, now + PUSH_TRIES_FOR);
}

/** What one push or check found, for recordAgentPush(). */
export interface AgentPushResult {
  /** The agent it was about: if the firm's agent has since been changed to another, nothing is written. */
  assistantId: string;
  by: { kind: 'frontline' } | { kind: 'staff'; staff: StaffId };
  due: DueId | null;
  outcome: AgentOutcome;
  /** The settings sent, or found to differ, by name. */
  settings: readonly string[];
  /** Where the agent now stands. */
  state: AgentState;
  /** The fingerprint now confirmed on Vapi, when a read-back matched; left as it was otherwise. */
  confirmed?: string;
  /** The settings that still differ, by name. */
  differing: readonly string[];
}

/**
 * Records one push or check of the firm's agent: a row in its log, never
 * edited, and where the agent now stands, in one step. Gives null, and writes
 * nothing, if the firm's agent is no longer the one it was about.
 */
export async function recordAgentPush(db: RecordDb, firm: FirmId, result: AgentPushResult): Promise<AgentPushId | null> {
  if (!AGENT_OUTCOMES.includes(result.outcome) || !AGENT_STATES.includes(result.state)) throw new Refused();
  if (result.by.kind === 'staff' && !isId(result.by.staff)) throw new Refused();
  if (result.confirmed !== undefined && !/^[0-9a-f]{64}$/.test(result.confirmed)) throw new Refused();
  const id = newId() as AgentPushId;
  const now = db.clock.now();
  const results = await runTogether(db.d1, [
    db.d1
      .prepare(
        `UPDATE agents SET state = ?3, confirmed = COALESCE(?4, confirmed), checked_at = ?5, differing = ?6
         WHERE firm_id = ?1 AND assistant_id = ?2`,
      )
      .bind(firm, result.assistantId, result.state, result.confirmed ?? null, now, settingNames(result.differing)),
    db.d1
      .prepare(
        `INSERT INTO agent_pushes (id, firm_id, assistant_id, at, by_kind, staff_id, due_id, outcome, settings)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE EXISTS (SELECT 1 FROM agents WHERE firm_id = ?2 AND assistant_id = ?3)`,
      )
      .bind(
        id,
        firm,
        result.assistantId,
        now,
        result.by.kind,
        result.by.kind === 'staff' ? result.by.staff : null,
        result.due,
        result.outcome,
        settingNames(result.settings),
      ),
  ]);
  return results[1]?.meta.changes === 1 ? id : null;
}

/** The firm's latest pushes and checks, newest first. */
export async function listAgentPushes(db: RecordDb, firm: FirmId, most = 20): Promise<AgentPush[]> {
  const { results } = await db.d1
    .prepare(
      `SELECT id, assistant_id, at, by_kind, staff_id, due_id, outcome, settings FROM agent_pushes
       WHERE firm_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`,
    )
    .bind(firm, Math.max(1, Math.min(most, 200)))
    .all<{ id: string; assistant_id: string; at: number; by_kind: string; staff_id: string | null; due_id: string | null; outcome: string; settings: string }>();
  return results.map((row) => ({
    id: row.id as AgentPushId,
    assistantId: row.assistant_id,
    at: instant(row.at),
    by: row.by_kind === 'staff' && row.staff_id !== null ? { kind: 'staff', staff: row.staff_id as StaffId } : { kind: 'frontline' },
    due: row.due_id as DueId | null,
    outcome: (AGENT_OUTCOMES as readonly string[]).includes(row.outcome) ? (row.outcome as AgentOutcome) : 'refused',
    settings: namesFrom(row.settings),
  }));
}

